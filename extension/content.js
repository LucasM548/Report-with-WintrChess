(function () {
  "use strict";

  // Configuration
  // Contenu SVG réutilisable pour tous les boutons
  const CHESS_ICON_SVG = `<svg viewBox="0 0 32 32" height="32" width="32" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
    <path d="M16 26.5c5.8 0 10.5-4.7 10.5-10.5S21.8 5.5 16 5.5 5.5 10.2 5.5 16 10.2 26.5 16 26.5M12 14l3 3h-2v4h6v-4h-2l3-3h-2V9h-4v5z"></path>
  </svg>`;

  const CONFIG = {
    WINTRCHESS_URL: "https://wintrchess.com/",
    PGN_STORAGE_KEY: "wintrChessPgnToPaste",
    BUTTON_TEXT: "Analyser sur WintrChess",
    MAX_ATTEMPTS: 50,
    RETRY_DELAY: 1000,
    LONG_RETRY_DELAY: 3000,
    AUTO_PASTE_DELAY: 500,
    BUTTON_CHECK_INTERVAL: 5000,
    DEBOUNCE_DELAY: 500,
    SLOW_DEVICE_THRESHOLD: 50, // Seuil pour détecter un appareil lent (ms)
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

  // État global optimisé avec Map pour de meilleures performances
  const STATE = {
    buttonAdded: false,
    observer: null,
    lastAttemptTime: 0,
    platform: null,
    buttonInstances: new Map(),
    platformDetected: false,
    isSlowDevice: false,
    performanceFactor: 1,
  };

  // Détection des performances de l'appareil
  function detectDevicePerformance() {
    const startTime = performance.now();
    let counter = 0;

    // Test de performance simple
    for (let i = 0; i < 1000000; i++) {
      counter++;
    }

    const endTime = performance.now();
    const duration = endTime - startTime;

    // Si le test prend plus de X ms, considérer l'appareil comme lent
    if (duration > CONFIG.SLOW_DEVICE_THRESHOLD) {
      STATE.isSlowDevice = true;
      // Calculer un facteur de performance entre 1.5 et 5 en fonction de la lenteur
      STATE.performanceFactor = Math.min(5, Math.max(1.5, duration / 20));
      console.log(
        `[WintrChess] Appareil lent détecté. Facteur de performance: ${STATE.performanceFactor.toFixed(
          2
        )}`
      );
    } else {
      console.log(
        `[WintrChess] Appareil rapide détecté. Temps: ${duration.toFixed(2)}ms`
      );
    }

    return duration;
  }

  const chromeStorage = {
    setValue: (key, value) => {
      return new Promise((resolve) => {
        chrome.storage.local.set({ [key]: value }, resolve);
      });
    },
    getValue: (key, defaultValue) => {
      return new Promise((resolve) => {
        chrome.storage.local.get([key], (result) => {
          resolve(result[key] === undefined ? defaultValue : result[key]);
        });
      });
    },
    deleteValue: (key) => {
      return new Promise((resolve) => {
        chrome.storage.local.remove(key, resolve);
      });
    },
  };

  function init() {
    // Détection des performances avant tout
    detectDevicePerformance();

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
      const lichessPlatform = "lichess";

      DomObserverManager.setupObserver(
        () => tryAddButton(lichessPlatform),
        lichessPlatform
      );

      tryAddButton(lichessPlatform);

      const loadHandler = Utils.debounce(
        () => tryAddButton(lichessPlatform),
        CONFIG.RETRY_DELAY
      );
      window.addEventListener("load", loadHandler);

      window.addEventListener("hashchange", () => {
        ButtonManager.removeAllButtons();
        loadHandler();
      });

      const periodicCheck = setInterval(() => {
        if (document.visibilityState === "hidden") {
          return;
        }

        // Vérifier si le bouton existe toujours
        if (
          !STATE.buttonAdded ||
          !document.querySelector(".wintchess-button")
        ) {
          tryAddButton(lichessPlatform);
        }
      }, CONFIG.BUTTON_CHECK_INTERVAL);

      // Nettoyage lors de la fermeture de la page
      window.addEventListener("beforeunload", () => {
        clearInterval(periodicCheck);
        DomObserverManager.disconnectExisting();
      });
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

  const DomObserverManager = {
    // Tableau des éléments considérés comme pertinents par plateforme
    relevantClassesByPlatform: {
      lichess: ["analyse__tools"],
      "chess.com": [
        "board-controls",
        "game-controls",
        "post-game-controls",
        "game-over-modal-content",
        "analysis-controls",
      ],
    },

    relevantSelectors: null,
    relevantNodeNames: new Set(["chess-board"]),

    setupObserver(callback, platform = STATE.platform) {
      this.disconnectExisting();

      // Configuration des sélecteurs pertinents pour la plateforme
      this.relevantSelectors = new Set(
        this.relevantClassesByPlatform[platform] || []
      );

      // Définition de la configuration de l'observateur en fonction de la plateforme
      const observerConfig = {
        childList: true,
        subtree: true,
        attributes:
          platform === "lichess" // Ajouter les attributs uniquement pour Lichess
            ? {
                attributes: true,
                attributeFilter: ["class"],
              }
            : {},
      };

      let processedCallback;

      if (platform === "chess.com") {
        processedCallback = (mutations) => {
          let shouldCallback = false;
          let gameOverModalDetected = false;

          for (const mutation of mutations) {
            if (mutation.addedNodes.length) {
              for (const node of mutation.addedNodes) {
                if (node.nodeType === Node.ELEMENT_NODE) {
                  const elem = node;

                  if (
                    elem.classList &&
                    elem.classList.contains("game-over-modal-content")
                  ) {
                    gameOverModalDetected = true;
                    setTimeout(() => {
                      tryAddButtonToGameOverModal();
                    }, 300);
                  }

                  if (elem.classList) {
                    for (const cls of this.relevantSelectors) {
                      if (elem.classList.contains(cls)) {
                        shouldCallback = true;
                        break;
                      }
                    }

                    // Vérifier le nom du nœud
                    if (
                      this.relevantNodeNames.has(elem.nodeName.toLowerCase())
                    ) {
                      shouldCallback = true;
                    }
                  }
                }
              }
            }
          }
          if (shouldCallback && !gameOverModalDetected) {
            callback();
          }
        };
      } else {
        // Callback générique pour Lichess
        processedCallback = Utils.debounce((mutationsList) => {
          // Éviter de traiter si un bouton existe déjà
          if (document.querySelector(".wintchess-button")) return;

          const hasRelevantChanges = mutationsList.some(
            (mutation) =>
              (mutation.type === "childList" &&
                mutation.addedNodes.length > 0) ||
              (mutation.type === "attributes" &&
                this.isRelevantElement(mutation.target, platform))
          );

          if (hasRelevantChanges) {
            callback();
          }
        }, CONFIG.DEBOUNCE_DELAY);
      }

      // Création et démarrage de l'observateur
      STATE.observer = new MutationObserver(processedCallback);

      // Observer le document entier pour Chess.com, seulement le body pour Lichess
      const targetNode =
        platform === "chess.com" ? document.documentElement : document.body;

      STATE.observer.observe(targetNode, observerConfig);

      return STATE.observer;
    },

    disconnectExisting() {
      if (STATE.observer) {
        STATE.observer.disconnect();
        STATE.observer = null;
      }
    },

    isRelevantElement(element, platform) {
      if (!element || !element.classList) return false;

      // Vérifier les classes pertinentes
      for (const className of this.relevantSelectors) {
        if (element.classList.contains(className)) {
          return true;
        }
      }

      // Vérifier les noms de nœuds pertinents
      if (this.relevantNodeNames.has(element.nodeName.toLowerCase())) {
        return true;
      }

      return false;
    },
  };

  const PgnExtractor = {
    _cache: new Map(),
    _cacheDuration: 60000,

    // Efface une entrée du cache après un certain temps
    _setCacheWithExpiry(key, value) {
      if (!value) return;

      const cacheItem = {
        value,
        timestamp: Date.now(),
      };

      this._cache.set(key, cacheItem);

      setTimeout(() => {
        if (this._cache.has(key)) {
          this._cache.delete(key);
        }
      }, this._cacheDuration);
    },

    // Vérifie si une entrée du cache est encore valide
    _getFromCache(key) {
      const cacheItem = this._cache.get(key);

      if (!cacheItem) return null;

      // Vérifier si le cache est expiré
      const now = Date.now();
      if (now - cacheItem.timestamp > this._cacheDuration) {
        this._cache.delete(key);
        return null;
      }

      return cacheItem.value;
    },

    // Extraction pour Lichess
    async fromLichess() {
      const pageInfo = getLichessPageInfo();

      if (!pageInfo.gameId) {
        console.log(
          "[WintrChess] Impossible de récupérer le PGN: pas d'identifiant de partie détecté"
        );
        return null;
      }

      // Vérifier le cache d'abord
      const cacheKey = `lichess_${pageInfo.gameId}`;
      const cachedPgn = this._getFromCache(cacheKey);
      if (cachedPgn) {
        console.log("[WintrChess] PGN récupéré depuis le cache pour Lichess");
        return cachedPgn;
      }

      try {
        const pgn = await fetchPgnFromApi(pageInfo.gameId);
        if (pgn) {
          this._setCacheWithExpiry(cacheKey, pgn);
          console.log("[WintrChess] PGN pour Lichess mis en cache");
        }
        return pgn;
      } catch (error) {
        console.error(
          "[WintrChess] Erreur lors de la récupération du PGN via API Lichess:",
          error
        );
        return null;
      }
    },
  };

  // Méthode d'extraction depuis l'API Lichess
  function fetchPgnFromApi(gameId) {
    const apiUrl = `https://lichess.org/game/export/${gameId}?pgnInJson=false&moves=true&tags=true&clocks=false&evals=false&opening=false`;

    return new Promise((resolve, reject) => {
      // Communication avec le background script
      chrome.runtime.sendMessage(
        { action: "fetchPgn", url: apiUrl },
        (response) => {
          if (response && response.success) {
            resolve(response.data.trim());
          } else {
            reject(response ? response.error : "Erreur de communication");
          }
        }
      );
    });
  }

  // Factory pour la création de boutons
  const ButtonFactory = {
    create(options) {
      const { className, style, innerHTML, onClick } = options;

      const button = document.createElement("button");
      button.className = className + " wintchess-button";
      button.style.cssText = style;
      button.innerHTML = innerHTML;

      this.attachEventHandler(button, onClick);
      return button;
    },

    attachEventHandler(button, onClickHandler) {
      button.addEventListener("click", async (event) => {
        event.stopPropagation();
        button.disabled = true;

        const textElement = button.querySelector(".button-text") || button;
        const originalText = textElement.textContent;
        textElement.textContent = "Récupération du PGN...";

        try {
          const pgn = await onClickHandler();
          if (pgn) {
            await chromeStorage.setValue(CONFIG.PGN_STORAGE_KEY, pgn);
            chrome.runtime.sendMessage({
              action: "openWintrChess",
              url: CONFIG.WINTRCHESS_URL,
            });
          } else {
            NotificationManager.show("Impossible de récupérer le PGN");
          }
        } catch (error) {
          console.error("Erreur:", error);
          NotificationManager.show("Erreur lors de la récupération du PGN");
        } finally {
          // Restauration différée de l'état du bouton
          setTimeout(() => {
            button.disabled = false;
            textElement.textContent = originalText;
          }, 1000);
        }
      });
    },
  };

  // Configuration des styles et classes pour les boutons par type
  const BUTTON_CONFIGS = {
    lichess: {
      className: "button button-metal",
      style: `
      display: block;
      width: calc(100% - 10px);
      margin: 8px auto;
      padding: 5px 10px;
    `,
      innerHTML: `<span class="button-text">${CONFIG.BUTTON_TEXT}</span>`,
    },
    chesscom: {
      className:
        "cc-button-component cc-button-primary cc-button-xx-large cc-bg-primary cc-button-full",
      style: `
      margin-top: 8px;
      width: 100%;
      margin-bottom: 6px;
    `,
      innerHTML: `
      <span class="cc-icon-glyph cc-icon-large cc-button-icon">
        ${CHESS_ICON_SVG}
      </span>
      <span class="cc-button-one-line button-text">${CONFIG.BUTTON_TEXT}</span>
    `,
    },
    gameOver: {
      className:
        "cc-button-component cc-button-primary cc-button-xx-large cc-bg-primary cc-button-full",
      style: `
        width: 100%;
        margin-top: 3px;
        margin-bottom: 6px;
      `,
      innerHTML: `
        <span class="cc-icon-glyph cc-icon-large cc-button-icon" style="flex-shrink: 0;">
          ${CHESS_ICON_SVG}
        </span>
        <span class="button-text" style="white-space: normal; overflow: visible; text-overflow: initial;">${CONFIG.BUTTON_TEXT}</span>
      `,
    },
  };

  function createButton(type = STATE.platform) {
    const config =
      type === "gameOver"
        ? BUTTON_CONFIGS.gameOver
        : BUTTON_CONFIGS[type] || BUTTON_CONFIGS.lichess;

    return ButtonFactory.create({
      className: config.className,
      style: config.style,
      innerHTML: config.innerHTML,
      onClick: () => {
        const platform = STATE.platform || type.split("_")[0];
        return platform === "chess.com" ||
          type.includes("chess.com") ||
          type === "gameOver"
          ? PgnExtractor.fromChessCom()
          : PgnExtractor.fromLichess();
      },
    });
  }

  // Tente d'ajouter le bouton à la fenêtre modale de fin de partie
  function tryAddButtonToGameOverModal() {
    const modalContent = document.querySelector(".game-over-modal-content");

    if (!modalContent) {
      return false;
    }

    // Vérifier si le bouton existe déjà pour éviter les doublons
    const existingButton = modalContent.querySelector(".wintchess-button");
    if (existingButton) {
      return true;
    }

    // Trouver la liste de boutons et la zone où ajouter notre bouton
    const buttonList = modalContent.querySelector(".game-over-modal-buttons");
    if (!buttonList) {
      return false;
    }

    try {
      // Chercher directement le conteneur du bouton "Bilan"
      const bilanContainer = buttonList.querySelector(
        ".game-over-review-button-component"
      );

      // Créer notre bouton WintrChess
      const button = createButton("gameOver");
      const buttonContainer = document.createElement("div");
      buttonContainer.className =
        "wintchess-button-container game-over-review-button-component";
      buttonContainer.appendChild(button);

      if (bilanContainer) {
        // Insérer juste après le conteneur du bouton bilan
        if (bilanContainer.parentElement) {
          bilanContainer.parentElement.insertBefore(
            buttonContainer,
            bilanContainer.nextSibling
          );
        } else {
          // Cas improbable: le conteneur n'a pas de parent
          buttonList.appendChild(buttonContainer);
        }
      } else {
        // Si on ne trouve pas le conteneur du bouton bilan, essayer de trouver le texte
        const bilanLabel = Array.from(
          buttonList.querySelectorAll(".game-over-review-button-label, span")
        ).find((span) => {
          const text = span.textContent.toLowerCase();
          return CONFIG.BUTTON_SELECTORS.REVIEW_TERMS.some((term) =>
            text.includes(term)
          );
        });

        if (bilanLabel) {
          // Remonter jusqu'au conteneur parent
          const parentContainer =
            bilanLabel.closest("div") || bilanLabel.parentElement;
          if (parentContainer && parentContainer.parentElement) {
            parentContainer.parentElement.insertBefore(
              buttonContainer,
              parentContainer.nextSibling
            );
          } else {
            buttonList.appendChild(buttonContainer);
          }
        } else {
          // Si toujours pas trouvé, ajouter au début de la liste
          const firstChild = buttonList.firstChild;
          if (firstChild) {
            buttonList.insertBefore(buttonContainer, firstChild);
          } else {
            buttonList.appendChild(buttonContainer);
          }
        }
      }

      // Stocker l'instance de bouton pour pouvoir le nettoyer plus tard
      STATE.buttonInstances.set("gameOverModal", {
        button: buttonContainer,
        element: buttonList,
        method: "insertBefore",
      });

      STATE.buttonAdded = true;
      return true;
    } catch (error) {
      console.error("Erreur lors de l'ajout du bouton à la modale:", error);
      return false;
    }
  }

  // Gestionnaire de notifications
  const NotificationManager = (() => {
    let activeNotification = null;
    let timerId = null;

    return {
      show(message, duration = 3000) {
        this.clear();

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
        activeNotification = notification;

        timerId = setTimeout(() => this.hide(), duration);
      },

      hide() {
        if (!activeNotification) return;

        activeNotification.style.opacity = "0";
        setTimeout(() => this.clear(), 500);
      },

      clear() {
        if (timerId) {
          clearTimeout(timerId);
          timerId = null;
        }

        if (activeNotification) {
          if (activeNotification.parentNode) {
            activeNotification.parentNode.removeChild(activeNotification);
          }
          activeNotification = null;
        }
      },
    };
  })();

  function tryAddButton(platform = "lichess", attempts = 0) {
    STATE.platform = platform;

    if (platform === "chess.com") {
      const pageInfo = getChessComPageInfo();
      if (pageInfo.isReviewPage) {
        return false;
      }

      // Vérifier si nous sommes dans la modale de fin de partie (priorité la plus haute)
      if (tryAddButtonToGameOverModal()) {
        return true;
      }

      // Chercher d'abord le bouton 'Bilan de la partie' pour Chess.com
      let bilanButton = findGameReviewButton();
      if (bilanButton && bilanButton.parentNode) {
        return ButtonManager.addButton({
          id: "chesscom_after_bilan",
          buttonCreator: () => createButton("chesscom"),
          targets: [
            { selector: bilanButton, method: "afterend", priority: 20 },
          ],
          attempts,
          retryFn: (newAttempts) => tryAddButton(platform, newAttempts),
        });
      }
    }

    // Configuration commune pour toutes les plateformes
    const config = {
      id: platform === "chess.com" ? "chesscom_main" : "lichess_main",
      buttonCreator: () =>
        createButton(platform === "chess.com" ? "chesscom" : "lichess"),
      targets: ButtonManager.getTargets(platform),
      attempts,
      retryFn: (newAttempts) => tryAddButton(platform, newAttempts),
    };

    return ButtonManager.addButton(config);
  }

  // ===== CHESS.COM FUNCTIONS =====

  function initChessCom() {
    const pageInfo = getChessComPageInfo();

    if (pageInfo.isRelevantPage) {
      DomObserverManager.setupObserver(
        () => tryAddButton("chess.com"),
        "chess.com"
      );

      tryAddButton("chess.com");

      const loadHandler = Utils.debounce(
        () => tryAddButton("chess.com"),
        CONFIG.RETRY_DELAY
      );
      window.addEventListener("load", loadHandler);

      window.addEventListener("hashchange", () => {
        ButtonManager.removeAllButtons();
        loadHandler();
      });

      const periodicCheck = setInterval(() => {
        if (document.visibilityState === "hidden") {
          return;
        }

        // Vérification préliminaire rapide avant d'essayer d'ajouter le bouton
        const gameOverModal = document.querySelector(
          ".game-over-modal-content"
        );
        const hasButton = document.querySelector(".wintchess-button-container");

        // Si la modale de fin de partie est présente et que notre bouton n'y est pas
        if (gameOverModal && !hasButton) {
          tryAddButtonToGameOverModal();
        } else if (
          !STATE.buttonAdded ||
          !document.querySelector(".wintchess-button")
        ) {
          tryAddButton("chess.com");
        }
      }, CONFIG.BUTTON_CHECK_INTERVAL);

      // Nettoyage lors de la fermeture de la page
      window.addEventListener("beforeunload", () => {
        clearInterval(periodicCheck);
        DomObserverManager.disconnectExisting();
      });
    }
  }

  function getChessComPageInfo() {
    const path = window.location.pathname;
    let gameId = null;
    let isRelevantPage = false;
    let isReviewPage = false;

    // Vérification simplifiée des pages pertinentes avec une seule regex
    if (/^\/game\/(live|daily|computer)\/\d+/.test(path)) {
      isRelevantPage = true;
      gameId = path.split("/").pop();
    }
    // Autres pages pertinentes (analyse ou pages de jeu génériques)
    else if (/^\/analysis|^\/game\//.test(path)) {
      isRelevantPage = true;
    }

    // Détection simplifiée des pages de bilan avec une regex optimisée
    if (
      /^\/analysis\/game\/(live|daily|computer)|^\/game-report|^\/analysis\/game-report/.test(
        path
      )
    ) {
      isReviewPage = true;
    }

    // Vérification des éléments de la page (cette vérification reste nécessaire)
    if (
      !isReviewPage &&
      document.querySelector(".game-report-section, .game-review-container")
    ) {
      isReviewPage = true;
    }

    return { isRelevantPage, gameId, isReviewPage };
  }

  // Extraction pour Chess.com ajoutée au PgnExtractor
  Object.assign(PgnExtractor, {
    async fromChessCom() {
      const pageInfo = getChessComPageInfo();

      // Vérifier le cache d'abord
      const cacheKey = `chesscom_${
        pageInfo.gameId || window.location.pathname
      }`;
      const cachedPgn = this._getFromCache(cacheKey);
      if (cachedPgn) {
        console.log("[WintrChess] PGN récupéré depuis le cache");
        return cachedPgn;
      }

      if (STATE.isSlowDevice) {
        NotificationManager.show(
          "Extraction du PGN en cours sur un appareil lent. Veuillez patienter...",
          8000
        );
      } else {
        NotificationManager.show("Extraction du PGN en cours...", 3000);
      }

      try {
        // Si c'est un appareil lent, donner plus de temps à la page pour se stabiliser avant l'extraction
        if (STATE.isSlowDevice) {
          await new Promise((resolve) =>
            setTimeout(resolve, 1000 * STATE.performanceFactor)
          );
        }

        // Plusieurs tentatives d'extraction avec un temps d'attente croissant
        let pgn = null;
        let attempts = 0;
        const maxAttempts = STATE.isSlowDevice ? 3 : 2;

        while (!pgn && attempts < maxAttempts) {
          try {
            console.log(
              `[WintrChess] Tentative d'extraction PGN ${
                attempts + 1
              }/${maxAttempts}`
            );
            pgn = await getPgnFromSharePanel();

            if (!pgn && attempts < maxAttempts - 1) {
              // Attendre avant la prochaine tentative (temps d'attente croissant)
              const waitTime =
                1000 *
                (attempts + 1) *
                (STATE.isSlowDevice ? STATE.performanceFactor : 1);
              console.log(`[WintrChess] Nouvelle tentative dans ${waitTime}ms`);
              await new Promise((resolve) => setTimeout(resolve, waitTime));
            }
            attempts++;
          } catch (err) {
            console.error(
              `[WintrChess] Erreur tentative ${attempts + 1}:`,
              err
            );
            attempts++;
            if (attempts < maxAttempts) {
              await new Promise((resolve) => setTimeout(resolve, 1000));
            }
          }
        }

        if (pgn) {
          this._setCacheWithExpiry(cacheKey, pgn);
          return pgn;
        }
        throw new Error(
          "Impossible de récupérer le PGN depuis la page Chess.com"
        );
      } catch (error) {
        console.error(
          "[WintrChess] Erreur lors de l'extraction du PGN:",
          error
        );
        NotificationManager.show(
          "Erreur lors de l'extraction du PGN. Veuillez réessayer.",
          5000
        );
        throw error;
      }
    },
  });

  // Gestionnaire de boutons
  const ButtonManager = (() => {
    const buttonCache = new Map();
    const targetCache = new Map();
    const getRetryDelay = (attempts) => {
      return Math.min(
        CONFIG.RETRY_DELAY * Math.pow(1.5, attempts),
        CONFIG.LONG_RETRY_DELAY
      );
    };

    return {
      // Fonction d'ajout de bouton
      addButton({
        id = "default",
        buttonCreator,
        targets,
        attempts = 0,
        retryFn = null,
        checkExisting = true,
      }) {
        const actualRetryFn =
          retryFn ||
          ((newAttempts) => {
            return this.addButton({
              id,
              buttonCreator,
              targets,
              attempts: newAttempts,
              retryFn,
              checkExisting,
            });
          });

        // Vérification rapide de l'existence du bouton
        const buttonExists =
          checkExisting &&
          STATE.buttonAdded &&
          document.querySelector(".wintchess-button");

        if (buttonExists) {
          return true;
        }

        if (STATE.buttonAdded && !document.querySelector(".wintchess-button")) {
          STATE.buttonAdded = false;
          buttonCache.delete(id);
        }

        // Attendre que le DOM soit prêt avant d'insérer
        if (document.readyState !== "complete" && attempts < 5) {
          setTimeout(() => actualRetryFn(attempts + 1), CONFIG.RETRY_DELAY);
          return false;
        }

        // Création ou récupération du bouton depuis le cache
        let button = buttonCache.get(id);
        if (!button) {
          button = buttonCreator();
          buttonCache.set(id, button);
        }

        // Insertion du bouton
        if (this.insertButton(id, button, targets)) {
          return true;
        }

        // Stratégie de réessai
        if (attempts < CONFIG.MAX_ATTEMPTS - 1) {
          setTimeout(
            () => actualRetryFn(attempts + 1),
            getRetryDelay(attempts)
          );
        } else {
          // Réinitialiser les tentatives après une pause plus longue
          setTimeout(() => actualRetryFn(0), CONFIG.LONG_RETRY_DELAY);
        }

        return false;
      },

      insertButton(id, button, targets) {
        // Trier les sélecteurs par priorité (une seule fois par type de cible)
        let sortedTargets = targetCache.get(targets);
        if (!sortedTargets) {
          sortedTargets = [...targets].sort(
            (a, b) => (b.priority || 0) - (a.priority || 0)
          );
          targetCache.set(targets, sortedTargets);
        }

        for (const { selector, method } of sortedTargets) {
          try {
            const elements =
              selector instanceof Element
                ? [selector]
                : document.querySelectorAll(selector);

            if (!elements.length) continue;

            const element = elements[0];

            // Insérer le bouton selon la méthode appropriée
            if (method === "append") {
              element.appendChild(button);
            } else if (method === "after" || method === "afterend") {
              element.parentNode.insertBefore(button, element.nextSibling);
            } else {
              element.insertAdjacentElement(method, button);
            }

            // Mettre à jour l'état global
            STATE.buttonAdded = true;
            STATE.buttonInstances.set(id, { button, element, method });

            return true;
          } catch (error) {
            console.error("Erreur lors de l'insertion du bouton:", error);
          }
        }

        return false;
      },

      getTargets(platform = STATE.platform) {
        const cacheKey = `targets_${platform}`;
        if (targetCache.has(cacheKey)) {
          return targetCache.get(cacheKey);
        }

        let result;
        if (platform === "lichess") {
          result = [
            ...CONFIG.BUTTON_SELECTORS.SHARED,
            ...CONFIG.BUTTON_SELECTORS.LICHESS,
          ];
        } else if (platform === "chess.com") {
          result = [
            ...CONFIG.BUTTON_SELECTORS.SHARED,
            ...CONFIG.BUTTON_SELECTORS.CHESS_COM,
          ];
        } else {
          result = CONFIG.BUTTON_SELECTORS.SHARED;
        }

        targetCache.set(cacheKey, result);
        return result;
      },

      // Suppression des boutons
      removeAllButtons() {
        STATE.buttonInstances.forEach(({ button }) => {
          if (button && button.parentNode) {
            button.parentNode.removeChild(button);
          }
        });

        STATE.buttonInstances.clear();
        buttonCache.clear();
        STATE.buttonAdded = false;
      },
    };
  })();

  async function getPgnFromSharePanel() {
    return new Promise((resolve, reject) => {
      // Calculer les délais en fonction des performances de l'appareil
      const getDelay = (baseDelay) => {
        // Délai de base multiplié par le facteur de performance (min 1.5x sur PC lent)
        return STATE.isSlowDevice
          ? baseDelay * Math.max(1.5, STATE.performanceFactor)
          : baseDelay;
      };

      // Fonction pour fermer le panneau de partage
      const closeSharePanel = () => {
        try {
          const closeButton =
            document.querySelector(
              'button.cc-icon-button-component.cc-icon-button-large.cc-icon-button-ghost.cc-bg-ghost.cc-modal-header-close[aria-label="Fermer"]'
            ) ||
            document.querySelector(
              '.share-menu-close, button[aria-label="Close"], button[aria-label="Fermer"]'
            );

          if (closeButton) closeButton.click();
        } catch (e) {
          console.error(
            "[WintrChess] Erreur lors de la fermeture du panneau:",
            e
          );
        }
      };

      // Fonction récursive pour tenter d'ouvrir le panneau de partage
      const tryOpenSharePanel = (attempts = 0) => {
        const maxAttempts = 5;
        if (attempts >= maxAttempts) {
          console.error(
            `[WintrChess] Échec de l'ouverture du panneau de partage après ${maxAttempts} tentatives`
          );
          return reject("Échec de l'ouverture du panneau de partage");
        }

        console.log(
          `[WintrChess] Tentative ${
            attempts + 1
          }/${maxAttempts} d'ouverture du panneau de partage`
        );

        // Chercher tous les boutons de partage possibles
        const shareButtons = document.querySelectorAll(
          'button[aria-label="Share"], .icon-font-chess.share, [data-cy="share-button"]'
        );

        // Si PC lent, ajouter des sélecteurs plus génériques pour trouver le bouton de partage
        if (STATE.isSlowDevice) {
          const allButtons = Array.from(document.querySelectorAll("button"));
          const shareTextButtons = allButtons.filter((btn) => {
            const text = btn.textContent?.toLowerCase() || "";
            return text.includes("share") || text.includes("partage");
          });

          shareButtons.push(...shareTextButtons);
        }

        let shareClicked = false;
        for (const btn of shareButtons) {
          try {
            btn.click();
            shareClicked = true;
            break;
          } catch (e) {}
        }

        if (!shareClicked) {
          console.log(
            `[WintrChess] Bouton de partage non trouvé, nouvelle tentative dans ${getDelay(
              500
            )}ms`
          );
          setTimeout(() => tryOpenSharePanel(attempts + 1), getDelay(500));
          return;
        }

        // Attendre que le panneau apparaisse puis passer à l'étape suivante
        setTimeout(() => tryClickPgnTab(), getDelay(800));
      };

      // Fonction récursive pour cliquer sur l'onglet PGN
      const tryClickPgnTab = (attempts = 0) => {
        const maxAttempts = 5;
        if (attempts >= maxAttempts) {
          closeSharePanel();
          console.error(
            `[WintrChess] Onglet PGN non trouvé après ${maxAttempts} tentatives`
          );
          return reject("Onglet PGN non trouvé");
        }

        console.log(
          `[WintrChess] Tentative ${
            attempts + 1
          }/${maxAttempts} de cliquer sur l'onglet PGN`
        );

        // Recherche plus large de l'onglet PGN
        const pgnSelectors = [
          'button.cc-tab-item-component#tab-pgn[aria-controls="tabpanel-pgn"]',
          'button.cc-tab-item-component[aria-controls="tabpanel-pgn"]',
          'button.cc-tab-item-component:not([aria-selected="true"])',
          'button[id*="pgn"]',
          'button[aria-controls*="pgn"]',
        ];

        // Essayer tous les sélecteurs jusqu'à trouver un élément
        let pgnButton = null;
        for (const selector of pgnSelectors) {
          const el = document.querySelector(selector);
          if (el) {
            pgnButton = el;
            break;
          }
        }

        // Si aucun sélecteur ne fonctionne, chercher des boutons avec le texte "PGN"
        if (!pgnButton) {
          const allButtons = Array.from(document.querySelectorAll("button"));
          pgnButton = allButtons.find((btn) => {
            return btn.textContent?.includes("PGN");
          });
        }

        if (!pgnButton) {
          console.log(
            `[WintrChess] Onglet PGN non trouvé, nouvelle tentative dans ${getDelay(
              500
            )}ms`
          );
          setTimeout(() => tryClickPgnTab(attempts + 1), getDelay(500));
          return;
        }

        try {
          pgnButton.click();
          // Attendre que le contenu PGN apparaisse
          setTimeout(() => tryExtractPgn(), getDelay(1000));
        } catch (e) {
          console.error(
            "[WintrChess] Erreur lors du clic sur l'onglet PGN:",
            e
          );
          setTimeout(() => tryClickPgnTab(attempts + 1), getDelay(500));
        }
      };

      // Fonction récursive pour extraire le PGN
      const tryExtractPgn = (attempts = 0) => {
        const maxAttempts = 5;
        if (attempts >= maxAttempts) {
          closeSharePanel();
          console.error(
            `[WintrChess] Échec de l'extraction du PGN après ${maxAttempts} tentatives`
          );
          return reject("Échec de l'extraction du PGN");
        }

        console.log(
          `[WintrChess] Tentative ${
            attempts + 1
          }/${maxAttempts} d'extraction du PGN`
        );

        // Recherche élargie pour le textarea
        const textareaSelectors = [
          'textarea.cc-textarea-component.cc-textarea-x-large.share-menu-tab-pgn-textarea[aria-label="PGN"]',
          'textarea[aria-label="PGN"]',
          "textarea.share-menu-tab-pgn-textarea",
          "textarea.cc-textarea-component",
          "textarea",
        ];

        // Essayer tous les sélecteurs jusqu'à trouver un élément
        let textarea = null;
        for (const selector of textareaSelectors) {
          const el = document.querySelector(selector);
          if (el) {
            textarea = el;
            break;
          }
        }

        if (!textarea) {
          console.log(
            `[WintrChess] Textarea PGN non trouvé, nouvelle tentative dans ${getDelay(
              500
            )}ms`
          );
          setTimeout(() => tryExtractPgn(attempts + 1), getDelay(500));
          return;
        }

        try {
          const pgn = textarea.value || null;

          if (pgn && pgn.includes("[Event")) {
            closeSharePanel();
            resolve(pgn);
          } else {
            console.log(
              `[WintrChess] PGN invalide, nouvelle tentative dans ${getDelay(
                500
              )}ms`
            );
            setTimeout(() => tryExtractPgn(attempts + 1), getDelay(500));
          }
        } catch (error) {
          console.error(
            "[WintrChess] Erreur lors de l'extraction du PGN:",
            error
          );
          setTimeout(() => tryExtractPgn(attempts + 1), getDelay(500));
        }
      };

      // Commencer le processus
      if (STATE.isSlowDevice) {
        NotificationManager.show(
          "Extraction du PGN sur un appareil lent, veuillez patienter...",
          5000
        );
      }
      tryOpenSharePanel();
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
          btnText.includes(term)
        )
      ) {
        return btn;
      }
    }

    const similarButtons = document.querySelectorAll(
      "button.cc-button-component.cc-button-xx-large:not(.wintchess-button)"
    );
    return similarButtons.length > 0 ? similarButtons[0] : null;
  }

  // ===== WINTRCHESS FUNCTIONS =====

  function initWintrChess() {
    // Si l'appareil est lent, afficher une notification pour la patience
    if (STATE.isSlowDevice) {
      NotificationManager.show(
        "Appareil lent détecté, préparation de l'analyse...",
        5000
      );
    }
    pasteAndAnalyze();
  }

  // Fonction de collage et analyse sur WintrChess
  async function pasteAndAnalyze() {
    const pgnToPaste = await chromeStorage.getValue(
      CONFIG.PGN_STORAGE_KEY,
      null
    );
    if (!pgnToPaste) return;

    const selectors = [
      // Sélecteurs par classe spécifique (priorité la plus haute)
      {
        textarea: "textarea.TerVPsT9aZ0soO8yjZU4",
        button: "button.rHBNQrpvd7mwKp3HqjVQ.THArhyJIfuOy42flULV6",
        priority: 3,
      },
      // Sélecteurs par attribut (priorité moyenne)
      {
        textarea: 'textarea[placeholder*="PGN"]',
        button: "", // Sera trouvé par findButtonByText
        priority: 2,
      },
      // Sélecteurs génériques (priorité basse)
      {
        textarea: "textarea",
        button: "",
        priority: 1,
      },
    ];

    // Utilisation d'un limit rate pour ne pas surcharger l'interface
    const maxAttempts = 30;
    const initialDelay = 300;
    let attempts = 0;
    let delayMs = initialDelay;

    const findElements = () => {
      for (const sel of selectors) {
        const textarea = document.querySelector(sel.textarea);

        if (!textarea) continue;

        // Si un textarea est trouvé, chercher le bouton
        const button = sel.button
          ? document.querySelector(sel.button)
          : findButtonByText(["Analyser", "Analyze", "Analyze game"]);

        if (button) {
          return { textarea, button };
        }
      }

      return null;
    };

    // Fonction de collage du PGN
    const pastePgn = async (textarea, button) => {
      try {
        // 1. Focus et sélection du contenu existant
        textarea.focus();
        textarea.select();
        await Utils.sleep(100);

        // 2. Injection optimisée du PGN en utilisant le setter natif
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype,
          "value"
        ).set;

        nativeInputValueSetter.call(textarea, pgnToPaste);

        // 3. Déclencher les événements nécessaires pour activer le bouton
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
        textarea.dispatchEvent(new Event("change", { bubbles: true }));
        await Utils.sleep(300);

        // 4. Cliquer sur le bouton d'analyse
        if (!button.disabled) {
          button.click();

          // 5. Nettoyer le stockage après succès
          await chromeStorage.deleteValue(CONFIG.PGN_STORAGE_KEY);
          return true;
        }

        return false;
      } catch (error) {
        console.error("Erreur lors du collage automatique:", error);
        return false;
      }
    };

    // Fonction récursive avec backoff exponentiel
    const attemptPaste = async () => {
      // 1. Observer si la page est visible
      if (document.visibilityState === "hidden") {
        document.addEventListener(
          "visibilitychange",
          function checkVisibility() {
            if (document.visibilityState === "visible") {
              document.removeEventListener("visibilitychange", checkVisibility);
              setTimeout(attemptPaste, 500);
            }
          }
        );
        return;
      }

      // 2. Tentative de trouver les éléments nécessaires
      const elements = findElements();

      if (elements) {
        const success = await pastePgn(elements.textarea, elements.button);

        if (success) {
          return;
        }
      }

      // 3. Échec ou éléments non trouvés, réessayer?
      attempts++;

      if (attempts >= maxAttempts) {
        console.warn(
          `Impossible de coller le PGN après ${maxAttempts} tentatives.`
        );
        NotificationManager.show(
          "Impossible de coller automatiquement le PGN. Veuillez copier-coller manuellement."
        );
        return;
      }

      // Backoff exponentiel pour éviter de surcharger
      delayMs = Math.min(delayMs * 1.5, CONFIG.LONG_RETRY_DELAY);
      setTimeout(attemptPaste, delayMs);
    };

    // Démarrer le processus après un court délai pour laisser la page se charger
    setTimeout(attemptPaste, 500);
  }

  // Fonction pour trouver un bouton par son texte
  function findButtonByText(textOptions) {
    const allButtons = Array.from(
      document.querySelectorAll("button:not([disabled])")
    );

    for (const text of textOptions) {
      const textLower = text.toLowerCase();
      for (const button of allButtons) {
        if (button.textContent.toLowerCase().includes(textLower)) {
          return button;
        }
      }
    }
    return null;
  }

  const Utils = {
    sleep(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    },

    debounce(fn, delay) {
      let timer = null;
      return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
      };
    },
  };

  // ===== BOOTSTRAP =====
  init();
})();
