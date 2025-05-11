(function () {
  "use strict";

  function getMsg(messageKey, substitutions) {
    try {
      return chrome.i18n.getMessage(messageKey, substitutions);
    } catch (e) {
      console.warn(`[WintrChess] Missing translation for key: ${messageKey}`);
      return messageKey;
    }
  }

  // Configuration
  const CHESS_ICON_SVG = `<svg viewBox="0 0 32 32" height="32" width="32" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
    <path d="M16 26.5c5.8 0 10.5-4.7 10.5-10.5S21.8 5.5 16 5.5 5.5 10.2 5.5 16 10.2 26.5 16 26.5M12 14l3 3h-2v4h6v-4h-2l3-3h-2V9h-4v5z"></path>
  </svg>`;

  const CONFIG = {
    WINTRCHESS_URL: "https://wintrchess.com/",
    PGN_STORAGE_KEY: "wintrChessPgnToPaste",
    BUTTON_TEXT: "",
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
          selector: ".game-over-modal-content",
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
    initialized: false,
    customCssInjected: false,
  };

  function injectLichessCustomButtonCss() {
    if (STATE.customCssInjected || STATE.platform !== "lichess") return;

    const css = `
      .wintchess-aurora-button {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        padding: 10px 20px;
        border-radius: 8px;
        font-family: 'Noto Sans', sans-serif;
        font-size: 0.95em;
        font-weight: 600;
        color: #ffffff;
        cursor: pointer;
        border: none;
        outline: none;
        position: relative;
        overflow: hidden;
        transition: all 0.3s ease;
        width: 97%;
        box-sizing: border-box;
        margin: 10px auto;
        background: linear-gradient(135deg, #483D8B, #6A5ACD, #836FFF, #9370DB);
        background-size: 300% 300%;
        animation: wintchessAuroraGradientFlow 10s ease infinite;
        box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2);
      }

      .wintchess-aurora-button:before {
        content: '';
        position: absolute;
        top: 0;
        left: -100%;
        width: 100%;
        height: 100%;
        background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent);
        transition: left 0.6s ease;
      }

      .wintchess-aurora-button:hover:before {
        left: 100%;
      }

      .wintchess-aurora-button:hover {
        transform: translateY(-2px);
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.3);
        filter: brightness(1.1);
      }

      .wintchess-aurora-button:active {
        transform: translateY(0px);
        box-shadow: 0 3px 10px rgba(0, 0, 0, 0.2);
        filter: brightness(0.95);
      }

      .wintchess-aurora-button .wintchess-icon {
        width: 20px;
        height: 20px;
        fill: currentColor;
        flex-shrink: 0;
      }

      .wintchess-aurora-button .button-text {
        line-height: 1.2;
        white-space: nowrap;
      }

      @keyframes wintchessAuroraGradientFlow {
        0% { background-position: 0% 50%; }
        50% { background-position: 100% 50%; }
        100% { background-position: 0% 50%; }
      }
    `;
    const styleElement = document.createElement("style");
    styleElement.type = "text/css";
    styleElement.id = "wintchess-custom-lichess-style";
    styleElement.appendChild(document.createTextNode(css));
    (document.head || document.documentElement).appendChild(styleElement);
    STATE.customCssInjected = true;
  }

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
        getMsg("logSlowDeviceDetected", STATE.performanceFactor.toFixed(2))
      );
    } else {
      console.log(getMsg("logFastDeviceDetected", duration.toFixed(2)));
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

  function ensureBasicInit() {
    if (STATE.initialized) return;

    if (!CONFIG.BUTTON_TEXT) {
      CONFIG.BUTTON_TEXT = getMsg("buttonTextAnalyzeWintrChess");
    }
    if (STATE.performanceFactor === 1 && !STATE.isSlowDevice) {
      detectDevicePerformance();
    }
    if (!STATE.platform) {
      const hostname = window.location.hostname;
      if (hostname.includes("lichess.org")) {
        STATE.platform = "lichess";
        injectLichessCustomButtonCss();
      } else if (hostname.includes("www.chess.com")) {
        STATE.platform = "chess.com";
      } else if (hostname.includes("wintrchess.com")) {
        STATE.platform = "wintrchess";
      }
    }
    STATE.initialized = true;
  }

  function init() {
    ensureBasicInit();

    if (STATE.platform === "lichess") {
      initializePlatformSpecificLogic("lichess", getLichessPageInfo);
    } else if (STATE.platform === "chess.com") {
      initializePlatformSpecificLogic("chess.com", getChessComPageInfo);
    } else if (STATE.platform === "wintrchess") {
      initWintrChess();
    }
  }

  function initializePlatformSpecificLogic(platformName, getPageInfoFn) {
    const pageInfo = getPageInfoFn();

    if (pageInfo.isRelevantPage) {
      DomObserverManager.setupObserver(
        () => tryAddButton(platformName),
        platformName
      );

      tryAddButton(platformName);

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
        if (
          !STATE.buttonAdded ||
          !document.querySelector(".wintchess-button, .wintchess-aurora-button")
        ) {
          tryAddButton(platformName);
        }
      }, CONFIG.BUTTON_CHECK_INTERVAL);

      window.addEventListener("beforeunload", () => {
        clearInterval(periodicCheck);
        DomObserverManager.disconnectExisting();
        ButtonManager.removeAllButtons();
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
      if (/^[a-zA-Z0-9]{8,}$/.test(pathParts[0])) {
        isRelevantPage = true;
        gameId = pathParts[0];
      } else if (pathParts[0] === "study" && pathParts.length >= 2) {
        isRelevantPage = true;
        studyId = pathParts[1];
      } else if (pathParts[0] === "analysis") {
        isRelevantPage = true;
      }
    }
    return { isRelevantPage, gameId, studyId };
  }

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
        attributes: platform === "lichess",
        attributeFilter: platform === "lichess" ? ["class"] : undefined,
      };

      const debouncedCallback = Utils.debounce(callback, CONFIG.DEBOUNCE_DELAY);

      const processedCallback = (mutationsList) => {
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
      STATE.observer.observe(document.documentElement, observerConfig);
      return STATE.observer;
    },

    disconnectExisting() {
      if (STATE.observer) {
        STATE.observer.disconnect();
        STATE.observer = null;
      }
    },

    isElementOrContainsRelevant(element, platformRelevantClasses) {
      if (!element || typeof element.matches !== "function") return false;
      if (this.isRelevantSingleElement(element, platformRelevantClasses))
        return true;

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
      ensureBasicInit();
      const pageInfo = getLichessPageInfo();
      if (!pageInfo.gameId && !pageInfo.studyId) {
        console.log(getMsg("logPgnFetchNoId"));
        return null;
      }

      const idToFetch = pageInfo.gameId || pageInfo.studyId;
      const isStudy = !pageInfo.gameId && pageInfo.studyId;

      const cacheKey = `lichess_${idToFetch}`;
      const cachedPgn = this._getFromCache(cacheKey);
      if (cachedPgn) {
        console.log(getMsg("logPgnFromCacheLichess"));
        return cachedPgn;
      }

      try {
        const pgn = await fetchPgnFromApi(idToFetch, isStudy);
        if (pgn) {
          this._setCacheWithExpiry(cacheKey, pgn);
        }
        return pgn;
      } catch (error) {
        console.error(getMsg("logPgnFetchApiErrorLichess"), error);
        return null;
      }
    },

    async fromChessCom() {
      ensureBasicInit();
      const pageInfo = getChessComPageInfo();
      const cacheKey = `chesscom_${
        pageInfo.gameId || window.location.pathname
      }`;
      const cachedPgn = this._getFromCache(cacheKey);
      if (cachedPgn) {
        console.log(getMsg("logPgnFromCache"));
        return cachedPgn;
      }

      NotificationManager.show(
        STATE.isSlowDevice
          ? getMsg("notificationPgnExtractionSlow")
          : getMsg("notificationPgnExtraction"),
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
              console.log(getMsg("logRetryingInMs", waitTime.toString()));
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
          "Unable to retrieve the PGN from the Chess.com page after several attempts."
        );
      } catch (error) {
        console.error("[WintrChess] Error extracting PGN:", error);
        NotificationManager.show(
          getMsg("notificationPgnExtractionError"),
          5000
        );
        throw error;
      }
    },
  };

  function fetchPgnFromApi(id, isStudy = false) {
    const apiUrl = isStudy
      ? `https://lichess.org/study/${id}.pgn?pgnInJson=false&moves=true&tags=true&clocks=false&evals=false&opening=false`
      : `https://lichess.org/game/export/${id}?pgnInJson=false&moves=true&tags=true&clocks=false&evals=false&opening=false`;

    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { action: "fetchPgn", url: apiUrl },
        (response) => {
          if (chrome.runtime.lastError) {
            const errorMsg =
              chrome.runtime.lastError.message ||
              "Background script communication error";
            console.error(
              "[WintrChess] fetchPgnFromApi runtime error:",
              errorMsg
            );
            return reject(errorMsg);
          }
          if (response && response.success) {
            resolve(response.data.trim());
          } else {
            const errorDetail = response
              ? response.error
              : "Unknown error from background script";
            console.error(
              "[WintrChess] fetchPgnFromApi response error:",
              errorDetail
            );
            reject(errorDetail);
          }
        }
      );
    });
  }

  const ButtonFactory = {
    create(options) {
      const { className, style, innerHTML, onClick } = options;
      const button = document.createElement("button");
      if (className.includes("wintchess-aurora-button")) {
        button.className = className;
      } else {
        button.className = className + " wintchess-button";
      }

      if (style) {
        button.style.cssText = style;
      }
      button.innerHTML = innerHTML;
      this.attachEventHandler(button, onClick);
      return button;
    },

    attachEventHandler(button, onClickHandler) {
      button.addEventListener("click", async (event) => {
        event.stopPropagation();
        event.preventDefault();
        button.disabled = true;
        ensureBasicInit();

        const textElement = button.querySelector(".button-text") || button;
        const originalText = textElement.textContent;
        textElement.textContent = getMsg("buttonStateRetrievingPgn");

        try {
          const pgn = await onClickHandler();
          if (pgn) {
            await chromeStorage.setValue(CONFIG.PGN_STORAGE_KEY, pgn);
            chrome.runtime.sendMessage({
              action: "openWintrChess",
              url: CONFIG.WINTRCHESS_URL,
            });
          } else {
            NotificationManager.show(getMsg("notificationPgnFetchError"));
          }
        } catch (error) {
          console.error("[WintrChess] Error on button click:", error);
          NotificationManager.show(
            getMsg("notificationGenericErrorPrefix") +
              (error.message || getMsg("notificationPgnFetchError"))
          );
        } finally {
          setTimeout(() => {
            if (button && button.isConnected) {
              button.disabled = false;
              textElement.textContent = originalText;
            }
          }, 1000);
        }
      });
    },
  };

  function getButtonConfigs(localizedButtonText) {
    // Ensure CSS is injected if on Lichess and not already done
    if (STATE.platform === "lichess" && !STATE.customCssInjected) {
      injectLichessCustomButtonCss();
    }
    return {
      lichess: {
        className: "wintchess-aurora-button",
        innerHTML: `
          <svg class="wintchess-icon" viewBox="0 0 32 32" aria-hidden="true">
            <path d="M16 26.5c5.8 0 10.5-4.7 10.5-10.5S21.8 5.5 16 5.5 5.5 10.2 5.5 16 10.2 26.5 16 26.5M12 14l3 3h-2v4h6v-4h-2l3-3h-2V9h-4v5z"></path>
          </svg>
          <span class="button-text">${localizedButtonText}</span>
        `,
      },
      chesscom: {
        className:
          "cc-button-component cc-button-primary cc-button-xx-large cc-bg-primary cc-button-full",
        style: `margin-top: 8px; width: 100%; margin-bottom: 6px;`,
        innerHTML: `<span class="cc-icon-glyph cc-icon-large cc-button-icon">${CHESS_ICON_SVG}</span><span class="cc-button-one-line button-text">${localizedButtonText}</span>`,
      },
      gameOver: {
        className:
          "cc-button-component cc-button-primary cc-button-xx-large cc-bg-primary cc-button-full",
        style: `width: 100%; margin-top: 3px; margin-bottom: 6px;`,
        innerHTML: `<span class="cc-icon-glyph cc-icon-large cc-button-icon" style="flex-shrink: 0;">${CHESS_ICON_SVG}</span><span class="button-text" style="white-space: normal; overflow: visible; text-overflow: initial;">${localizedButtonText}</span>`,
      },
    };
  }

  function createWintrChessButton(type = STATE.platform) {
    ensureBasicInit();
    const BUTTON_CONFIGS = getButtonConfigs(CONFIG.BUTTON_TEXT);

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
    ensureBasicInit();
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
        "wintchess-button-container game-over-review-button-component";
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
        referenceNode = buttonList.firstChild;
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
        "[WintrChess] Error adding button to game over modal:",
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
        setTimeout(() => this.clear(), 500);
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
    ensureBasicInit();
    if (!STATE.platform) STATE.platform = platform;

    if (platform === "chess.com") {
      const pageInfo = getChessComPageInfo();
      if (pageInfo.isReviewPage) {
        ButtonManager.removeAllButtons();
        return false;
      }
      if (tryAddButtonToGameOverModal()) {
        return true;
      }
      if (STATE.buttonInstances.has("chesscom_gameover_modal")) {
        ButtonManager.removeButtonById("chesscom_gameover_modal");
      }
    }

    let targets = ButtonManager.getTargets(platform);

    if (platform === "chess.com") {
      const bilanButton = findGameReviewButton();
      if (bilanButton && bilanButton.parentNode) {
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
      buttonCreator: () => createWintrChessButton(platform), // Pass platform to ensure correct config is used
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
        ensureBasicInit();
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

        const existingInstance = STATE.buttonInstances.get(id);
        if (
          checkExisting &&
          existingInstance &&
          document.contains(existingInstance.button)
        ) {
          STATE.buttonAdded = true;
          return true;
        }

        if (existingInstance && !document.contains(existingInstance.button)) {
          STATE.buttonInstances.delete(id);
          buttonCache.delete(id);
        }

        if (document.readyState !== "complete" && attempts < 5) {
          setTimeout(() => actualRetryFn(attempts + 1), CONFIG.RETRY_DELAY / 2);
          return false;
        }

        let button = buttonCache.get(id);
        if (!button || !document.contains(button)) {
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
          console.warn(getMsg("logMaxAttemptsReached", [id]));
          setTimeout(() => actualRetryFn(0), CONFIG.LONG_RETRY_DELAY * 2);
        }
        return false;
      },

      insertButton(id, button, targets) {
        let sortedTargets = targetCache.get(JSON.stringify(targets));
        if (!sortedTargets) {
          sortedTargets = [...targets].sort(
            (a, b) => (b.priority || 0) - (a.priority || 0)
          );
          targetCache.set(JSON.stringify(targets), sortedTargets);
        }

        const buttonSelector =
          STATE.platform === "lichess"
            ? ".wintchess-aurora-button"
            : ".wintchess-button";

        for (const targetConfig of sortedTargets) {
          const { selector, method, element: predefinedElement } = targetConfig;
          let elementToAttachTo = null;

          if (predefinedElement && document.contains(predefinedElement)) {
            elementToAttachTo = predefinedElement;
          } else if (typeof selector === "string") {
            const elements = document.querySelectorAll(selector);
            if (elements.length > 0) {
              elementToAttachTo =
                Array.from(elements).find((el) => el.offsetParent !== null) ||
                elements[0];
            }
          }

          if (!elementToAttachTo) continue;

          if (
            method === "append" &&
            elementToAttachTo.querySelector(
              `:scope > ${buttonSelector}, :scope > .wintchess-button-container ${buttonSelector}`
            )
          )
            continue;
          if (
            (method === "after" || method === "afterend") &&
            elementToAttachTo.nextElementSibling &&
            (elementToAttachTo.nextElementSibling.matches(buttonSelector) ||
              elementToAttachTo.nextElementSibling.matches(
                `.wintchess-button-container ${buttonSelector}`
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
              elementToAttachTo.insertAdjacentElement(method, button);
            }
            STATE.buttonInstances.set(id, {
              button,
              element: elementToAttachTo,
              method,
            });
            return true;
          } catch (error) {
            console.warn(
              `[WintrChess] Failed to insert button with method ${method} on selector ${
                selector || "predefined element"
              }:`,
              error
            );
          }
        }
        return false;
      },

      getTargets(platform = STATE.platform) {
        const cacheKey = `targets_${platform}`;
        if (targetCache.has(cacheKey)) return targetCache.get(cacheKey);

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
    ensureBasicInit();
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
          /* ignore */
        }
      };

      const clickElementWithRetry = async (
        selectors,
        descriptionKey,
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
            if (element && typeof element.click === "function") {
              try {
                element.click();
                return true;
              } catch (e) {
                /* ignore click error, try next */
              }
            }
          }
          if (attempt < maxAttempts - 1) {
            await Utils.sleep(getDelay(attemptDelay));
          }
        }
        console.error(
          getMsg("logSharePanelClickFailed", [
            getMsg(descriptionKey),
            maxAttempts.toString(),
          ])
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
          `button[aria-label="${["Share", "Partager", "Compartir"]}"]`,
          ".icon-font-chess.share",
          '[data-cy="share-button"]',
          "button.share-button",
          "button.game-controls-component__share",
          `button[title="${["Share", "Partager", "Compartir"]}"]`,
        ];
        if (STATE.isSlowDevice) {
          shareButtonSelectors.push({
            findFn: () =>
              Array.from(document.querySelectorAll("button")).find((btn) => {
                const text = btn.textContent?.toLowerCase() || "";
                return ["Share", "Partager", "Compartir"].some((term) =>
                  text.includes(term.trim())
                );
              }),
          });
        }

        if (
          !(await clickElementWithRetry(
            shareButtonSelectors,
            "chessComShareButtonAriaLabel",
            STATE.isSlowDevice ? 8 : 5
          ))
        ) {
          return reject(getMsg("errorSharePanelOpenFailed"));
        }
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
            "descriptionPgnTab",
            5,
            getDelay(500)
          ))
        ) {
          closeSharePanel();
          return reject(getMsg("errorPgnTabNotFound"));
        }
        await Utils.sleep(getDelay(STATE.isSlowDevice ? 1500 : 1000));

        const pgn = await extractPgnValue(5, getDelay(500));
        closeSharePanel();
        if (pgn) {
          resolve(pgn);
        } else {
          reject(getMsg("errorPgnTextareaExtractionFailed"));
        }
      })().catch((err) => {
        closeSharePanel();
        reject(err);
      });

      if (STATE.isSlowDevice) {
        NotificationManager.show(
          getMsg("notificationPgnExtractionSlowChessCom"),
          5000
        );
      }
    });
  }

  function findGameReviewButton() {
    ensureBasicInit();
    const reviewTerms = CONFIG.BUTTON_SELECTORS.REVIEW_TERMS;
    const selectors = [
      "button.game-over-review-button-component",
      ".game-review-buttons-component > button.cc-button-component.cc-button-primary",
      ".game-over-buttons-component .button-with-icon-primary",
      ".sidebar-buttons-container button.ui_v5-button-component.primary",
      ".board-layout-sidebar .review-button-component button",
      ".layout-sidebar .review-button-component button",
      "button.cc-button-component.cc-button-primary.cc-button-xx-large.cc-bg-primary",
      "button.cc-button-component.cc-button-primary",
    ];

    for (const selector of selectors) {
      const buttons = document.querySelectorAll(
        selector + ":not(.wintchess-button):not(.wintchess-aurora-button)"
      );
      for (const btn of buttons) {
        const btnText = btn.textContent?.toLowerCase() || "";
        const ariaLabel = btn.getAttribute("aria-label")?.toLowerCase() || "";
        if (
          reviewTerms.some(
            (term) => btnText.includes(term) || ariaLabel.includes(term)
          )
        ) {
          if (
            !btnText.includes("new game") &&
            !btnText.includes("nouvelle partie")
          ) {
            return btn;
          }
        }
      }
    }
    const prominentButton = document.querySelector(
      "button.cc-button-component.cc-button-xx-large:not(.wintchess-button):not(.wintchess-aurora-button), .post-game-buttons-component button:first-of-type:not(.wintchess-button):not(.wintchess-aurora-button)"
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
    ensureBasicInit();
    if (STATE.isSlowDevice) {
      NotificationManager.show(
        getMsg("notificationWintrchessPreparingAnalysisSlow"),
        5000
      );
    }
    pasteAndAnalyzeWintrChess();
  }

  async function pasteAndAnalyzeWintrChess() {
    ensureBasicInit();
    const pgnToPaste = await chromeStorage.getValue(
      CONFIG.PGN_STORAGE_KEY,
      null
    );
    if (!pgnToPaste) return;

    const localizedAnalyzeButtonTexts = [
      "Analizar",
      "Analizar partida",
      "Analyser",
      "Analyze",
      "Analyze game",
    ];

    const selectorsConfig = [
      {
        textarea: "textarea.TerVPsT9aZ0soO8yjZU4",
        button: "button.rHBNQrpvd7mwKp3HqjVQ.THArhyJIfuOy42flULV6",
        priority: 3,
      },
      {
        textarea: 'textarea[placeholder*="PGN"]',
        buttonText: localizedAnalyzeButtonTexts,
        priority: 2,
      },
      {
        textarea: "textarea",
        buttonText: localizedAnalyzeButtonTexts,
        priority: 1,
      },
    ].sort((a, b) => b.priority - a.priority);

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

        textarea.value = pgnToPaste;
        textarea.dispatchEvent(
          new Event("input", { bubbles: true, cancelable: true })
        );
        textarea.dispatchEvent(
          new Event("change", { bubbles: true, cancelable: true })
        );
        await Utils.sleep(STATE.isSlowDevice ? 600 : 300);

        if (!button.disabled) {
          button.click();
          await chromeStorage.deleteValue(CONFIG.PGN_STORAGE_KEY);
          return true;
        }
        return false;
      } catch (error) {
        console.error(getMsg("logWintrchessAutoPasteError"), error);
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
        return;
      }

      attempts++;
      if (attempts >= maxAttempts) {
        NotificationManager.show(
          getMsg("notificationWintrchessAutoPasteFailed"),
          5000
        );
        if (navigator.clipboard && pgnToPaste) {
          try {
            await navigator.clipboard.writeText(pgnToPaste);
            NotificationManager.show(
              getMsg("notificationWintrchessAutoPasteFailedClipboard"),
              5000
            );
          } catch (clipError) {
            console.error(
              "[WintrChess] Failed to copy PGN to clipboard:",
              clipError
            );
          }
        }
        return;
      }

      delayMs = Math.min(delayMs * 1.2, CONFIG.LONG_RETRY_DELAY);
      setTimeout(attemptPasteRecursive, delayMs);
    };

    setTimeout(attemptPasteRecursive, STATE.isSlowDevice ? 800 : 500);
  }

  function findWintrChessButtonByText(textOptions) {
    const optionsArray = Array.isArray(textOptions)
      ? textOptions
      : [textOptions];

    const allButtons = Array.from(
      document.querySelectorAll("button:not([disabled])")
    );
    for (const text of optionsArray) {
      const foundButton = allButtons.find((button) =>
        button.textContent?.toLowerCase().includes(text.toLowerCase())
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

  // ===== MESSAGE LISTENER FOR ICON CLICK =====
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "extractPgnFromIconClick") {
      (async () => {
        try {
          ensureBasicInit();

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
            sendResponse({ error: "Failed to extract PGN (content script)." });
          }
        } catch (e) {
          console.error(
            "[WintrChess] Error during icon click PGN extraction (content.js):",
            e
          );
          NotificationManager.show(
            getMsg("notificationGenericErrorPrefix") +
              (e.message || "Unknown PGN extraction error")
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

  // ===== BOOTSTRAP =====
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
