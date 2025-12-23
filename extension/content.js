(function () {
  "use strict";

  // --- UTILITIES & HELPERS ---
  /**
   * Utility functions for common operations:
   * 
   * - sleep(ms): Returns a promise that resolves after a specified delay.
   * - debounce(fn, delay): Returns a debounced version of the function that will postpone its execution until after a delay.
   * - getMsg(messageKey, substitutions): Retrieves a localized message using a message key and optional substitutions.
   * - getElementInnerText(element): Recursively extracts and returns the inner text of an HTML element, excluding script and style tags.
   */
  const Utils = {
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    debounce: (fn, delay) => {
      let timer = null;
      return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
      };
    },
    getMsg: (messageKey, substitutions) => {
      try {
        return chrome.i18n.getMessage(messageKey, substitutions) || messageKey;
      } catch (e) {
        console.warn(
          `[WintrChess] Missing/Error for i18n key: ${messageKey}`,
          e
        );
        if (typeof substitutions === "string")
          return `${messageKey} (${substitutions})`;
        if (Array.isArray(substitutions))
          return `${messageKey} (${substitutions.join(", ")})`;
        return messageKey;
      }
    },
    getElementInnerText: (element) => {
      if (!element) return "";
      let text = "";
      if (element.childNodes && element.childNodes.length > 0) {
        for (const child of element.childNodes) {
          if (child.nodeType === Node.TEXT_NODE) {
            text += child.textContent;
          } else if (child.nodeType === Node.ELEMENT_NODE) {
            if (child.tagName !== "SCRIPT" && child.tagName !== "STYLE") {
              text += Utils.getElementInnerText(child);
            }
          }
        }
      } else if (element.textContent) {
        text = element.textContent;
      }
      return text.trim().replace(/\s+/g, " ");
    },
  };

  // --- CONFIGURATION ---
  const CONFIG = {
    WINTRCHESS_URL: "https://wintrchess.com/",
    PGN_STORAGE_KEY: "wintrChessPgnToPaste",
    BUTTON_TEXT_KEY: "buttonTextAnalyzeWintrChess",
    RETRY_DELAY: 1000,
    LONG_RETRY_DELAY: 3000,
    DEBOUNCE_DELAY: 250,
    BUTTON_CHECK_INTERVAL: 5000,
    SLOW_DEVICE_THRESHOLD: 50,
    BUTTON_SELECTORS: {
      REVIEW_TERMS: [
        "Game Review", // English
        "Отчет о партии", // Russian
        "Bilan de la partie", // French
        "Partieanalyse", // German
        "Revisión de partida", // Spanish
        "खेल की समीक्षा", // Hindi
      ],
      SHARED: [
        {
          selector: ".game-over-modal-content",
          method: "append",
          priority: 20,
        },
      ],
      CHESS_COM: [
        { selector: ".game-review-emphasis-component", method: "append", priority: 18 },
        { selector: ".board-controls-bottom", method: "append", priority: 15 },
        { selector: ".analysis-controls", method: "append", priority: 14 },
        { selector: ".board-controls", method: "append", priority: 13 },
        { selector: ".game-controls", method: "append", priority: 12 },
        { selector: ".post-game-controls", method: "append", priority: 11 },
      ],
      LICHESS: [
        { selector: ".analyse__tools", method: "append", priority: 10 },
        {
          selector: ".analyse__controls .left-buttons",
          method: "append",
          priority: 8,
        },
      ],
    },
  };
  CONFIG.BUTTON_TEXT = "";

  // --- STATE ---
  const STATE = {
    isBaseInitialized: false,
    platform: null,
    domObserver: null,
    buttonInstances: new Map(),
    isSlowDevice: false,
    performanceFactor: 1,
  };

  // --- CHROME STORAGE WRAPPER ---
  const chromeStorage = {
    setValue: (key, value) =>
      new Promise((resolve, reject) =>
        chrome.storage.local.set({ [key]: value }, () => {
          if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
          else resolve();
        })
      ),
    getValue: (key, defaultValue) =>
      new Promise((resolve) =>
        chrome.storage.local.get([key], (result) =>
          resolve(result[key] === undefined ? defaultValue : result[key])
        )
      ),
    deleteValue: (key) =>
      new Promise((resolve, reject) =>
        chrome.storage.local.remove(key, () => {
          if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
          else resolve();
        })
      ),
  };

  // --- INITIALIZATION FUNCTIONS ---

  function getPlatform() {
    const hostname = window.location.hostname;
    if (hostname.includes("lichess.org")) return "lichess";
    if (hostname.includes("www.chess.com")) return "chess.com";
    if (hostname.includes("wintrchess.com")) return "wintrchess";
    return null;
  }

  function detectDevicePerformance() {
    // Optimization: Assume fast device to avoid unnecessary delays.
    // Modern browsers and devices handle this extension well.
    STATE.isSlowDevice = false;
    STATE.performanceFactor = 1;
  }

  function ensureBaseInitialized() {
    if (STATE.isBaseInitialized) return;
    if (!CONFIG.BUTTON_TEXT) {
      CONFIG.BUTTON_TEXT = Utils.getMsg(CONFIG.BUTTON_TEXT_KEY);
    }
    if (CONFIG.BUTTON_SELECTORS.REVIEW_TERMS_LOWERCASE === undefined) {
      CONFIG.BUTTON_SELECTORS.REVIEW_TERMS_LOWERCASE =
        CONFIG.BUTTON_SELECTORS.REVIEW_TERMS.map((term) => term.toLowerCase());
    }
    STATE.isBaseInitialized = true;
  }

  function init() {
    STATE.platform = getPlatform();
    if (!STATE.platform) return;

    ensureBaseInitialized();
    detectDevicePerformance();

    if (STATE.platform === "lichess") {
      initializeSupportedPlatform("lichess", getLichessPageInfo);
    } else if (STATE.platform === "chess.com") {
      initializeSupportedPlatform("chess.com", getChessComPageInfo);
    } else if (STATE.platform === "wintrchess") {
      initWintrChessAutoPaste();
    }
  }

  function initializeSupportedPlatform(platformName, getPageInfoFn) {
    const pageInfo = getPageInfoFn();
    if (!pageInfo.isRelevantPage) return;

    DomObserverManager.setupObserver(
      () => tryAddWintrChessButton(platformName),
      platformName
    );
    tryAddWintrChessButton(platformName);

    const debouncedTryAddButton = Utils.debounce(
      () => tryAddWintrChessButton(platformName),
      CONFIG.RETRY_DELAY
    );

    window.addEventListener("load", debouncedTryAddButton);
    window.addEventListener("hashchange", () => {
      ButtonManager.removeAllButtons();
      debouncedTryAddButton();
    });

    const periodicCheckId = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      if (
        STATE.buttonInstances.size === 0 ||
        !document.querySelector(".wintchess-button, .wintchess-aurora-button")
      ) {
        tryAddWintrChessButton(platformName);
      }
    }, CONFIG.BUTTON_CHECK_INTERVAL);

    window.addEventListener("beforeunload", () => {
      clearInterval(periodicCheckId);
      DomObserverManager.disconnect();
      ButtonManager.removeAllButtons();
    });
  }

  // --- PAGE INFO GETTERS ---
  function getLichessPageInfo() {
    const path = window.location.pathname;
    const gameIdRegex = /^\/([a-zA-Z0-9]{8})(?:\/(?:white|black))?(?:#\d+)?$/;

    return {
      isRelevantPage: gameIdRegex.test(path) || path.startsWith("/analysis"),
      gameId: gameIdRegex.test(path) ? path.split("/")[1] : null,
    };
  }

  function getChessComPageInfo() {
    const path = window.location.pathname;
    let gameId = null,
      isRelevantPage = false,
      isReviewPage = false;

    const gameUrlRegex = /^\/game\/(live|daily|computer)\/(\d+)/;
    const gameMatch = path.match(gameUrlRegex);
    if (gameMatch) {
      isRelevantPage = true;
      gameId = gameMatch[2];
    } else if (/^\/(analysis|game|play(\/|$)|home|today)/.test(path)) {
      isRelevantPage = true;
      const urlParams = new URLSearchParams(window.location.search);
      gameId = urlParams.get("gameId") || urlParams.get("id") || null;
    }

    if (
      /^\/analysis|^\/game-report|^\/game\/[^\/]+\/\d+\/review/.test(path) ||
      document.querySelector(
        ".game-report-container, .analysis-game-report-area, .game-review-buttons-component"
      )
    ) {
      isReviewPage = true;
      isRelevantPage = true;
    }

    if (
      path.startsWith("/play/computer") &&
      document.querySelector(".game-over-modal-content")
    ) {
      isRelevantPage = true;
    }
    if (path.startsWith("/game/computer/")) {
      isRelevantPage = true;
    }

    return { isRelevantPage, gameId, isReviewPage };
  }

  // --- DOM OBSERVER ---
  const DomObserverManager = {
    relevantClassesByPlatform: {
      lichess: ["analyse__tools", "analyse__controls", "round__app"],
      "chess.com": [
        "board-controls",
        "game-controls",
        "post-game-controls",
        "game-over-modal-content",
        "analysis-controls",
        "modal-header-header",
        "sidebar-component",
        "board-layout-sidebar",
        "layout-column-two",
      ],
    },
    relevantNodeNames: new Set(["chess-board", "vertical-move-list"]),
    
    _cachedSelectors: new Map(),

    getCombinedSelector(platform) {
      if (this._cachedSelectors.has(platform)) {
        return this._cachedSelectors.get(platform);
      }

      const classes = this.relevantClassesByPlatform[platform] || [];
      const classSelectors = classes.map(c => "." + c.split(" ").join("."));
      const nodeSelectors = Array.from(this.relevantNodeNames);
      
      const combined = [...classSelectors, ...nodeSelectors].join(",");
      this._cachedSelectors.set(platform, combined);
      return combined;
    },

    setupObserver(callback, platform) {
      this.disconnect();
      const combinedSelector = this.getCombinedSelector(platform);
      
      const observerConfig = {
        childList: true,
        subtree: true,
        attributes: platform === "lichess",
        attributeFilter: platform === "lichess" ? ["class"] : undefined,
      };

      const debouncedCallback = Utils.debounce(
        callback,
        CONFIG.DEBOUNCE_DELAY * STATE.performanceFactor || 200 // Default to 200 if not set
      );

      const mutationCallback = (mutationsList) => {
        let shouldTrigger = false;
        
        for (const mutation of mutationsList) {
          if (mutation.type === "childList") {
            for (let i = 0; i < mutation.addedNodes.length; i++) {
              const node = mutation.addedNodes[i];
              if (node.nodeType === Node.ELEMENT_NODE) {
                if (combinedSelector && (node.matches(combinedSelector) || node.querySelector(combinedSelector))) {
                   shouldTrigger = true;
                   break;
                }
              }
            }
          } else if (
            mutation.type === "attributes" &&
            mutation.target.nodeType === Node.ELEMENT_NODE
          ) {
             if (combinedSelector && mutation.target.matches(combinedSelector)) {
               shouldTrigger = true;
             }
          }
          if (shouldTrigger) break;
        }
        
        if (shouldTrigger) {
          debouncedCallback();
        }
      };

      STATE.domObserver = new MutationObserver(mutationCallback);
      STATE.domObserver.observe(document.documentElement, observerConfig);
    },

    disconnect() {
      if (STATE.domObserver) {
        STATE.domObserver.disconnect();
        STATE.domObserver = null;
      }
    },
  };

  // --- NOTIFICATION MANAGER ---
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
          padding: 12px 22px; background-color: #2c3e50; color: white; letter-spacing: 0.5px;
          border-radius: 6px; z-index: ${Z_INDEX}; box-shadow: 0 4px 12px rgba(0,0,0,0.25);
          opacity: 0; transition: opacity 0.3s ease-in-out, top 0.3s ease-in-out; font-family: "Segoe UI", Roboto, sans-serif; font-size: 14px;
          line-height: 1.4; text-align: center; max-width: 90%;`;
        document.body.appendChild(activeNotification);

        activeNotification.offsetHeight;
        activeNotification.style.opacity = "1";
        activeNotification.style.top = "30px";

        timerId = setTimeout(() => this.hide(), duration);
      },
      hide() {
        if (!activeNotification) return;
        activeNotification.style.opacity = "0";
        activeNotification.style.top = "20px";
        setTimeout(() => this.clear(), 300);
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

  // --- PGN EXTRACTION ---
  const PgnExtractor = {
    _cache: new Map(),
    _cacheDuration: 60000,

    _setCache(key, value) {
      if (!value) return;
      this._cache.set(key, { value, timestamp: Date.now() });
    },
    _getFromCache(key) {
      const item = this._cache.get(key);
      if (item && Date.now() - item.timestamp < this._cacheDuration) {
        return item.value;
      }
      this._cache.delete(key);
      return null;
    },

    async fetchPgnViaBackground(apiUrl) {
      return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          { action: "fetchPgn", url: apiUrl },
          (response) => {
            if (chrome.runtime.lastError) {
              return reject(
                new Error(
                  chrome.runtime.lastError.message ||
                    "Background script communication error"
                )
              );
            }
            if (response && response.success) {
              // Handle both JSON and text responses
              resolve(response.data);
            } else {
              reject(
                new Error(
                  response?.error || "Unknown error from background script"
                )
              );
            }
          }
        );
      });
    },

    async fromLichess() {
      ensureBaseInitialized();
      const gameId = getLichessPageInfo().gameId;

      if (!gameId) {
        const pgnTextarea = document.querySelector(".pgn textarea");
        if (pgnTextarea?.value) return pgnTextarea.value.trim();

        console.log(Utils.getMsg("logPgnFetchNoId"));
        NotificationManager.show(
          Utils.getMsg("notificationPgnFetchError") + " (No game ID)",
          4000
        );
        return null;
      }

      const cacheKey = `lichess_${gameId}`;
      const cachedPgn = this._getFromCache(cacheKey);
      if (cachedPgn) return cachedPgn;

      try {
        const apiUrl = `https://lichess.org/game/export/${gameId}?pgnInJson=false&moves=true&tags=true&clocks=false&evals=false&opening=false`;

        const pgn = await this.fetchPgnViaBackground(apiUrl);
        if (pgn) this._setCache(cacheKey, pgn);
        return pgn;
      } catch (error) {
        console.error(Utils.getMsg("logPgnFetchApiErrorLichess"), error);
        NotificationManager.show(
          Utils.getMsg("notificationPgnFetchError") +
            ` (Lichess API: ${error.message})`,
          5000
        );
        return null;
      }
    },

    async fromChessCom() {
      ensureBaseInitialized();
      const pageInfo = getChessComPageInfo();
      const gameId = pageInfo.gameId;
      
      const cacheKey = `chesscom_${
        gameId || window.location.pathname.replace(/\//g, "_")
      }`;
      const cachedPgn = this._getFromCache(cacheKey);
      if (cachedPgn) {
        console.log(Utils.getMsg("logPgnFromCache"));
        return cachedPgn;
      }

      // Strategy 1: Try Internal API (Fastest & Most Reliable)
      if (gameId) {
        try {
          // Try callback API first (contains PGN in JSON)
          const callbackUrl = `https://www.chess.com/callback/live/game/${gameId}`;
          const data = await this.fetchPgnViaBackground(callbackUrl);
          
          if (data && data.game && data.game.pgn) {
             const pgn = data.game.pgn;
             this._setCache(cacheKey, pgn);
             return pgn;
          }
        } catch (e) {
          console.log("[WintrChess] Callback API failed, trying fallback...");
        }

        try {
           // Fallback to pub API (returns raw PGN usually)
           const pubUrl = `https://www.chess.com/pub/game/${gameId}`;
           const pgn = await this.fetchPgnViaBackground(pubUrl);
           if (pgn && typeof pgn === 'string' && pgn.includes('[Event')) {
             this._setCache(cacheKey, pgn);
             return pgn;
           }
        } catch (e) {
           console.log("[WintrChess] Pub API failed, falling back to UI scraping...");
        }
      }

      // Strategy 2: UI Scraping (Fallback)
      NotificationManager.show(
        Utils.getMsg("notificationPgnExtraction"),
        4000
      );

      try {
        const pgn = await this._extractChessComPgnViaSharePanel();
        if (pgn) this._setCache(cacheKey, pgn);
        return pgn;
      } catch (error) {
        console.error("[WintrChess] Error extracting Chess.com PGN:", error);
        NotificationManager.show(
          Utils.getMsg("notificationPgnExtractionError") + `: ${error.message}`,
          5000
        );
        throw error;
      }
    },

    async _extractChessComPgnViaSharePanel() {
      const getAdjustedDelay = (baseDelay) =>
        baseDelay *
        (STATE.isSlowDevice ? Math.max(1.5, STATE.performanceFactor) : 1);

      const clickElementWithRetry = async (
        selectors,
        descriptionKey,
        maxAttempts = 5,
        baseAttemptDelay = 250
      ) => {
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          for (const selector of selectors) {
            const element =
              typeof selector === "string"
                ? document.querySelector(selector)
                : selector.findFn
                ? selector.findFn()
                : null;
            if (
              element &&
              typeof element.click === "function" &&
              !element.disabled &&
              element.offsetParent !== null
            ) {
              try {
                element.click();
                return true;
              } catch (e) {}
            }
          }
          if (attempt < maxAttempts - 1)
            await Utils.sleep(
              getAdjustedDelay(baseAttemptDelay) * (attempt + 1)
            );
        }
        console.error(
          Utils.getMsg("logSharePanelClickFailed", [
            Utils.getMsg(descriptionKey),
            maxAttempts.toString(),
          ])
        );
        return false;
      };

      const extractPgnValue = async (
        maxAttempts = 5,
        baseAttemptDelay = 250
      ) => {
        const textareaSelectors = [
          'textarea.share-menu-tab-pgn-textarea[aria-label="PGN"]',
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
              textarea.value.includes("[Event") &&
              textarea.offsetParent !== null
            ) {
              return textarea.value;
            }
          }
          if (attempt < maxAttempts - 1)
            await Utils.sleep(
              getAdjustedDelay(baseAttemptDelay) * (attempt + 1)
            );
        }
        return null;
      };

      let sharePanelOpened = false;
      try {
        const shareButtonSelectors = [
          "[aria-label=Partager]",
          "[aria-label=Share]",
          "[aria-label=Teilen]",
          "[aria-label=Compartir]",
          "[aria-label=Condividere]",
          "[aria-label=делиться]",
          "a[aria-label=शेयर करें]",
        ];
        if (
          !(await clickElementWithRetry(
            shareButtonSelectors,
            "chessComShareButtonAriaLabel",
            STATE.isSlowDevice ? 8 : 5,
            300
          ))
        ) {
          throw new Error(Utils.getMsg("errorSharePanelOpenFailed"));
        }
        sharePanelOpened = true;
        await Utils.sleep(getAdjustedDelay(STATE.isSlowDevice ? 700 : 400));

        const pgnTabSelectors = [
          'button#tab-pgn[aria-controls="tabpanel-pgn"]',
        ];
        if (
          !(await clickElementWithRetry(
            pgnTabSelectors,
            "descriptionPgnTab",
            5,
            300
          ))
        ) {
          throw new Error(Utils.getMsg("errorPgnTabNotFound"));
        }
        await Utils.sleep(getAdjustedDelay(STATE.isSlowDevice ? 1000 : 500));

        const pgn = await extractPgnValue(5, 300);
        if (pgn) return pgn;
        throw new Error(Utils.getMsg("errorPgnTextareaExtractionFailed"));
      } finally {
        if (sharePanelOpened) {
          try {
            document.dispatchEvent(
              new KeyboardEvent("keydown", {
                key: "Escape",
                code: "Escape",
                bubbles: true,
                cancelable: true,
              })
            );
          } catch (e) {
            console.warn(
              "[WintrChess] Non-critical error attempting to close share panel:",
              e.message,
              ". Trying Escape key as fallback."
            );
            document.dispatchEvent(
              new KeyboardEvent("keydown", {
                key: "Escape",
                code: "Escape",
                bubbles: true,
                cancelable: true,
              })
            );
          }
        }
      }
    },
  };

  // --- BUTTON FACTORY & MANAGER ---
  const ButtonFactory = {
    create(options) {
      const { className, style, innerHTML, onClick } = options;
      const button = document.createElement("button");
      button.className = className;
      if (!className.includes("wintchess-aurora-button")) {
        button.classList.add("wintchess-button");
      }

      if (style) button.style.cssText = style;
      button.innerHTML = innerHTML;
      this.attachEventHandler(button, onClick);
      return button;
    },

    attachEventHandler(button, onClickHandler) {
      button.addEventListener("click", async (event) => {
        event.stopPropagation();
        event.preventDefault();
        if (button.disabled) return;

        button.disabled = true;
        ensureBaseInitialized();

        const textElement = button.querySelector(".button-text") || button;
        const originalText = Utils.getElementInnerText(textElement);
        textElement.textContent = Utils.getMsg("buttonStateRetrievingPgn");

        try {
          const pgn = await onClickHandler();
          if (pgn) {
            await chromeStorage.setValue(CONFIG.PGN_STORAGE_KEY, pgn);
            chrome.runtime.sendMessage({
              action: "openWintrChess",
              url: CONFIG.WINTRCHESS_URL,
            });
          }
        } catch (error) {
          console.error("[WintrChess] Error on button click:", error);
        } finally {
          setTimeout(() => {
            button.disabled = false;
            textElement.textContent = originalText;
          }, 700 * STATE.performanceFactor);
        }
      });
    },
  };

  function getButtonRenderConfigs(localizedButtonText) {
    return {
      lichess: {
        className: "wintchess-aurora-button",
        innerHTML: `<span class="button-text">${localizedButtonText}</span>`,
      },
      chesscom: {
        className:
          "cc-button-component cc-button-primary cc-button-xx-large cc-bg-primary cc-button-full",
        style: `margin-top: 8px; width: calc(100% - 30px); margin-bottom: 6px; margin-left: 15px; margin-right: 15px;`,
        innerHTML: `<span class="cc-button-one-line button-text">${localizedButtonText}</span>`,
      },
      chesscomGameOver: {
        className:
          "cc-button-component cc-button-primary cc-button-xx-large cc-bg-primary cc-button-full game-over-review-button-game-over-review-button",
        innerHTML: `${localizedButtonText}`,
      },
    };
  }

  function createWintrChessButton(platform, type = "default") {
    ensureBaseInitialized();
    const RENDER_CONFIGS = getButtonRenderConfigs(CONFIG.BUTTON_TEXT);

    let config;
    if (platform === "lichess") {
      config = RENDER_CONFIGS.lichess;
    } else if (platform === "chess.com") {
      config =
        type === "gameOver"
          ? RENDER_CONFIGS.chesscomGameOver
          : RENDER_CONFIGS.chesscom;
    } else {
      config = RENDER_CONFIGS.lichess;
    }

    const pgnExtractorFn =
      platform === "chess.com"
        ? PgnExtractor.fromChessCom.bind(PgnExtractor)
        : PgnExtractor.fromLichess.bind(PgnExtractor);

    return ButtonFactory.create({
      ...config,
      onClick: pgnExtractorFn,
    });
  }

  const ButtonManager = (() => {
    const targetCache = new Map();

    const getRetryDelay = (attempts) =>
      Math.min(
        CONFIG.RETRY_DELAY * Math.pow(1.5, attempts),
        CONFIG.LONG_RETRY_DELAY
      ) * STATE.performanceFactor;

    const MAX_ATTEMPTS = 50;

    return {
      addButton({
        id,
        buttonCreator,
        targets,
        attempts = 0,
        retryFn,
        checkExisting = true,
      }) {
        const existingInstance = STATE.buttonInstances.get(id);
        if (
          checkExisting &&
          existingInstance &&
          document.contains(existingInstance.button)
        ) {
          return true;
        }
        if (existingInstance && !document.contains(existingInstance.button)) {
          STATE.buttonInstances.delete(id);
        }

        if (document.readyState !== "complete" && attempts < 5) {
          setTimeout(
            () => retryFn(attempts + 1),
            (CONFIG.RETRY_DELAY / 2) * STATE.performanceFactor
          );
          return false;
        }

        const button = buttonCreator();
        if (this._insertButtonDOM(id, button, targets)) {
          return true;
        }

        if (attempts < MAX_ATTEMPTS - 1) {
          setTimeout(() => retryFn(attempts + 1), getRetryDelay(attempts));
        } else {
          console.warn(Utils.getMsg("logMaxAttemptsReached", id));
          setTimeout(
            () => retryFn(0),
            CONFIG.LONG_RETRY_DELAY * 3 * STATE.performanceFactor
          );
        }
        return false;
      },

      _insertButtonDOM(id, button, targets) {
        const sortedTargets = [...targets].sort(
          (a, b) => (b.priority || 0) - (a.priority || 0)
        );

        for (const targetConfig of sortedTargets) {
          const {
            selector,
            method = "append",
            element: predefinedElement,
          } = targetConfig;
          let anchorElement = null;

          if (predefinedElement && document.contains(predefinedElement)) {
            anchorElement = predefinedElement;
          } else if (typeof selector === "string") {
            anchorElement = Array.from(
              document.querySelectorAll(selector)
            ).find((el) => el.offsetParent !== null);
            if (!anchorElement)
              anchorElement = document.querySelector(selector);
          }

          if (!anchorElement) continue;

          const containerToCheck =
            method === "append" || method === "prepend"
              ? anchorElement
              : anchorElement.parentNode;
          if (!containerToCheck) continue;

          let existingButtonFound = false;
          const wintchessButtonSelector =
            ".wintchess-button, .wintchess-aurora-button";
          const wintchessContainerSelector = ".wintchess-button-container";

          if (
            containerToCheck.querySelector(
              `:scope > ${wintchessButtonSelector}, :scope > ${wintchessContainerSelector}`
            )
          ) {
            existingButtonFound = true;
          } else if (
            (method === "after" || method === "afterend") &&
            anchorElement.nextElementSibling &&
            (anchorElement.nextElementSibling.matches(
              wintchessButtonSelector
            ) ||
              anchorElement.nextElementSibling.matches(
                wintchessContainerSelector
              ) ||
              anchorElement.nextElementSibling.querySelector(
                wintchessButtonSelector
              ))
          ) {
            existingButtonFound = true;
          } else if (
            (method === "before" || method === "beforebegin") &&
            anchorElement.previousElementSibling &&
            (anchorElement.previousElementSibling.matches(
              wintchessButtonSelector
            ) ||
              anchorElement.previousElementSibling.matches(
                wintchessContainerSelector
              ) ||
              anchorElement.previousElementSibling.querySelector(
                wintchessButtonSelector
              ))
          ) {
            existingButtonFound = true;
          }

          if (existingButtonFound && id !== "chesscom_gameover_modal") {
            const currentInstance = STATE.buttonInstances.get(id);
            if (
              currentInstance &&
              currentInstance.button &&
              currentInstance.button.isConnected
            ) {
              return true;
            }
            continue;
          }

          try {
            let finalButtonContainer = button;
            if (id === "chesscom_gameover_modal") {
              let container = anchorElement.querySelector(
                ".wintchess-button-container.game-over-review-button-component"
              );
              if (!container) {
                container = document.createElement("div");
                container.className =
                  "wintchess-button-container game-over-review-button-component";
              } else {
                while (container.firstChild)
                  container.removeChild(container.firstChild);
              }
              container.appendChild(button);
              finalButtonContainer = container;
            }

            if (method === "append")
              anchorElement.appendChild(finalButtonContainer);
            else if (method === "prepend")
              anchorElement.prepend(finalButtonContainer);
            else if (method === "after" || method === "afterend")
              anchorElement.after(finalButtonContainer);
            else if (method === "before" || method === "beforebegin")
              anchorElement.before(finalButtonContainer);
            else
              anchorElement.insertAdjacentElement(method, finalButtonContainer);

            STATE.buttonInstances.set(id, {
              button: finalButtonContainer.matches(wintchessButtonSelector)
                ? finalButtonContainer
                : finalButtonContainer.querySelector(wintchessButtonSelector) ||
                  finalButtonContainer,
              element: anchorElement,
              method,
            });
            return true;
          } catch (error) {
            console.warn(
              `[WintrChess] Failed to insert button "${id}" with method "${method}" on selector "${
                selector || "predefined"
              }":`,
              error
            );
          }
        }
        return false;
      },

      getTargetsForPlatform(platform) {
        const platformKey = `targets_${platform}`;
        if (targetCache.has(platformKey)) return targetCache.get(platformKey);

        let platformTargets = [];
        if (platform === "lichess") {
          platformTargets = CONFIG.BUTTON_SELECTORS.LICHESS;
        } else if (platform === "chess.com") {
          platformTargets = [
            ...CONFIG.BUTTON_SELECTORS.CHESS_COM,
            ...CONFIG.BUTTON_SELECTORS.SHARED,
          ];
        }

        targetCache.set(platformKey, platformTargets);
        return platformTargets;
      },

      removeButtonById(id) {
        const instance = STATE.buttonInstances.get(id);
        if (instance && instance.button) {
          const buttonElement = instance.button.matches(
            ".wintchess-button-container"
          )
            ? instance.button
            : instance.button.closest(".wintchess-button-container") ||
              instance.button;
          if (buttonElement && buttonElement.parentNode) {
            buttonElement.parentNode.removeChild(buttonElement);
          }
        }
        STATE.buttonInstances.delete(id);
      },

      removeAllButtons() {
        STATE.buttonInstances.forEach(({ button }) => {
          const buttonElement = button.matches(".wintchess-button-container")
            ? button
            : button.closest(".wintchess-button-container") || button;
          if (buttonElement && buttonElement.parentNode) {
            buttonElement.parentNode.removeChild(buttonElement);
          }
        });
        STATE.buttonInstances.clear();
      },
    };
  })();

  function tryAddWintrChessButton(platform, attempts = 0) {
    ensureBaseInitialized();

    if (platform === "chess.com") {
      tryAddButtonToChessComGameOverModal();

      if (
        STATE.buttonInstances.has("chesscom_gameover_modal") &&
        !document.querySelector(
          ".game-over-modal-content .wintchess-button-container"
        ) &&
        !document.querySelector(".game-over-modal-content .wintchess-button")
      ) {
        ButtonManager.removeButtonById("chesscom_gameover_modal");
      }

      // Skip adding the main button on the Chess.com home page to prevent unnecessary retries
      const path = (window.location && window.location.pathname) || "";
      if (path.replace(/\/$/, "") === "/home") {
        return false;
      }
    }

    const buttonId = `${platform}_main`;
    let targets = ButtonManager.getTargetsForPlatform(platform);

    if (platform === "chess.com") {
      const gameReviewButton = findChessComGameReviewButton();
      if (gameReviewButton && gameReviewButton.parentNode) {
        targets = [
          { element: gameReviewButton, method: "afterend", priority: 100 },
          ...targets.filter(
            (t) =>
              !gameReviewButton.closest(t.selector) &&
              t.selector !== ".game-over-modal-content"
          ),
        ];
      } else {
        targets = targets.filter(
          (t) => t.selector !== ".game-over-modal-content"
        );
      }
    }

    return ButtonManager.addButton({
      id: buttonId,
      buttonCreator: () => createWintrChessButton(platform, "default"),
      targets: targets,
      attempts: attempts,
      retryFn: (newAttempts) => tryAddWintrChessButton(platform, newAttempts),
    });
  }

  function tryAddButtonToChessComGameOverModal() {
    if (STATE.platform !== "chess.com") return false;
    ensureBaseInitialized();

    const modalContent = document.querySelector(".game-over-modal-content");
    if (!modalContent) return false;

    const buttonId = "chesscom_gameover_modal";

    const existingInstance = STATE.buttonInstances.get(buttonId);
    if (
      existingInstance &&
      existingInstance.button &&
      existingInstance.button.isConnected
    ) {
      return true;
    }

    const buttonList = modalContent.querySelector(".game-over-modal-buttons");
    if (!buttonList) return false;

    const targets = [{ element: buttonList, method: "append", priority: 100 }];

    if (
      !document.querySelector(
        targets[0].element.tagName.toLowerCase() +
          (targets[0].element.className
            ? "." + targets[0].element.className.trim().split(/\s+/).join(".")
            : "")
      )
    ) {
      targets.push({ element: modalContent, method: "append", priority: 90 });
    }

    return ButtonManager.addButton({
      id: buttonId,
      buttonCreator: () => createWintrChessButton("chess.com", "gameOver"),
      targets: targets,
      attempts: 0,
      retryFn: (newAttempts) => {
        if (newAttempts < 3) tryAddButtonToChessComGameOverModal();
      },
      checkExisting: true,
    });
  }

  function findChessComGameReviewButton() {
    ensureBaseInitialized();
    const reviewTermsLowercase = CONFIG.BUTTON_SELECTORS.REVIEW_TERMS_LOWERCASE;

    const containerSelectors = [
      ".board-layout-sidebar",
      ".sidebar-component",
      ".layout-column-two",
      ".game-controls-component",
      ".analysis-controls-component",
      ".post-game-controls-component",
      ".game-over-modal-content",
    ];

    let candidateButtons = [];
    for (const containerSelector of containerSelectors) {
      const container = document.querySelector(containerSelector);
      if (container) {
        container.querySelectorAll("button, [role='button']").forEach((btn) => {
          if (btn.offsetParent !== null) {
            candidateButtons.push(btn);
          }
        });
      }
    }

    candidateButtons = [...new Set(candidateButtons)];

    for (const btn of candidateButtons) {
      if (
        btn.classList.contains("wintchess-button") ||
        btn.closest(
          ".wintchess-aurora-button, .wintchess-button-container, .wintchess-button"
        )
      ) {
        continue;
      }

      const btnFullText = Utils.getElementInnerText(btn).toLowerCase();
      const ariaLabel = (btn.getAttribute("aria-label") || "")
        .toLowerCase()
        .trim();

      const isReviewButton = reviewTermsLowercase.some(
        (term) => btnFullText.includes(term) || ariaLabel.includes(term)
      );

      if (isReviewButton) {
        if (
          btnFullText.length > 3 ||
          ariaLabel.length > 3 ||
          btn.querySelector(".icon-font-chess, svg")
        ) {
          // console.log("[WintrChess] Found potential Game Review button via container/general search:", btn, "Text:", btnFullText);
          return btn;
        }
      }
    }
    // console.log("[WintrChess] Game Review button not found with current strategy.");
    return null;
  }

  // --- WINTRCHESS.COM SPECIFIC LOGIC ---
  function initWintrChessAutoPaste() {
    if (STATE.isSlowDevice) {
      NotificationManager.show(
        Utils.getMsg("notificationWintrchessPreparingAnalysisSlow"),
        5000
      );
    }
    pasteAndAnalyzeOnWintrChess();
  }

  async function pasteAndAnalyzeOnWintrChess() {
    const pgnToPaste = await chromeStorage.getValue(
      CONFIG.PGN_STORAGE_KEY,
      null
    );
    if (!pgnToPaste) return;

    ensureBaseInitialized();

    const selectorsConfig = [
      {
        textarea: "textarea",
        buttonText: [
          "analyse",
          "analyser",
          "विश्लेषण करें",
          "विश्लेषण करा",
          "Phân tích",
          "analizar",
          "analizuj",
          "analysiere",
          "复盘分析",
        ],
      },
    ];

    let attempts = 0;
    const maxAttempts = STATE.isSlowDevice ? 10 : 5;
    let delayMs = (STATE.isSlowDevice ? 600 : 400) * STATE.performanceFactor;

    const findWintrChessElements = () => {
      for (const sel of selectorsConfig) {
        const textareas = document.querySelectorAll(sel.textarea);
        for (const textarea of textareas) {
          if (
            !textarea ||
            textarea.offsetParent === null ||
            textarea.disabled ||
            textarea.readOnly
          ) {
            continue;
          }

          let button = null;
          if (
            sel.buttonText &&
            Array.isArray(sel.buttonText) &&
            sel.buttonText.length > 0
          ) {
            const potentialButtonContainers = [
              textarea.parentElement?.parentElement,
              document.body,
            ];

            for (const container of potentialButtonContainers) {
              if (!container) continue;
              button = Array.from(
                container.querySelectorAll(
                  "button:not([disabled]), [role='button']:not([disabled])"
                )
              ).find(
                (btn) =>
                  sel.buttonText.some((txt) =>
                    (Utils.getElementInnerText(btn) || "")
                      .toLowerCase()
                      .includes(txt)
                  ) && btn.offsetParent !== null
              );
              if (button) break;
            }
          }

          if (button && button.offsetParent !== null && !button.disabled) {
            return { textarea, button };
          }
        }
      }
      return null;
    };

    const performPasteAndClick = async (textarea, button) => {
      try {
        textarea.focus();
        textarea.value = "";
        await Utils.sleep(50 * STATE.performanceFactor);
        textarea.value = pgnToPaste;
        textarea.dispatchEvent(
          new Event("input", { bubbles: true, cancelable: true })
        );
        textarea.dispatchEvent(
          new Event("change", { bubbles: true, cancelable: true })
        );

        await Utils.sleep(100 * STATE.performanceFactor);

        if (!button.disabled) {
          button.click();
          await chromeStorage.deleteValue(CONFIG.PGN_STORAGE_KEY);
          return true;
        }
        return false;
      } catch (error) {
        console.error(Utils.getMsg("logWintrchessAutoPasteError"), error);
        return false;
      }
    };

    const MAX_WAIT_TIME = 15000;
    
    // Check immediately
    const initialElements = findWintrChessElements();
    if (initialElements && (await performPasteAndClick(initialElements.textarea, initialElements.button))) {
      return;
    }

    let observer = null;
    let timeoutId = null;

    const cleanup = () => {
       if (observer) observer.disconnect();
       if (timeoutId) clearTimeout(timeoutId);
    };

    const handleMutation = async () => {
       if (document.visibilityState === "hidden") return;
       const elements = findWintrChessElements();
       if (elements) {
          if (await performPasteAndClick(elements.textarea, elements.button)) {
             cleanup();
          }
       }
    };

    const debouncedHandle = Utils.debounce(handleMutation, 200);

    observer = new MutationObserver(debouncedHandle);
    observer.observe(document.body, { childList: true, subtree: true });

    // Fallback timeout to stop looking
    timeoutId = setTimeout(async () => {
      cleanup();
      
      let failMessage = Utils.getMsg("notificationWintrchessAutoPasteFailed");
      if (navigator.clipboard && pgnToPaste) {
          try {
            await navigator.clipboard.writeText(pgnToPaste);
            failMessage = Utils.getMsg("notificationWintrchessAutoPasteFailedClipboard");
          } catch (clipError) {
            console.error("[WintrChess] Failed to copy PGN to clipboard:", clipError);
          }
      }
      NotificationManager.show(failMessage, 6000);
      await chromeStorage.deleteValue(CONFIG.PGN_STORAGE_KEY).catch(e => console.warn("Failed to clear PGN", e));

    }, MAX_WAIT_TIME);
  }

  // --- CHROME MESSAGE LISTENER ---
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "extractPgnFromIconClick") {
      (async () => {
        try {
          if (!STATE.platform) STATE.platform = getPlatform();
          ensureBaseInitialized();

          let pgn;
          if (STATE.platform === "lichess") {
            pgn = await PgnExtractor.fromLichess();
          } else if (STATE.platform === "chess.com") {
            pgn = await PgnExtractor.fromChessCom();
          } else {
            console.warn(
              "[WintrChess] Icon click on unsupported page for PGN extraction:",
              window.location.hostname
            );
            sendResponse({
              error: "Unsupported platform for PGN extraction via icon.",
            });
            return;
          }

          if (pgn) {
            sendResponse({ pgn: pgn });
          } else {
            sendResponse({
              error:
                "Failed to extract PGN (content script). See console/notifications.",
            });
          }
        } catch (e) {
          console.error(
            "[WintrChess] Error during icon click PGN extraction (content.js):",
            e
          );
          NotificationManager.show(
            Utils.getMsg("notificationGenericErrorPrefix") +
              (e.message || "Unknown PGN extraction error"),
            5000
          );
          sendResponse({
            error:
              e.message ||
              "Unknown error during PGN extraction (content script).",
          });
        }
      })();
      return true;
    }
  });

  // --- SCRIPT BOOTSTRAP ---
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
