// Content script pour l'extension Chess Sites to WintrChess
(function () {
  "use strict";

  // Configuration
  const CONFIG = {
    WINTRCHESS_URL: "https://wintrchess.com/",
    PGN_STORAGE_KEY: "wintrChessPgnToPaste",
    BUTTON_TEXT: "Analyser sur WintrChess",
    MAX_ATTEMPTS: 30,
    RETRY_DELAY: 500,
    LONG_RETRY_DELAY: 2000,
    AUTO_PASTE_DELAY: 100,
    BUTTON_CHECK_INTERVAL: 5000,
    DEBOUNCE_DELAY: 200,
    BUTTON_SELECTORS: {
      // Termes pour trouver les boutons d'analyse/bilan
      REVIEW_TERMS: ["bilan", "review", "analysis", "analyser", "analyze"],
      // Sélecteurs génériques partagés
      SHARED: [
        {
          selector: ".game-over-modal-content",
          method: "append",
          priority: 20,
        },
      ],
      // Sélecteurs spécifiques à Chess.com
      CHESS_COM: [
        { selector: ".board-controls-bottom", method: "append", priority: 15 },
        { selector: ".analysis-controls", method: "append", priority: 14 },
        { selector: ".board-controls", method: "append", priority: 13 },
        { selector: ".game-controls", method: "append", priority: 12 },
        { selector: ".post-game-controls", method: "append", priority: 11 },
      ],
      // Sélecteurs spécifiques à Lichess
      LICHESS: [
        { selector: ".analyse__tools", method: "append", priority: 10 },
        { selector: ".study__buttons", method: "append", priority: 9 },
        {
          selector: ".analyse__controls .left-buttons",
          method: "append",
          priority: 8,
        },
      ],
    },
  };

  // État global
  const STATE = {
    buttonAdded: false,
    observer: null,
    lastAttemptTime: 0,
    platform: null, // 'lichess' ou 'chess.com'
    buttonInstances: {}, // Pour garder une trace des boutons par type et emplacement
  };

  // Remplacements pour les fonctions TamperMonkey
  const chromeStorage = {
    setValue: (key, value) => {
      return new Promise(resolve => {
        chrome.storage.local.set({ [key]: value }, resolve);
      });
    },
    getValue: (key, defaultValue) => {
      return new Promise(resolve => {
        chrome.storage.local.get([key], result => {
          resolve(result[key] === undefined ? defaultValue : result[key]);
        });
      });
    },
    deleteValue: (key) => {
      return new Promise(resolve => {
        chrome.storage.local.remove(key, resolve);
      });
    }
  };

  // Fonction utilitaire de debounce
  const debounce = (fn, delay) => {
    let timer = null;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  };

  // Détermine si nous sommes sur une page Lichess, Chess.com ou WintrChess et agit en conséquence
  function init() {
    if (window.location.hostname === "lichess.org") {
      initLichess();
    } else if (window.location.hostname === "www.chess.com") {
      initChessCom();
    } else if (window.location.hostname === "wintrchess.com") {
      initWintrChess();
    }
  }

  // ===== LICHESS FUNCTIONS =====

  function initLichess() {
    const pageInfo = getLichessPageInfo();

    if (pageInfo.isRelevantPage) {
      STATE.platform = "lichess";
      setupMutationObserver(tryAddButton);
      tryAddButton();

      window.addEventListener("load", () =>
        setTimeout(tryAddButton, CONFIG.RETRY_DELAY),
      );
      window.addEventListener("hashchange", () => {
        // Réinitialiser les boutons lors d'un changement de page
        ButtonManager.removeAllButtons();
        setTimeout(tryAddButton, CONFIG.RETRY_DELAY);
      });

      // Vérification périodique
      setInterval(() => {
        if (
          !STATE.buttonAdded ||
          !document.querySelector(".wintchess-button")
        ) {
          tryAddButton();
        }
      }, CONFIG.BUTTON_CHECK_INTERVAL);
    }
  }

  function getLichessPageInfo() {
    const pathParts = window.location.pathname
      .split("/")
      .filter((p) => p.length > 0);
    let gameId = null;
    let studyId = null;
    let isRelevantPage = false;

    if (pathParts.length > 0) {
      // Page de jeu (format: /abc12345)
      if (/^[a-zA-Z0-9]{8,}$/.test(pathParts[0])) {
        isRelevantPage = true;
        gameId = pathParts[0];
      }
      // Page d'étude (format: /study/abc12345/chapitreXYZ)
      else if (pathParts[0] === "study" && pathParts.length >= 2) {
        isRelevantPage = true;
        studyId = pathParts[1];
      }
      // Page d'analyse
      else if (pathParts[0] === "analysis") {
        isRelevantPage = true;
      }
    }

    return { isRelevantPage, gameId, studyId };
  }

  function setupMutationObserver(callback) {
    if (STATE.observer) {
      STATE.observer.disconnect();
    }

    // Création d'une fonction de callback
    const optimizedCallback = debounce((mutationsList) => {
      if (document.querySelector(".wintchess-button")) return;

      const hasRelevantChanges = mutationsList.some(
        (m) =>
          (m.type === "childList" && m.addedNodes.length > 0) ||
          (m.type === "attributes" && isRelevantElement(m.target)),
      );

      if (hasRelevantChanges) {
        callback();
      }
    }, CONFIG.DEBOUNCE_DELAY);

    STATE.observer = new MutationObserver(optimizedCallback);

    STATE.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style", "id"],
    });
  }

  function isRelevantElement(element) {
    if (!element || !element.classList) return false;

    const relevantClasses = [
      "analyse__tools",
      "study__tools",
      "analyse__underboard",
      "puzzle__tools",
      "game-over-modal-content",
    ];

    return relevantClasses.some((cls) => element.classList.contains(cls));
  }

  async function getPgnFromLichess() {
    const pageInfo = getLichessPageInfo();

    if (!pageInfo.gameId) {
      console.log(
        "Impossible de récupérer le PGN: pas d'identifiant de partie détecté",
      );
      return null;
    }

    try {
      return await fetchPgnFromApi(pageInfo.gameId);
    } catch (error) {
      console.error("Erreur lors de la récupération du PGN via API:", error);
      return null;
    }
  }

  function fetchPgnFromApi(gameId) {
    const apiUrl = `https://lichess.org/game/export/${gameId}?pgnInJson=false&moves=true&tags=true&clocks=false&evals=false&opening=false`;

    return new Promise((resolve, reject) => {
      // Remplaçement de GM_xmlhttpRequest par une communication avec le background script
      chrome.runtime.sendMessage(
        { action: "fetchPgn", url: apiUrl },
        response => {
          if (response && response.success) {
            resolve(response.data.trim());
          } else {
            reject(response ? response.error : "Erreur de communication");
          }
        }
      );
    });
  }

  // Fonction réutilisable pour créer un bouton
  function createButton(options) {
    const { className, style, innerHTML, onClick } = options;

    const button = document.createElement("button");
    button.className = className + " wintchess-button";
    button.style.cssText = style;
    button.innerHTML = innerHTML;

    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      button.disabled = true;

      const textElement = button.querySelector(".button-text") || button;
      const originalText = textElement.textContent;
      textElement.textContent = "Récupération du PGN...";

      try {
        const pgn = await onClick();
        if (pgn) {
          await chromeStorage.setValue(CONFIG.PGN_STORAGE_KEY, pgn);
          // Ouvrir wintrchess dans un nouvel onglet via le background script
          chrome.runtime.sendMessage(
            { action: "openWintrChess", url: CONFIG.WINTRCHESS_URL }
          );
        } else {
          showNotification("Impossible de récupérer le PGN");
        }
      } catch (error) {
        console.error("Erreur:", error);
        showNotification("Erreur lors de la récupération du PGN");
      } finally {
        // Rétablir l'état du bouton
        setTimeout(() => {
          button.disabled = false;
          textElement.textContent = originalText;
        }, 1000);
      }
    });

    return button;
  }

  // Création de bouton Lichess
  function createLichessButton() {
    return createButton({
      className: "button button-metal",
      style: `
      display: block;
      width: calc(100% - 10px);
      margin: 8px auto;
      padding: 5px 10px;
    `,
      innerHTML: `<span class="button-text">${CONFIG.BUTTON_TEXT}</span>`,
      onClick: getPgnFromLichess,
    });
  }

  // Création de bouton Chess.com
  function createChessComButton() {
    return createButton({
      className:
        "cc-button-component cc-button-primary cc-button-xx-large cc-bg-primary cc-button-full",
      style: `
      margin-top: 8px;
      width: 100%;
      margin-bottom: 6px;
    `,
      innerHTML: `
      <span class="cc-icon-glyph cc-icon-large cc-button-icon">
        <svg viewBox="0 0 32 32" height="32" width="32" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
          <path d="M16 26.5c5.8 0 10.5-4.7 10.5-10.5S21.8 5.5 16 5.5 5.5 10.2 5.5 16 10.2 26.5 16 26.5M12 14l3 3h-2v4h6v-4h-2l3-3h-2V9h-4v5z"></path>
        </svg>
      </span>
      <span class="cc-button-one-line button-text">${CONFIG.BUTTON_TEXT}</span>
    `,
      onClick: getPgnFromChessCom,
    });
  }

  // Fonction pour créer un bouton pour la fenêtre modale de fin de partie
  function createGameOverWintrButton() {
    return createButton({
      className:
        "cc-button-component cc-button-primary cc-button-xx-large cc-bg-primary cc-button-full",
      style: `
        width: 100%;
        margin-top: 10px;
      `,
      innerHTML: `
        <span class="cc-icon-glyph cc-icon-large cc-button-icon">
            <svg viewBox="0 0 32 32" height="32" width="32" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
                <path d="M16 26.5c5.8 0 10.5-4.7 10.5-10.5S21.8 5.5 16 5.5 5.5 10.2 5.5 16 10.2 26.5 16 26.5M12 14l3 3h-2v4h6v-4h-2l3-3h-2V9h-4v5z"></path>
            </svg>
        </span>
        <span class="cc-button-one-line button-text">${CONFIG.BUTTON_TEXT}</span>
      `,
      onClick: getPgnFromChessCom,
    });
  }

  // Tente d'ajouter le bouton à la fenêtre modale de fin de partie
  function tryAddButtonToGameOverModal() {
    // Vérifier si la modale de fin de partie est présente
    const gameOverModal = document.querySelector(".game-over-modal-content");
    if (!gameOverModal) return false;

    // Si on a déjà ajouté notre bouton dans cette modale, ne rien faire
    if (gameOverModal.querySelector(".wintchess-button")) return true;

    // Chercher l'endroit idéal pour insérer notre bouton (juste après le bouton "Bilan de la partie")
    const reviewButtonContainer = gameOverModal.querySelector(
      ".game-over-review-button-component",
    );
    const gameOverButtons = gameOverModal.querySelector(
      ".game-over-modal-buttons",
    );

    if (reviewButtonContainer) {
      // Créer une copie du conteneur du bouton bilan pour notre bouton
      const wintrButtonContainer = document.createElement("div");
      wintrButtonContainer.className =
        "game-over-review-button-component wintchess-button-container";
      wintrButtonContainer.style.cssText = `
                margin-top: 10px;
            `;

      // Ajouter un label comme pour le bouton bilan
      const label = document.createElement("span");
      label.className = "game-over-review-button-label";
      label.textContent = CONFIG.BUTTON_TEXT;
      wintrButtonContainer.appendChild(label);

      // Créer notre bouton avec le style approprié
      const wintrButton = createGameOverWintrButton();
      wintrButton.classList.add("game-over-review-button-background");
      wintrButtonContainer.appendChild(wintrButton);

      // Insérer notre conteneur juste après celui du bouton bilan
      if (gameOverButtons) {
        // Insérer juste après le premier bouton et avant les boutons secondaires
        gameOverButtons.insertBefore(
          wintrButtonContainer,
          reviewButtonContainer.nextSibling,
        );
      } else {
        // Fallback: insérer après le bouton bilan s'il n'y a pas de conteneur de boutons
        reviewButtonContainer.parentNode.insertBefore(
          wintrButtonContainer,
          reviewButtonContainer.nextSibling,
        );
      }

      STATE.buttonAdded = true;
      return true;
    }

    return false;
  }

  // Notifications améliorées
  const showNotification = (() => {
    let currentNotification = null;

    return (message) => {
      // Supprimer toute notification existante
      if (currentNotification) {
        currentNotification.remove();
      }

      const notification = document.createElement("div");
      notification.textContent = message;
      notification.style.cssText = `
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      padding: 10px 20px;
      background-color: #333;
      color: white;
      border-radius: 4px;
      z-index: 10000;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
      opacity: 1;
      transition: opacity 0.5s ease;
    `;

      document.body.appendChild(notification);
      currentNotification = notification;

      setTimeout(() => {
        notification.style.opacity = "0";
        setTimeout(() => {
          notification.remove();
          if (currentNotification === notification) {
            currentNotification = null;
          }
        }, 500);
      }, 3000);
    };
  })();

  function tryAddButton(attempts = 0) {
    // Définir la plateforme
    STATE.platform = "lichess";

    return ButtonManager.addButton({
      id: "lichess_main",
      buttonCreator: createLichessButton,
      targets: ButtonManager.getTargets("lichess"),
      attempts,
      retryFn: tryAddButton,
    });
  }

  // ===== CHESS.COM FUNCTIONS =====

  function initChessCom() {
    const pageInfo = getChessComPageInfo();

    if (pageInfo.isRelevantPage) {
      STATE.platform = "chess.com";
      setupChessComMutationObserver(tryAddChessComButton);
      tryAddChessComButton();

      // Ajouter des points d'entrée supplémentaires pour s'assurer que le bouton est ajouté
      window.addEventListener("load", () =>
        setTimeout(tryAddChessComButton, CONFIG.RETRY_DELAY),
      );
      window.addEventListener("hashchange", () => {
        // Réinitialiser les boutons lors d'un changement de page
        ButtonManager.removeAllButtons();
        setTimeout(tryAddChessComButton, CONFIG.RETRY_DELAY);
      });

      // Vérification périodique
      setInterval(() => {
        if (
          !STATE.buttonAdded ||
          !document.querySelector(".wintchess-button")
        ) {
          tryAddChessComButton();
        }
      }, CONFIG.BUTTON_CHECK_INTERVAL);
    }
  }

  function getChessComPageInfo() {
    const path = window.location.pathname;
    let gameId = null;
    let isRelevantPage = false;

    // Partie live (format: /game/live/123456789)
    if (/^\/game\/live\/\d+/.test(path)) {
      isRelevantPage = true;
      gameId = path.split("/").pop();
    }
    // Partie daily/correspondance (format: /game/daily/123456789)
    else if (/^\/game\/daily\/\d+/.test(path)) {
      isRelevantPage = true;
      gameId = path.split("/").pop();
    }
    // Partie contre l'ordinateur (format: /game/computer/123456789)
    else if (/^\/game\/computer\/\d+/.test(path)) {
      isRelevantPage = true;
      gameId = path.split("/").pop();
    }
    // Page d'analyse
    else if (/^\/analysis/.test(path)) {
      isRelevantPage = true;
    }
    // Toute autre page de jeu
    else if (/^\/game\//.test(path)) {
      isRelevantPage = true;
    }

    return { isRelevantPage, gameId };
  }

  function setupChessComMutationObserver(callback) {
    if (STATE.observer) {
      STATE.observer.disconnect();
    }

    STATE.observer = new MutationObserver((mutationsList) => {
      // Ne rien faire si le bouton existe déjà
      if (STATE.buttonAdded && document.querySelector(".wintchess-button"))
        return;

      // Réinitialiser l'état si le bouton a disparu
      if (STATE.buttonAdded && !document.querySelector(".wintchess-button")) {
        STATE.buttonAdded = false;
      }

      // Vérifier la présence de la modale de fin de partie
      for (const m of mutationsList) {
        if (m.type === "childList" && m.addedNodes.length > 0) {
          for (const node of m.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE && node.querySelector) {
              if (
                node.querySelector(".game-over-modal-content") ||
                node.classList?.contains("game-over-modal-content")
              ) {
                setTimeout(() => tryAddButtonToGameOverModal(), 300);
                return;
              }
            }
          }
        }
      }
      callback();
    });

    STATE.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style", "id"],
    });
  }

  async function getPgnFromChessCom() {
    try {
      const pgn = await getPgnFromSharePanel();
      if (pgn) {
        return pgn;
      }
      throw new Error(
        "Impossible de récupérer le PGN depuis la page Chess.com",
      );
    } catch (error) {
      console.error("Erreur lors de l'extraction du PGN:", error);
      throw error;
    }
  }

  // Ouvre le panneau de partage et extrait le PGN
  const ButtonManager = (() => {
    const buttonCache = {};

    return {
      addButton({
        id = "default",
        buttonCreator,
        targets,
        attempts = 0,
        retryFn = null,
        checkExisting = true,
      }) {
        // Fonction qui sera rappelée si besoin de réessayer
        const actualRetryFn =
          retryFn ||
          ((newAttempts) => {
            return this.addButton({
              id,
              buttonCreator,
              targets,
              attempts: newAttempts,
              retryFn,
            });
          });

        // Vérifier si le bouton existe déjà
        if (
          checkExisting &&
          STATE.buttonAdded &&
          document.querySelector(".wintchess-button")
        ) {
          return true;
        }

        // Réinitialiser l'état si le bouton a disparu
        if (STATE.buttonAdded && !document.querySelector(".wintchess-button")) {
          STATE.buttonAdded = false;
          delete buttonCache[id];
        }

        // Attendre que la page soit bien chargée pour éviter d'insérer le bouton trop tôt
        if (document.readyState !== "complete" && attempts < 5) {
          setTimeout(() => actualRetryFn(attempts + 1), CONFIG.RETRY_DELAY);
          return false;
        }

        // Créer ou récupérer le bouton du cache
        let button;
        if (buttonCache[id]) {
          button = buttonCache[id];
        } else {
          button = buttonCreator();
          buttonCache[id] = button;
        }

        let inserted = false;

        // Trier les sélecteurs par priorité
        const sortedTargets = [...targets].sort(
          (a, b) => (b.priority || 0) - (a.priority || 0),
        );

        // Parcourir les sélecteurs par ordre de priorité
        for (const { selector, method } of sortedTargets) {
          const elements =
            selector instanceof Element
              ? [selector]
              : document.querySelectorAll(selector);

          if (elements.length > 0) {
            try {
              const element = elements[0];
              if (method === "append") {
                element.appendChild(button);
              } else if (method === "after") {
                element.parentNode.insertBefore(button, element.nextSibling);
              } else {
                element.insertAdjacentElement(method, button);
              }

              STATE.buttonAdded = true;
              STATE.buttonInstances[id] = { button, element, method };
              inserted = true;
              break;
            } catch (error) {
              console.error("Erreur lors de l'insertion du bouton:", error);
            }
          }
        }

        // Réessayer avec un délai exponentiel si échec
        if (!inserted) {
          if (attempts < CONFIG.MAX_ATTEMPTS - 1) {
            setTimeout(
              () => actualRetryFn(attempts + 1),
              Math.min(
                CONFIG.RETRY_DELAY * Math.pow(1.5, attempts),
                CONFIG.LONG_RETRY_DELAY,
              ),
            );
          } else {
            // Faire une pause plus longue avant de réessayer si on atteint le max d'essais
            setTimeout(() => actualRetryFn(0), CONFIG.LONG_RETRY_DELAY);
          }
          return false;
        }

        return true;
      },

      // Récupérer les sélecteurs appropriés selon la plateforme
      getTargets(platform = STATE.platform) {
        // Combiner les sélecteurs partagés avec ceux spécifiques à la plateforme
        if (platform === "lichess") {
          return [
            ...CONFIG.BUTTON_SELECTORS.SHARED,
            ...CONFIG.BUTTON_SELECTORS.LICHESS,
          ];
        } else if (platform === "chess.com") {
          return [
            ...CONFIG.BUTTON_SELECTORS.SHARED,
            ...CONFIG.BUTTON_SELECTORS.CHESS_COM,
          ];
        }
        // Si la plateforme n'est pas reconnue, retourner les sélecteurs partagés
        return CONFIG.BUTTON_SELECTORS.SHARED;
      },

      // Supprimer tous les boutons (utile lors des changements de page)
      removeAllButtons() {
        Object.values(STATE.buttonInstances).forEach(({ button }) => {
          if (button && button.parentNode) {
            button.parentNode.removeChild(button);
          }
        });
        STATE.buttonInstances = {};
        STATE.buttonAdded = false;
      },
    };
  })();

  async function getPgnFromSharePanel() {
    return new Promise((resolve) => {
      try {
        // 1. Ouvrir le panneau de partage
        const shareButtons = document.querySelectorAll(
          'button[aria-label="Share"], .icon-font-chess.share, [data-cy="share-button"]',
        );

        let shareClicked = false;
        for (const btn of shareButtons) {
          try {
            btn.click();
            shareClicked = true;
            break;
          } catch (e) {}
        }

        if (!shareClicked) {
          return resolve(null);
        }

        // Fonction pour fermer le panneau de partage
        const closeSharePanel = () => {
          try {
            const closeButton =
              document.querySelector(
                'button.cc-icon-button-component.cc-icon-button-large.cc-icon-button-ghost.cc-bg-ghost.cc-modal-header-close[aria-label="Fermer"]',
              ) ||
              document.querySelector(
                '.share-menu-close, button[aria-label="Close"], button[aria-label="Fermer"]',
              );

            if (closeButton) closeButton.click();
          } catch (e) {}
        };

        // 2. Attendre que le panneau apparaisse puis cliquer sur l'onglet PGN
        setTimeout(() => {
          const pgnButton = document.querySelector(
            'button.cc-tab-item-component#tab-pgn[aria-controls="tabpanel-pgn"]',
          );

          if (pgnButton) {
            pgnButton.click();

            // 3. Attendre que le contenu PGN apparaisse et l'extraire
            setTimeout(() => {
              try {
                const textarea = document.querySelector(
                  'textarea.cc-textarea-component.cc-textarea-x-large.share-menu-tab-pgn-textarea[aria-label="PGN"]',
                );

                const pgn = textarea?.value || null;
                closeSharePanel();
                resolve(pgn);
              } catch (error) {
                closeSharePanel();
                resolve(null);
              }
            }, 1000);
          } else {
            closeSharePanel();
            resolve(null);
          }
        }, 500);
      } catch (error) {
        setTimeout(() => closeSharePanel(), 500);
        resolve(null);
      }
    });
  }

  function tryAddChessComButton(attempts = 0) {
    STATE.platform = "chess.com";

    // Vérifier si nous sommes dans la modale de fin de partie (priorité la plus haute)
    if (tryAddButtonToGameOverModal()) {
      return true;
    }

    // Chercher d'abord le bouton 'Bilan de la partie' pour placer notre bouton juste après
    let bilanButton = findGameReviewButton();
    if (bilanButton && bilanButton.parentNode) {
      return ButtonManager.addButton({
        id: "chesscom_after_bilan",
        buttonCreator: createChessComButton,
        targets: [{ selector: bilanButton, method: "afterend", priority: 20 }],
        attempts,
        retryFn: (attempts) => tryAddChessComButton(attempts),
      });
    }

    // Si on ne trouve pas le bouton bilan, essayer les sélecteurs génériques
    return ButtonManager.addButton({
      id: "chesscom_main",
      buttonCreator: createChessComButton,
      targets: ButtonManager.getTargets("chess.com"),
      attempts,
      retryFn: tryAddChessComButton,
    });
  }

  function findGameReviewButton() {
    // Sélecteurs pour le bouton "Bilan de la partie"
    const bilanSelectors = [
      "button.cc-button-component.cc-button-primary.cc-button-xx-large.cc-bg-primary:not(.wintchess-button)",
      "button.cc-button-component.cc-button-primary:not(.wintchess-button)",
      "button.cc-button-component:not(.wintchess-button)",
      "button.cc-button-xx-large:not(.wintchess-button)",
      ".post-game-button button:not(.wintchess-button)",
      ".review-button button:not(.wintchess-button)",
      ".game-review-button button:not(.wintchess-button)",
    ];

    // Essayer de trouver un bouton qui contient un des termes
    const allButtons = document.querySelectorAll(bilanSelectors.join(", "));
    for (const btn of allButtons) {
      const btnText = btn.textContent.toLowerCase();
      if (
        CONFIG.BUTTON_SELECTORS.REVIEW_TERMS.some((term) =>
          btnText.includes(term),
        )
      ) {
        return btn;
      }
    }

    const similarButtons = document.querySelectorAll(
      "button.cc-button-component.cc-button-xx-large:not(.wintchess-button)",
    );
    return similarButtons.length > 0 ? similarButtons[0] : null;
  }

  // ===== WINTRCHESS FUNCTIONS =====

  function initWintrChess() {
    pasteAndAnalyze();
  }

  async function pasteAndAnalyze() {
    const pgnToPaste = await chromeStorage.getValue(CONFIG.PGN_STORAGE_KEY, null);

    if (pgnToPaste) {
      // Sélecteurs pour WintrChess
      const selectors = {
        textarea: "textarea.TerVPsT9aZ0soO8yjZU4",
        analyzeButton: "button.rHBNQrpvd7mwKp3HqjVQ.THArhyJIfuOy42flULV6",
        // Sélecteurs alternatifs pour tenir compte des changements potentiels de classes
        alternateTextarea: 'textarea[placeholder*="PGN"]',
        alternateButton:
          'button:not([disabled]):contains("Analyser"), button:not([disabled]):contains("Analyze")',
      };

      let attempts = 0;
      const maxAttempts = 20;
      const retryDelay = 500;

      const intervalId = setInterval(async () => {
        attempts++;

        // Tenter les différents sélecteurs
        const textarea =
          document.querySelector(selectors.textarea) ||
          document.querySelector(selectors.alternateTextarea);

        const analyzeButton =
          document.querySelector(selectors.analyzeButton) ||
          findButtonByText(["Analyser", "Analyze"]);

        if (textarea && analyzeButton) {
          clearInterval(intervalId);

          try {
            // Mettre le focus sur le textarea
            textarea.focus();
            await sleep(CONFIG.AUTO_PASTE_DELAY);

            // Définir directement la valeur
            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
              window.HTMLTextAreaElement.prototype,
              "value",
            ).set;
            nativeInputValueSetter.call(textarea, pgnToPaste);

            // Déclencher l'événement input pour simuler une saisie utilisateur
            textarea.dispatchEvent(new Event("input", { bubbles: true }));
            await sleep(CONFIG.AUTO_PASTE_DELAY * 2);

            // Retirer le focus
            textarea.blur();
            await sleep(CONFIG.AUTO_PASTE_DELAY);

            // Cliquer sur le bouton d'analyse
            analyzeButton.click();

            // Supprimer les données PGN du stockage après utilisation
            await chromeStorage.deleteValue(CONFIG.PGN_STORAGE_KEY);
          } catch (error) {
            console.error("Erreur lors du collage automatique:", error);
          }
        } else if (attempts >= maxAttempts) {
          clearInterval(intervalId);
          console.log(
            "Impossible de trouver les éléments nécessaires sur WintrChess après plusieurs tentatives.",
          );
        }
      }, retryDelay);
    }
  }

  // ===== HELPER FUNCTIONS =====

  function findButtonByText(textOptions) {
    // Fonction pour trouver un bouton par son texte
    for (const text of textOptions) {
      const elements = Array.from(
        document.querySelectorAll("button:not([disabled])")
      );
      for (const el of elements) {
        if (el.textContent.includes(text)) {
          return el;
        }
      }
    }
    return null;
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ===== BOOTSTRAP =====
  init();
})();
