import { STATE } from './state.js';
import { CONFIG, ensureBaseInitialized } from './config.js';
import { Utils, NotificationManager, getPlatform, getLichessPageInfo, getChessComPageInfo } from './utils.js';
import { DomObserverManager } from './domObserver.js';
import { ButtonManager, tryAddWintrChessButton } from './buttonManager.js';
import { PgnExtractor } from './pgnExtractor.js';
import { initWintrChessAutoPaste } from './wintrchess.js';

function detectDevicePerformance() {
  STATE.isSlowDevice = false;
  STATE.performanceFactor = 1;
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
  detectDevicePerformance();

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
