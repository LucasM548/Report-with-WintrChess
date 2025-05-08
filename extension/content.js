(function () {
  "use strict";

  // Configuration
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
    SLOW_DEVICE_THRESHOLD: 50,
    BUTTON_SELECTORS: {
      REVIEW_TERMS: ["bilan", "review", "analysis", "analyser", "analyze"],
      SHARED: [
        {
          selector: ".game-over-modal-content", // Pour Chess.com, mais gardé comme partagé au cas où
          method: "append",
          priority: 20,
        },
      ],
      CHESS_COM: [
        { selector: ".board-controls-bottom", method: "append", priority: 15 },
        { selector: ".analysis-controls", method: "append", priority: 14 },
        { selector: ".board-controls", method: "append", priority: 13 },
        { selector: ".game-controls", method: "append", priority: 12 },
        { selector: ".post-game-controls", method: "append", priority: 11 },
      ],
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

  const STATE = {
    buttonAdded: false,
    observer: null,
    platform: null,
    buttonInstances: new Map(),
    isSlowDevice: false,
    performanceFactor: 1,
  };

  function detectDevicePerformance() {
    const startTime = performance.now();
    let counter = 0;
    for (let i = 0; i < 1000000; i++) {
      counter++;
    }
    const endTime = performance.now();
    const duration = endTime - startTime;

    if (duration > CONFIG.SLOW_DEVICE_THRESHOLD) {
      STATE.isSlowDevice = true;
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
    setValue: (key, value) =>
      new Promise((resolve) =>
        chrome.storage.local.set({ [key]: value }, resolve)
      ),
    getValue: (key, defaultValue) =>
      new Promise((resolve) =>
        chrome.storage.local.get([key], (result) =>
          resolve(result[key] === undefined ? defaultValue : result[key])
        )
      ),
    deleteValue: (key) =>
      new Promise((resolve) => chrome.storage.local.remove(key, resolve)),
  };

  function init() {
    detectDevicePerformance();
    const hostname = window.location.hostname;

    if (hostname === "lichess.org") {
      initializePlatformSpecificLogic("lichess", getLichessPageInfo);
    } else if (hostname === "www.chess.com") {
      initializePlatformSpecificLogic("chess.com", getChessComPageInfo);
    } else if (hostname === "wintrchess.com") {
      initWintrChess();
    }
  }

  // ===== INITIALISATION GÉNÉRALISÉE POUR LES PLATEFORMES =====
  function initializePlatformSpecificLogic(platformName, getPageInfoFn) {
    const pageInfo = getPageInfoFn();

    if (pageInfo.isRelevantPage) {
      STATE.platform = platformName; // Assurer que STATE.platform est défini tôt

      DomObserverManager.setupObserver(
        () => tryAddButton(platformName),
        platformName
      );

      tryAddButton(platformName); // Premier essai

      const debouncedTryAddButton = Utils.debounce(
        () => tryAddButton(platformName),
        CONFIG.RETRY_DELAY
      );

      window.addEventListener("load", debouncedTryAddButton);
      window.addEventListener("hashchange", () => {
        ButtonManager.removeAllButtons();
        debouncedTryAddButton();
      });

      const periodicCheck = setInterval(() => {
        if (document.visibilityState === "hidden") return;

        // Si le bouton n'est pas visible ou a été retiré, essayer de le rajouter
        // tryAddButton gère les cas spécifiques comme la modal de fin de partie pour chess.com
        if (
          !STATE.buttonAdded ||
          !document.querySelector(".wintchess-button")
        ) {
          tryAddButton(platformName);
        }
      }, CONFIG.BUTTON_CHECK_INTERVAL);

      window.addEventListener("beforeunload", () => {
        clearInterval(periodicCheck);
        DomObserverManager.disconnectExisting();
        ButtonManager.removeAllButtons(); // S'assurer que tout est nettoyé
      });
    }
  }

  // ===== LICHESS FUNCTIONS =====
  function getLichessPageInfo() {
    const pathParts = window.location.pathname
      .split("/")
      .filter((p) => p.length > 0);
    let gameId = null;
    let studyId = null;
    let isRelevantPage = false;

    if (pathParts.length > 0) {
      if (/^[a-zA-Z0-9]{8,}$/.test(pathParts[0])) {
        isRelevantPage = true;
        gameId = pathParts[0];
      } else if (pathParts[0] === "study" && pathParts.length >= 2) {
        isRelevantPage = true;
        studyId = pathParts[1];
        // Note: PgnExtractor.fromLichess utilise gameId. Si les PGN d'études doivent être extraits,
        // il faudra ajuster PgnExtractor ou passer studyId.
      } else if (pathParts[0] === "analysis") {
        isRelevantPage = true;
      }
    }
    return { isRelevantPage, gameId, studyId };
  }

  // ===== CHESS.COM FUNCTIONS =====
  function getChessComPageInfo() {
    const path = window.location.pathname;
    let gameId = null;
    let isRelevantPage = false;
    let isReviewPage = false;

    if (/^\/game\/(live|daily|computer)\/\d+/.test(path)) {
      isRelevantPage = true;
      gameId = path.split("/").pop();
    } else if (/^\/analysis|^\/game\/|^\/play\/online/.test(path)) {
      isRelevantPage = true;
    }

    if (
      /^\/analysis\/game\/(live|daily|computer)|^\/game-report|^\/analysis\/game-report/.test(
        path
      )
    ) {
      isReviewPage = true;
    }
    if (
      !isReviewPage &&
      document.querySelector(".game-report-section, .game-review-container")
    ) {
      isReviewPage = true;
    }
    return { isRelevantPage, gameId, isReviewPage };
  }

  const DomObserverManager = {
    relevantClassesByPlatform: {
      lichess: ["analyse__tools", "study__buttons", "analyse__controls"],
      "chess.com": [
        "board-controls",
        "game-controls",
        "post-game-controls",
        "game-over-modal-content",
        "analysis-controls",
        "modal-header-header",
      ],
    },
    relevantNodeNames: new Set(["chess-board"]),

    setupObserver(callback, platform = STATE.platform) {
      this.disconnectExisting();

      const platformRelevantClasses = new Set(
        this.relevantClassesByPlatform[platform] || []
      );

      const observerConfig = {
        childList: true,
        subtree: true,
        // Pour Lichess, les changements de classe sont importants pour certains conteneurs.
        // Pour Chess.com, on se fie plus aux ajouts de nœuds.
        attributes: platform === "lichess",
        attributeFilter: platform === "lichess" ? ["class"] : undefined,
      };

      const debouncedCallback = Utils.debounce(callback, CONFIG.DEBOUNCE_DELAY);

      const processedCallback = (mutationsList) => {
        // Éviter de traiter si un bouton existe DÉJÀ dans le cas général,

        let hasRelevantChanges = false;
        for (const mutation of mutationsList) {
          if (mutation.type === "childList" && mutation.addedNodes.length > 0) {
            for (const node of mutation.addedNodes) {
              if (node.nodeType === Node.ELEMENT_NODE) {
                const elem = node;
                if (
                  this.isElementOrContainsRelevant(
                    elem,
                    platformRelevantClasses
                  )
                ) {
                  hasRelevantChanges = true;
                  break;
                }
              }
            }
          } else if (
            mutation.type === "attributes" &&
            mutation.target.nodeType === Node.ELEMENT_NODE
          ) {
            if (
              this.isElementOrContainsRelevant(
                mutation.target,
                platformRelevantClasses
              )
            ) {
              hasRelevantChanges = true;
            }
          }
          if (hasRelevantChanges) break;
        }

        if (hasRelevantChanges) {
          debouncedCallback();
        }
      };

      STATE.observer = new MutationObserver(processedCallback);
      // Observer document.documentElement pour une couverture plus large, surtout pour les modales.
      STATE.observer.observe(document.documentElement, observerConfig);
      return STATE.observer;
    },

    disconnectExisting() {
      if (STATE.observer) {
        STATE.observer.disconnect();
        STATE.observer = null;
      }
    },

    // Vérifie si l'élément lui-même est pertinent ou s'il contient des enfants pertinents (utile pour les ajouts de subtree)
    isElementOrContainsRelevant(element, platformRelevantClasses) {
      if (!element || typeof element.matches !== "function") return false;

      // Vérifier l'élément lui-même
      if (this.isRelevantSingleElement(element, platformRelevantClasses))
        return true;

      // Vérifier les enfants (si l'élément ajouté est un conteneur)
      for (const cls of platformRelevantClasses) {
        if (element.querySelector(`.${cls.split(" ").join(".")}`)) return true;
      }
      for (const nodeName of this.relevantNodeNames) {
        if (element.querySelector(nodeName)) return true;
      }
      return false;
    },

    isRelevantSingleElement(element, platformRelevantClasses) {
      if (!element || !element.classList) return false;
      for (const className of platformRelevantClasses) {
        // Gérer les sélecteurs de classes multiples (ex: "analyse__controls .left-buttons")
        const classParts = className.split(" ");
        if (
          classParts.every((part) =>
            element.classList.contains(part.replace(".", ""))
          )
        ) {
          return true;
        }
      }
      if (this.relevantNodeNames.has(element.nodeName.toLowerCase())) {
        return true;
      }
      return false;
    },
  };

  const PgnExtractor = {
    _cache: new Map(),
    _cacheDuration: 60000,

    _setCacheWithExpiry(key, value) {
      if (!value) return;
      const cacheItem = { value, timestamp: Date.now() };
      this._cache.set(key, cacheItem);
      setTimeout(() => {
        if (this._cache.get(key) === cacheItem) this._cache.delete(key);
      }, this._cacheDuration);
    },

    _getFromCache(key) {
      const cacheItem = this._cache.get(key);
      if (
        !cacheItem ||
        Date.now() - cacheItem.timestamp > this._cacheDuration
      ) {
        if (cacheItem) this._cache.delete(key);
        return null;
      }
      return cacheItem.value;
    },

    async fromLichess() {
      const pageInfo = getLichessPageInfo();
      // Actuellement, utilise gameId. Pour les études, il faudrait utiliser studyId et une URL d'API différente.
      // Exemple: `https://lichess.org/study/${pageInfo.studyId}.pgn`
      if (!pageInfo.gameId && !pageInfo.studyId) {
        // Ajusté pour inclure studyId comme possibilité
        console.log(
          "[WintrChess] Impossible de récupérer le PGN: pas d'identifiant de partie/étude détecté"
        );
        return null;
      }

      // Pour l'instant, on priorise gameId s'il existe, sinon on pourrait adapter pour studyId
      const idToFetch = pageInfo.gameId || pageInfo.studyId;
      const isStudy = !pageInfo.gameId && pageInfo.studyId;

      const cacheKey = `lichess_${idToFetch}`;
      const cachedPgn = this._getFromCache(cacheKey);
      if (cachedPgn) {
        console.log("[WintrChess] PGN récupéré depuis le cache pour Lichess");
        return cachedPgn;
      }

      try {
        const pgn = await fetchPgnFromApi(idToFetch, isStudy);
        if (pgn) {
          this._setCacheWithExpiry(cacheKey, pgn);
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

    async fromChessCom() {
      const pageInfo = getChessComPageInfo();
      const cacheKey = `chesscom_${
        pageInfo.gameId || window.location.pathname
      }`;
      const cachedPgn = this._getFromCache(cacheKey);
      if (cachedPgn) {
        console.log("[WintrChess] PGN récupéré depuis le cache");
        return cachedPgn;
      }

      NotificationManager.show(
        STATE.isSlowDevice
          ? "Extraction du PGN en cours (appareil lent)..."
          : "Extraction du PGN en cours...",
        STATE.isSlowDevice ? 8000 : 3000
      );

      try {
        if (STATE.isSlowDevice) {
          await Utils.sleep(1000 * STATE.performanceFactor);
        }

        let pgn = null;
        let attempts = 0;
        const maxAttempts = STATE.isSlowDevice ? 3 : 2;

        while (!pgn && attempts < maxAttempts) {
          try {
            pgn = await getPgnFromSharePanel();
            if (!pgn && attempts < maxAttempts - 1) {
              const waitTime =
                1000 *
                (attempts + 1) *
                (STATE.isSlowDevice ? STATE.performanceFactor : 1);
              console.log(`[WintrChess] Nouvelle tentative dans ${waitTime}ms`);
              await Utils.sleep(waitTime);
            }
          } catch (err) {
            console.error(
              `[WintrChess] Erreur tentative ${attempts + 1}:`,
              err
            );
          } finally {
            attempts++;
          }
        }

        if (pgn) {
          this._setCacheWithExpiry(cacheKey, pgn);
          return pgn;
        }
        throw new Error(
          "Impossible de récupérer le PGN depuis la page Chess.com après plusieurs tentatives."
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
        throw error; // Re-throw pour que l'appelant puisse gérer
      }
    },
  };

  function fetchPgnFromApi(id, isStudy = false) {
    const apiUrl = isStudy
      ? `https://lichess.org/study/${id}.pgn?pgnInJson=false&moves=true&tags=true&clocks=false&evals=false&opening=false` // Adaptez les params si besoin pour les études
      : `https://lichess.org/game/export/${id}?pgnInJson=false&moves=true&tags=true&clocks=false&evals=false&opening=false`;

    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { action: "fetchPgn", url: apiUrl },
        (response) => {
          if (chrome.runtime.lastError) {
            return reject(chrome.runtime.lastError.message);
          }
          if (response && response.success) {
            resolve(response.data.trim());
          } else {
            reject(
              response
                ? response.error
                : "Erreur de communication avec le background script"
            );
          }
        }
      );
    });
  }

  const ButtonFactory = {
    create(options) {
      const { className, style, innerHTML, onClick } = options;
      const button = document.createElement("button");
      button.className = className + " wintchess-button"; // Toujours ajouter wintchess-button
      button.style.cssText = style;
      button.innerHTML = innerHTML;
      this.attachEventHandler(button, onClick);
      return button;
    },

    attachEventHandler(button, onClickHandler) {
      button.addEventListener("click", async (event) => {
        event.stopPropagation();
        event.preventDefault(); // Peut être utile pour éviter des comportements par défaut
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
            NotificationManager.show("Impossible de récupérer le PGN.");
          }
        } catch (error) {
          console.error(
            "[WintrChess] Erreur lors du clic sur le bouton:",
            error
          );
          NotificationManager.show(
            "Erreur: " + (error.message || "Impossible de récupérer le PGN.")
          );
        } finally {
          setTimeout(() => {
            if (button && button.isConnected) {
              // Vérifier si le bouton est toujours dans le DOM
              button.disabled = false;
              textElement.textContent = originalText;
            }
          }, 1000);
        }
      });
    },
  };

  const BUTTON_CONFIGS = {
    lichess: {
      className: "button button-metal",
      style: `display: block; width: calc(100% - 10px); margin: 8px auto; padding: 5px 10px;`,
      innerHTML: `<span class="button-text">${CONFIG.BUTTON_TEXT}</span>`,
    },
    chesscom: {
      className:
        "cc-button-component cc-button-primary cc-button-xx-large cc-bg-primary cc-button-full",
      style: `margin-top: 8px; width: 100%; margin-bottom: 6px;`,
      innerHTML: `<span class="cc-icon-glyph cc-icon-large cc-button-icon">${CHESS_ICON_SVG}</span><span class="cc-button-one-line button-text">${CONFIG.BUTTON_TEXT}</span>`,
    },
    gameOver: {
      // Spécifique à la modal de fin de partie de Chess.com
      className:
        "cc-button-component cc-button-primary cc-button-xx-large cc-bg-primary cc-button-full",
      style: `width: 100%; margin-top: 3px; margin-bottom: 6px;`,
      innerHTML: `<span class="cc-icon-glyph cc-icon-large cc-button-icon" style="flex-shrink: 0;">${CHESS_ICON_SVG}</span><span class="button-text" style="white-space: normal; overflow: visible; text-overflow: initial;">${CONFIG.BUTTON_TEXT}</span>`,
    },
  };

  function createWintrChessButton(type = STATE.platform) {
    const typeKey = type === "chess.com" ? "chesscom" : type;
    const config = BUTTON_CONFIGS[typeKey] || BUTTON_CONFIGS.lichess;

    const pgnSourcePlatform =
      type === "gameOver" ||
      type === "chesscom" ||
      STATE.platform === "chess.com"
        ? "chess.com"
        : "lichess";

    return ButtonFactory.create({
      ...config,
      onClick: () =>
        pgnSourcePlatform === "chess.com"
          ? PgnExtractor.fromChessCom()
          : PgnExtractor.fromLichess(),
    });
  }

  function tryAddButtonToGameOverModal() {
    const modalContent = document.querySelector(".game-over-modal-content");
    if (!modalContent) return false;

    const buttonId = "chesscom_gameover_modal";
    if (
      STATE.buttonInstances.has(buttonId) &&
      document.contains(STATE.buttonInstances.get(buttonId).button)
    ) {
      return true;
    }

    const buttonList = modalContent.querySelector(".game-over-modal-buttons");
    if (!buttonList) return false;

    // Vérifier si le bouton physique existe déjà (au cas où il n'est pas dans buttonInstances)
    if (
      buttonList.querySelector(
        ".wintchess-button-container.game-over-review-button-component .wintchess-button"
      )
    ) {
      return true;
    }

    try {
      const bilanContainer = buttonList.querySelector(
        ".game-over-review-button-component"
      );
      const button = createWintrChessButton("gameOver");
      const buttonContainer = document.createElement("div");
      buttonContainer.className =
        "wintchess-button-container game-over-review-button-component"; // Utiliser la même classe pour le style
      buttonContainer.appendChild(button);

      let insertionPoint = null;
      let referenceNode = null;

      if (bilanContainer) {
        insertionPoint = bilanContainer.parentElement;
        referenceNode = bilanContainer.nextSibling;
      } else {
        const bilanLabel = Array.from(
          buttonList.querySelectorAll(".game-over-review-button-label, span")
        ).find((span) =>
          CONFIG.BUTTON_SELECTORS.REVIEW_TERMS.some((term) =>
            span.textContent.toLowerCase().includes(term)
          )
        );

        if (bilanLabel) {
          const parentContainer =
            bilanLabel.closest("div") || bilanLabel.parentElement;
          if (parentContainer && parentContainer.parentElement) {
            insertionPoint = parentContainer.parentElement;
            referenceNode = parentContainer.nextSibling;
          }
        }
      }

      if (!insertionPoint) {
        insertionPoint = buttonList;
        referenceNode = buttonList.firstChild; // Insérer au début si aucune référence trouvée
      }

      if (insertionPoint) {
        insertionPoint.insertBefore(buttonContainer, referenceNode);
        STATE.buttonInstances.set(buttonId, {
          button: buttonContainer,
          element: insertionPoint,
          method: "insertBefore",
        });
        STATE.buttonAdded = true;
        return true;
      }
      return false;
    } catch (error) {
      console.error(
        "[WintrChess] Erreur lors de l'ajout du bouton à la modale:",
        error
      );
      return false;
    }
  }

  const NotificationManager = (() => {
    let activeNotification = null;
    let timerId = null;
    const Z_INDEX = "2147483647";

    return {
      show(message, duration = 3000) {
        this.clear();
        activeNotification = document.createElement("div");
        activeNotification.textContent = message;
        activeNotification.style.cssText = `
          position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
          padding: 10px 20px; background-color: #333; color: white;
          border-radius: 4px; z-index: ${Z_INDEX}; box-shadow: 0 2px 8px rgba(0,0,0,0.2);
          opacity: 1; transition: opacity 0.5s ease; font-family: sans-serif; font-size: 14px;`;
        document.body.appendChild(activeNotification);
        timerId = setTimeout(() => this.hide(), duration);
      },
      hide() {
        if (!activeNotification) return;
        activeNotification.style.opacity = "0";
        setTimeout(() => this.clear(), 500); // Attendre la fin de la transition
      },
      clear() {
        if (timerId) clearTimeout(timerId);
        timerId = null;
        if (activeNotification && activeNotification.parentNode) {
          activeNotification.parentNode.removeChild(activeNotification);
        }
        activeNotification = null;
      },
    };
  })();

  function tryAddButton(platform, attempts = 0) {
    if (!STATE.platform) STATE.platform = platform;

    if (platform === "chess.com") {
      const pageInfo = getChessComPageInfo();
      if (pageInfo.isReviewPage) {
        ButtonManager.removeAllButtons();
        return false;
      }
      // Tenter d'ajouter à la modale de fin de partie en priorité
      if (tryAddButtonToGameOverModal()) {
        return true;
      }
      if (STATE.buttonInstances.has("chesscom_gameover_modal")) {
        ButtonManager.removeButtonById("chesscom_gameover_modal");
      }
    }

    // Pour chess.com, après avoir géré la modal, on cherche le bouton "Bilan"
    // mais on pourrait avoir une target prioritaire pour se placer après le bouton "Bilan".
    let targets = ButtonManager.getTargets(platform);

    if (platform === "chess.com") {
      const bilanButton = findGameReviewButton();
      if (bilanButton && bilanButton.parentNode) {
        // Ajouter une cible prioritaire pour se placer après le bouton Bilan
        targets = [
          { element: bilanButton, method: "afterend", priority: 100 },
          ...targets,
        ];
      }
    }

    const buttonId =
      platform === "chess.com" ? "chesscom_main" : "lichess_main";

    return ButtonManager.addButton({
      id: buttonId,
      buttonCreator: () => createWintrChessButton(platform),
      targets: targets,
      attempts: attempts,
      retryFn: (newAttempts) => tryAddButton(platform, newAttempts),
    });
  }

  const ButtonManager = (() => {
    const buttonCache = new Map();
    const targetCache = new Map();

    const getRetryDelay = (attempts) =>
      Math.min(
        CONFIG.RETRY_DELAY * Math.pow(1.5, attempts),
        CONFIG.LONG_RETRY_DELAY
      );

    return {
      addButton({
        id = "default",
        buttonCreator,
        targets,
        attempts = 0,
        retryFn,
        checkExisting = true,
      }) {
        const actualRetryFn =
          retryFn ||
          ((newAttempts) =>
            this.addButton({
              id,
              buttonCreator,
              targets,
              attempts: newAttempts,
              retryFn,
              checkExisting,
            }));

        // Si le bouton spécifique à cet ID est déjà ajouté et dans le DOM, ne rien faire.
        const existingInstance = STATE.buttonInstances.get(id);
        if (
          checkExisting &&
          existingInstance &&
          document.contains(existingInstance.button)
        ) {
          STATE.buttonAdded = true; // S'assurer que l'état global est correct
          return true;
        }

        if (existingInstance && !document.contains(existingInstance.button)) {
          STATE.buttonInstances.delete(id);
          buttonCache.delete(id);
        }

        if (document.readyState !== "complete" && attempts < 5) {
          setTimeout(() => actualRetryFn(attempts + 1), CONFIG.RETRY_DELAY / 2); // Essai plus rapide si doc pas prêt
          return false;
        }

        let button = buttonCache.get(id);
        if (!button || !document.contains(button)) {
          // Recréer si pas en cache ou plus dans le DOM
          button = buttonCreator();
          buttonCache.set(id, button);
        }

        if (this.insertButton(id, button, targets)) {
          STATE.buttonAdded = true;
          return true;
        }

        if (attempts < CONFIG.MAX_ATTEMPTS - 1) {
          setTimeout(
            () => actualRetryFn(attempts + 1),
            getRetryDelay(attempts)
          );
        } else {
          console.warn(
            `[WintrChess] Max attempts reached for button ${id}. Resetting after long delay.`
          );
          setTimeout(() => actualRetryFn(0), CONFIG.LONG_RETRY_DELAY * 2); // Pause plus longue avant de reset
        }
        return false;
      },

      insertButton(id, button, targets) {
        let sortedTargets = targetCache.get(JSON.stringify(targets)); // Clé de cache basée sur les targets
        if (!sortedTargets) {
          sortedTargets = [...targets].sort(
            (a, b) => (b.priority || 0) - (a.priority || 0)
          );
          targetCache.set(JSON.stringify(targets), sortedTargets);
        }

        for (const targetConfig of sortedTargets) {
          const { selector, method, element: predefinedElement } = targetConfig;
          let elementToAttachTo = null;

          if (predefinedElement && document.contains(predefinedElement)) {
            elementToAttachTo = predefinedElement;
          } else if (typeof selector === "string") {
            const elements = document.querySelectorAll(selector);
            if (elements.length > 0) {
              elementToAttachTo = elements[0]; // Prendre le premier trouvé
            }
          }

          if (!elementToAttachTo) continue;

          // Éviter d'ajouter si un bouton wintchess est déjà enfant direct ou frère direct
          if (
            method === "append" &&
            elementToAttachTo.querySelector(
              ":scope > .wintchess-button, :scope > .wintchess-button-container"
            )
          )
            continue;
          if (
            (method === "after" || method === "afterend") &&
            elementToAttachTo.nextElementSibling &&
            (elementToAttachTo.nextElementSibling.classList.contains(
              "wintchess-button"
            ) ||
              elementToAttachTo.nextElementSibling.classList.contains(
                "wintchess-button-container"
              ))
          )
            continue;

          try {
            if (method === "append") {
              elementToAttachTo.appendChild(button);
            } else if (method === "after" || method === "afterend") {
              elementToAttachTo.parentNode.insertBefore(
                button,
                elementToAttachTo.nextSibling
              );
            } else {
              // "beforebegin", "afterbegin"
              elementToAttachTo.insertAdjacentElement(method, button);
            }
            STATE.buttonInstances.set(id, {
              button,
              element: elementToAttachTo,
              method,
            });
            return true;
          } catch (error) {}
        }
        return false;
      },

      getTargets(platform = STATE.platform) {
        const cacheKey = `targets_${platform}`;
        if (targetCache.has(cacheKey)) return targetCache.get(cacheKey);

        let baseSelectors = CONFIG.BUTTON_SELECTORS.SHARED;
        if (platform === "lichess") {
          baseSelectors = baseSelectors.concat(CONFIG.BUTTON_SELECTORS.LICHESS);
        } else if (platform === "chess.com") {
          baseSelectors = baseSelectors.concat(
            CONFIG.BUTTON_SELECTORS.CHESS_COM
          );
        }

        let result = [];
        if (platform === "lichess") {
          result = [...CONFIG.BUTTON_SELECTORS.LICHESS];
        } else if (platform === "chess.com") {
          result = [
            ...CONFIG.BUTTON_SELECTORS.SHARED,
            ...CONFIG.BUTTON_SELECTORS.CHESS_COM,
          ];
        }

        targetCache.set(cacheKey, result);
        return result;
      },

      removeButtonById(id) {
        const instance = STATE.buttonInstances.get(id);
        if (instance && instance.button && instance.button.parentNode) {
          instance.button.parentNode.removeChild(instance.button);
        }
        STATE.buttonInstances.delete(id);
        buttonCache.delete(id);
        // Si c'est le dernier bouton, mettre à jour STATE.buttonAdded
        if (STATE.buttonInstances.size === 0) {
          STATE.buttonAdded = false;
        }
      },

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
    // Spécifique à Chess.com
    return new Promise((resolve, reject) => {
      const getDelay = (baseDelay) =>
        STATE.isSlowDevice
          ? baseDelay * Math.max(1.5, STATE.performanceFactor)
          : baseDelay;

      const closeSharePanel = () => {
        try {
          const closeButton = document.querySelector(
            'button.cc-modal-header-close[aria-label="Fermer"], .share-menu-close, button[aria-label="Close"]'
          );
          if (closeButton) closeButton.click();
        } catch (e) {
          /* console.warn("[WintrChess] Erreur fermeture panneau:", e.message); */
        }
      };

      const clickElementWithRetry = async (
        selectors,
        description,
        maxAttempts = 5,
        attemptDelay = 500
      ) => {
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          for (const selector of selectors) {
            const element =
              typeof selector === "string"
                ? document.querySelector(selector)
                : selector.findFn
                ? selector.findFn()
                : null;
            if (element) {
              try {
                element.click();
                return true;
              } catch (e) {}
            }
          }
          if (attempt < maxAttempts - 1) {
            await Utils.sleep(getDelay(attemptDelay));
          }
        }
        console.error(
          `[WintrChess] Échec: ${description} non trouvé/cliquable après ${maxAttempts} tentatives.`
        );
        return false;
      };

      const extractPgnValue = async (maxAttempts = 5, attemptDelay = 500) => {
        const textareaSelectors = [
          'textarea.cc-textarea-component.cc-textarea-x-large.share-menu-tab-pgn-textarea[aria-label="PGN"]',
          'textarea[aria-label="PGN"]',
          "textarea.share-menu-tab-pgn-textarea",
          "textarea.cc-textarea-component",
          "textarea",
        ];
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          for (const selector of textareaSelectors) {
            const textarea = document.querySelector(selector);
            if (
              textarea &&
              textarea.value &&
              textarea.value.includes("[Event")
            ) {
              return textarea.value;
            }
          }
          if (attempt < maxAttempts - 1) {
            await Utils.sleep(getDelay(attemptDelay));
          }
        }
        return null;
      };

      (async () => {
        let shareButtonSelectors = [
          'button[aria-label="Share"]',
          ".icon-font-chess.share",
          '[data-cy="share-button"]',
          "button.share-button",
          "button.game-controls-component__share",
          'button[title="Share"]',
          'button[title="Partager"]',
        ];
        if (STATE.isSlowDevice) {
          // Sélecteurs plus génériques pour appareils lents
          shareButtonSelectors.push({
            findFn: () =>
              Array.from(document.querySelectorAll("button")).find((btn) => {
                const text = btn.textContent?.toLowerCase() || "";
                return text.includes("share") || text.includes("partage");
              }),
          });
        }

        if (
          !(await clickElementWithRetry(
            shareButtonSelectors,
            "bouton de partage",
            STATE.isSlowDevice ? 8 : 5
          ))
        ) {
          return reject("Échec de l'ouverture du panneau de partage");
        }
        // Attente adaptative pour l'apparition du panneau
        await Utils.sleep(getDelay(STATE.isSlowDevice ? 1000 : 500));

        const pgnTabSelectors = [
          'button.cc-tab-item-component#tab-pgn[aria-controls="tabpanel-pgn"]',
          'button.cc-tab-item-component[aria-controls="tabpanel-pgn"]',
          'button[id*="pgn"]',
          'button[aria-controls*="pgn"]',
          "div.tabs button",
          "li.tab-pgn",
          ".share-menu-tabs .tab",
          {
            findFn: () =>
              Array.from(
                document.querySelectorAll(
                  ".share-menu-tab button, .cc-tabs-component button, .modal-tabs button, .tabs button, nav.tabs button, .tabs-component button"
                )
              ).find((btn) => btn.textContent?.toUpperCase().includes("PGN")),
          },
        ];
        if (
          !(await clickElementWithRetry(
            pgnTabSelectors,
            "onglet PGN",
            5,
            getDelay(500)
          ))
        ) {
          closeSharePanel();
          return reject("Onglet PGN non trouvé");
        }
        // Augmenter le délai d'attente pour le chargement du PGN
        await Utils.sleep(getDelay(STATE.isSlowDevice ? 1500 : 1000));

        const pgn = await extractPgnValue(5, getDelay(500));
        closeSharePanel();
        if (pgn) {
          resolve(pgn);
        } else {
          reject("Échec de l'extraction du PGN depuis le textarea");
        }
      })().catch((err) => {
        closeSharePanel(); // S'assurer que le panneau est fermé en cas d'erreur
        reject(err);
      });

      if (STATE.isSlowDevice) {
        NotificationManager.show(
          "Extraction PGN (appareil lent), veuillez patienter...",
          5000
        );
      }
    });
  }

  function findGameReviewButton() {
    // Spécifique à Chess.com
    const reviewTerms = CONFIG.BUTTON_SELECTORS.REVIEW_TERMS.map((term) =>
      term.toLowerCase()
    );
    // Sélecteurs spécifiques pour le bouton "Bilan", du plus précis au plus générique
    const selectors = [
      "button.game-over-review-button-component", // Modale de fin de partie
      ".game-over-buttons-component .button-with-icon-primary", // Autre cas de modale
      ".sidebar-buttons-container button.ui_v5-button-component.primary", // Barre latérale
      ".board-layout-sidebar .review-button-component button",
      ".layout-sidebar .review-button-component button", // Nouvelle interface
      // Sélecteurs plus génériques si les précédents échouent
      "button.cc-button-component.cc-button-primary.cc-button-xx-large.cc-bg-primary",
      "button.cc-button-component.cc-button-primary",
    ];

    for (const selector of selectors) {
      const buttons = document.querySelectorAll(
        selector + ":not(.wintchess-button)"
      ); // Exclure notre propre bouton
      for (const btn of buttons) {
        const btnText = btn.textContent?.toLowerCase() || "";
        const ariaLabel = btn.getAttribute("aria-label")?.toLowerCase() || "";
        if (
          reviewTerms.some(
            (term) => btnText.includes(term) || ariaLabel.includes(term)
          )
        ) {
          // Vérifier qu'il ne s'agit pas d'un bouton "Nouvelle partie" ou similaire
          if (
            !btnText.includes("new game") &&
            !btnText.includes("nouvelle partie")
          ) {
            return btn;
          }
        }
      }
    }
    // Fallback: prendre un bouton proéminent s'il correspond à un "bouton d'action principal"
    const prominentButton = document.querySelector(
      "button.cc-button-component.cc-button-xx-large:not(.wintchess-button), .post-game-buttons-component button:first-of-type:not(.wintchess-button)"
    );
    if (
      prominentButton &&
      reviewTerms.some((term) =>
        prominentButton.textContent?.toLowerCase().includes(term)
      )
    ) {
      return prominentButton;
    }
    return null;
  }

  // ===== WINTRCHESS FUNCTIONS =====
  function initWintrChess() {
    if (STATE.isSlowDevice) {
      NotificationManager.show(
        "Préparation de l'analyse (appareil lent)...",
        5000
      );
    }
    pasteAndAnalyzeWintrChess();
  }

  async function pasteAndAnalyzeWintrChess() {
    const pgnToPaste = await chromeStorage.getValue(
      CONFIG.PGN_STORAGE_KEY,
      null
    );
    if (!pgnToPaste) return;

    const selectorsConfig = [
      {
        textarea: "textarea.TerVPsT9aZ0soO8yjZU4",
        button: "button.rHBNQrpvd7mwKp3HqjVQ.THArhyJIfuOy42flULV6",
        priority: 3,
      },
      {
        textarea: 'textarea[placeholder*="PGN"]',
        buttonText: ["Analyser", "Analyze", "Analyze game"],
        priority: 2,
      },
      {
        textarea: "textarea",
        buttonText: ["Analyser", "Analyze", "Analyze game"],
        priority: 1,
      },
    ].sort((a, b) => b.priority - a.priority); // Trier par priorité

    let attempts = 0;
    const maxAttempts = 30;
    let delayMs = STATE.isSlowDevice ? 500 : 300;

    const findElements = () => {
      for (const sel of selectorsConfig) {
        const textarea = document.querySelector(sel.textarea);
        if (!textarea) continue;
        const button = sel.button
          ? document.querySelector(sel.button)
          : sel.buttonText
          ? findWintrChessButtonByText(sel.buttonText)
          : null;
        if (button) return { textarea, button };
      }
      return null;
    };

    const performPaste = async (textarea, button) => {
      try {
        textarea.focus();
        textarea.select();
        await Utils.sleep(100);

        // Utiliser l'affectation directe de valeur et les événements semble plus robuste
        textarea.value = pgnToPaste;
        textarea.dispatchEvent(
          new Event("input", { bubbles: true, cancelable: true })
        );
        textarea.dispatchEvent(
          new Event("change", { bubbles: true, cancelable: true })
        );
        await Utils.sleep(STATE.isSlowDevice ? 600 : 300); // Délai plus long si appareil lent

        if (!button.disabled) {
          button.click();
          await chromeStorage.deleteValue(CONFIG.PGN_STORAGE_KEY);
          return true;
        }
        return false;
      } catch (error) {
        console.error(
          "[WintrChess] Erreur lors du collage auto sur WintrChess:",
          error
        );
        return false;
      }
    };

    const attemptPasteRecursive = async () => {
      if (document.visibilityState === "hidden") {
        const onVisible = () => {
          if (document.visibilityState === "visible") {
            document.removeEventListener("visibilitychange", onVisible);
            setTimeout(attemptPasteRecursive, 500);
          }
        };
        document.addEventListener("visibilitychange", onVisible);
        return;
      }

      const elements = findElements();
      if (
        elements &&
        (await performPaste(elements.textarea, elements.button))
      ) {
        return; // Succès
      }

      attempts++;
      if (attempts >= maxAttempts) {
        console.warn(
          `[WintrChess] Impossible de coller le PGN sur WintrChess après ${maxAttempts} tentatives.`
        );
        NotificationManager.show(
          "Collage auto échoué. Veuillez coller le PGN manuellement.",
          5000
        );
        // Optionnel: copier le PGN dans le presse-papier pour l'utilisateur
        // if (navigator.clipboard && pgnToPaste) {
        //    await navigator.clipboard.writeText(pgnToPaste);
        //    NotificationManager.show("PGN copié dans le presse-papiers.", 3000);
        // }
        return;
      }

      delayMs = Math.min(delayMs * 1.2, CONFIG.LONG_RETRY_DELAY); // Augmentation plus douce
      setTimeout(attemptPasteRecursive, delayMs);
    };

    setTimeout(attemptPasteRecursive, STATE.isSlowDevice ? 800 : 500); // Délai initial
  }

  function findWintrChessButtonByText(textOptions) {
    // Renommé pour clarté
    const allButtons = Array.from(
      document.querySelectorAll("button:not([disabled])")
    );
    for (const text of textOptions) {
      const textLower = text.toLowerCase();
      const foundButton = allButtons.find((button) =>
        button.textContent?.toLowerCase().includes(textLower)
      );
      if (foundButton) return foundButton;
    }
    return null;
  }

  const Utils = {
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    debounce: (fn, delay) => {
      let timer = null;
      return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
      };
    },
  };

  // ===== BOOTSTRAP =====
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
