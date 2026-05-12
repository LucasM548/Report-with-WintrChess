import { STATE } from './state.js';
import { ensureBaseInitialized } from './config.js';
import { Utils, NotificationManager, getLichessPageInfo, getChessComPageInfo } from './utils.js';

export const PgnExtractor = {
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
            let pgnText = response.data;
            if (typeof pgnText === 'object' && pgnText !== null) {
              pgnText = pgnText.pgn || JSON.stringify(pgnText);
            }
            resolve(pgnText);
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
      console.log(Utils.getMsg("logPgnFetchApiErrorLichess"), error);
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

    if (gameId) {
      try {
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

    NotificationManager.show(
      Utils.getMsg("notificationPgnExtraction"),
      4000
    );

    try {
      const pgn = await this._extractChessComPgnViaMainWorld();
      if (pgn) this._setCache(cacheKey, pgn);
      return pgn;
    } catch (error) {
      console.log("[WintrChess Notification] Error extracting Chess.com PGN via internal state, falling back to UI clicks:", error);
      try {
         const pgnUi = await this._extractChessComPgnViaSharePanel();
         if (pgnUi) this._setCache(cacheKey, pgnUi);
         return pgnUi;
      } catch (errorUi) {
         NotificationManager.show(
           Utils.getMsg("notificationPgnExtractionError") + `: ${errorUi.message}`,
           5000
         );
         throw errorUi;
      }
    }
  },

  async _extractChessComPgnViaMainWorld() {
    // Inject a script to access window.chesscom if possible, or internal store
    return new Promise((resolve, reject) => {
      const scriptId = 'wintrchess-inject-pgn';
      const script = document.createElement('script');
      script.id = scriptId;
      script.src = chrome.runtime.getURL('src/content/mainWorldInject.js');
      
      const listener = (event) => {
        if (event.source !== window || event.data.type !== 'WINTRCHESS_PGN_RES') return;
        window.removeEventListener('message', listener);
        document.getElementById(scriptId)?.remove();
        
        if (event.data.success && event.data.pgn) {
          resolve(event.data.pgn);
        } else {
          reject(new Error("PGN not found in global state"));
        }
      };
      
      window.addEventListener('message', listener);
      document.body.appendChild(script);
      
      setTimeout(() => {
        window.removeEventListener('message', listener);
        document.getElementById(scriptId)?.remove();
        reject(new Error("Timeout waiting for global state extraction"));
      }, 2000);
    });
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
      console.log(
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
          console.log(
            "[WintrChess Notification] Non-critical error attempting to close share panel:",
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
