import { STATE } from './state.js';
import { CONFIG, ensureBaseInitialized } from './config.js';
import { Utils, NotificationManager, getPlatform, getLichessPageInfo, getChessComPageInfo } from './utils.js';
import { DomObserverManager } from './domObserver.js';
import { ButtonManager, tryAddWintrChessButton } from './buttonManager.js';
import { PgnExtractor } from './pgnExtractor.js';
import { initWintrChessAutoPaste } from './wintrchess.js';

function isPageRelevant(platformName) {
  if (platformName === "lichess") return getLichessPageInfo().isRelevantPage;
  if (platformName === "chess.com") return getChessComPageInfo().isRelevantPage;
  return false;
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

  // Periodic check that the button is still in the DOM.
  // On SPA navigation (Chess.com / Lichess), we detect when the page is no longer
  // relevant and stop polling to avoid resource leaks.
  let lastUrl = window.location.href;
  const periodicCheckId = setInterval(() => {
    if (document.visibilityState === "hidden") return;

    const currentUrl = window.location.href;
    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl;
      // URL changed (SPA navigation) — clean up existing buttons.
      // Don't kill the interval: the user may navigate back to a game page.
      ButtonManager.removeAllButtons();
      if (isPageRelevant(platformName)) {
        tryAddWintrChessButton(platformName);
      }
      return;
    }

    if (
      STATE.buttonInstances.size === 0 ||
      (!document.querySelector(".wintchess-button") && !document.querySelector(".wintchess-button-container"))
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

function init() {
  STATE.platform = getPlatform();
  if (!STATE.platform) return;

  ensureBaseInitialized();

  if (STATE.platform === "lichess") {
    initializeSupportedPlatform("lichess", getLichessPageInfo);
  } else if (STATE.platform === "chess.com") {
    initializeSupportedPlatform("chess.com", getChessComPageInfo);
  } else if (STATE.platform === "wintrchess") {
    initWintrChessAutoPaste();
  }
}

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
          console.log(
            "[WintrChess Notification] Icon click on unsupported page for PGN extraction:",
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
        console.log(
          "[WintrChess Notification] Error during icon click PGN extraction (content.js):",
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

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
