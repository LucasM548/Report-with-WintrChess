import { Utils, chromeStorage, getBoardOrientation } from './utils.js';
import { STATE } from './state.js';
import { CONFIG, ensureBaseInitialized } from './config.js';
import { PgnExtractor } from './pgnExtractor.js';
import rawStyles from '../styles.css?raw';

// Remove !important from rawStyles for cleaner CSS
const cleanStyles = rawStyles.replace(/!important/g, '');

const ButtonFactory = {
  create(options) {
    const { className, style, innerHTML, onClick, useShadowDom } = options;
    
    // Create the host container
    const host = document.createElement("div");
    host.className = "wintchess-button-container";
    if (style) host.style.cssText = style;

    // Create the actual button
    const button = document.createElement("button");
    button.className = className;
    if (!className.includes("wintchess-aurora-button")) {
      button.classList.add("wintchess-button");
    }
    button.innerHTML = innerHTML;
    
    this.attachEventHandler(button, onClick);

    if (useShadowDom) {
      // Attach shadow DOM
      const shadow = host.attachShadow({ mode: 'open' });
      const styleEl = document.createElement('style');
      styleEl.textContent = cleanStyles;
      shadow.appendChild(styleEl);
      shadow.appendChild(button);
    } else {
      host.appendChild(button);
    }

    return host; // Return the host which contains the button
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
          
          const orientation = getBoardOrientation(STATE.platform);
          if (orientation === "black") {
             await chromeStorage.setValue(CONFIG.ORIENTATION_STORAGE_KEY, "black");
          } else {
             await chromeStorage.deleteValue(CONFIG.ORIENTATION_STORAGE_KEY);
          }

          chrome.runtime.sendMessage({
            action: "openWintrChess",
            url: CONFIG.WINTRCHESS_URL,
          });
        }
      } catch (error) {
        console.log("[WintrChess Notification] Error on button click:", error);
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
      useShadowDom: true, // Use Shadow DOM for custom styled buttons
    },
    chesscom: {
      className: "cc-button-component cc-button-primary cc-button-xx-large cc-bg-primary cc-button-full",
      style: `margin-top: 8px; width: calc(100% - 30px); margin-bottom: 6px; margin-left: 15px; margin-right: 15px;`,
      innerHTML: `<span class="cc-button-one-line button-text">${localizedButtonText}</span>`,
      useShadowDom: false, // Don't use Shadow DOM because it relies on Chess.com global CSS
    },
    chesscomGameOver: {
      className: "cc-button-component cc-button-primary cc-button-xx-large cc-bg-primary cc-button-full game-over-review-button-game-over-review-button",
      innerHTML: `${localizedButtonText}`,
      useShadowDom: false,
    },
  };
}

export function createWintrChessButton(platform, type = "default") {
  ensureBaseInitialized();
  const RENDER_CONFIGS = getButtonRenderConfigs(CONFIG.BUTTON_TEXT);

  let config;
  if (platform === "lichess") {
    config = RENDER_CONFIGS.lichess;
  } else if (platform === "chess.com") {
    config = type === "gameOver" ? RENDER_CONFIGS.chesscomGameOver : RENDER_CONFIGS.chesscom;
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

export const ButtonManager = (() => {
  const targetCache = new Map();

  const getRetryDelay = (attempts) =>
    Math.min(CONFIG.RETRY_DELAY * Math.pow(1.5, attempts), CONFIG.LONG_RETRY_DELAY) * STATE.performanceFactor;

  const MAX_ATTEMPTS = 50;

  return {
    addButton({ id, buttonCreator, targets, attempts = 0, retryFn, checkExisting = true }) {
      const existingInstance = STATE.buttonInstances.get(id);
      if (checkExisting && existingInstance && document.contains(existingInstance.button)) {
        return true;
      }
      if (existingInstance && !document.contains(existingInstance.button)) {
        STATE.buttonInstances.delete(id);
      }

      if (document.readyState !== "complete" && attempts < 5) {
        setTimeout(() => retryFn(attempts + 1), (CONFIG.RETRY_DELAY / 2) * STATE.performanceFactor);
        return false;
      }

      const button = buttonCreator();
      if (this._insertButtonDOM(id, button, targets)) {
        return true;
      }

      if (attempts < MAX_ATTEMPTS - 1) {
        setTimeout(() => retryFn(attempts + 1), getRetryDelay(attempts));
      } else {
        console.log(Utils.getMsg("logMaxAttemptsReached", id));
        setTimeout(() => retryFn(0), CONFIG.LONG_RETRY_DELAY * 3 * STATE.performanceFactor);
      }
      return false;
    },

    _insertButtonDOM(id, button, targets) {
      const sortedTargets = [...targets].sort((a, b) => (b.priority || 0) - (a.priority || 0));

      for (const targetConfig of sortedTargets) {
        const { selector, method = "append", element: predefinedElement } = targetConfig;
        let anchorElement = null;

        if (predefinedElement && document.contains(predefinedElement)) {
          anchorElement = predefinedElement;
        } else if (typeof selector === "string") {
          anchorElement = Array.from(document.querySelectorAll(selector)).find((el) => el.offsetParent !== null);
          if (!anchorElement) anchorElement = document.querySelector(selector);
        }

        if (!anchorElement) continue;

        const containerToCheck = method === "append" || method === "prepend" ? anchorElement : anchorElement.parentNode;
        if (!containerToCheck) continue;

        let existingButtonFound = false;
        const wintchessContainerSelector = ".wintchess-button-container";

        if (containerToCheck.querySelector(`:scope > ${wintchessContainerSelector}`)) {
          existingButtonFound = true;
        } else if (
          (method === "after" || method === "afterend") &&
          anchorElement.nextElementSibling &&
          anchorElement.nextElementSibling.matches(wintchessContainerSelector)
        ) {
          existingButtonFound = true;
        } else if (
          (method === "before" || method === "beforebegin") &&
          anchorElement.previousElementSibling &&
          anchorElement.previousElementSibling.matches(wintchessContainerSelector)
        ) {
          existingButtonFound = true;
        }

        if (existingButtonFound && id !== "chesscom_gameover_modal") {
          const currentInstance = STATE.buttonInstances.get(id);
          if (currentInstance && currentInstance.button && currentInstance.button.isConnected) {
            return true;
          }
          continue;
        }

        try {
          let finalButtonContainer = button;
          if (id === "chesscom_gameover_modal") {
            let existingContainer = anchorElement.querySelector(".wintchess-button-container.game-over-review-button-component");
            if (existingContainer) {
              existingContainer.remove();
            }
            finalButtonContainer.classList.add("game-over-review-button-component");
          }

          if (method === "append") anchorElement.appendChild(finalButtonContainer);
          else if (method === "prepend") anchorElement.prepend(finalButtonContainer);
          else if (method === "after" || method === "afterend") anchorElement.after(finalButtonContainer);
          else if (method === "before" || method === "beforebegin") anchorElement.before(finalButtonContainer);
          else anchorElement.insertAdjacentElement(method, finalButtonContainer);

          STATE.buttonInstances.set(id, {
            button: finalButtonContainer,
            element: anchorElement,
            method,
          });
          return true;
        } catch (error) {
          console.log(`[WintrChess Notification] Failed to insert button "${id}" with method "${method}":`, error);
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
        platformTargets = [...CONFIG.BUTTON_SELECTORS.CHESS_COM, ...CONFIG.BUTTON_SELECTORS.SHARED];
      }

      targetCache.set(platformKey, platformTargets);
      return platformTargets;
    },

    removeButtonById(id) {
      const instance = STATE.buttonInstances.get(id);
      if (instance && instance.button && instance.button.parentNode) {
        instance.button.parentNode.removeChild(instance.button);
      }
      STATE.buttonInstances.delete(id);
    },

    removeAllButtons() {
      STATE.buttonInstances.forEach(({ button }) => {
        if (button && button.parentNode) {
          button.parentNode.removeChild(button);
        }
      });
      STATE.buttonInstances.clear();
    },
  };
})();

export function tryAddWintrChessButton(platform, attempts = 0) {
  ensureBaseInitialized();

  if (platform === "chess.com") {
    tryAddButtonToChessComGameOverModal();

    if (
      STATE.buttonInstances.has("chesscom_gameover_modal") &&
      !document.querySelector(".game-over-modal-content .wintchess-button-container, .game-over-modal-shell-content .wintchess-button-container")
    ) {
      ButtonManager.removeButtonById("chesscom_gameover_modal");
    }

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
        ...targets.filter((t) => !gameReviewButton.closest(t.selector) && !t.selector.includes("game-over-modal-content") && !t.selector.includes("game-over-modal-shell-content")),
      ];
    } else {
      targets = targets.filter((t) => !t.selector.includes("game-over-modal-content") && !t.selector.includes("game-over-modal-shell-content"));
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

  const modalContent = document.querySelector(".game-over-modal-content, .game-over-modal-shell-content");
  if (!modalContent) return false;

  const buttonId = "chesscom_gameover_modal";

  const existingInstance = STATE.buttonInstances.get(buttonId);
  if (existingInstance && existingInstance.button && existingInstance.button.isConnected) {
    return true;
  }

  const buttonList = modalContent.querySelector(".game-over-modal-buttons, .game-over-modal-shell-buttons");
  if (!buttonList) return false;

  const targets = [{ element: buttonList, method: "append", priority: 100 }];

  if (!document.querySelector(targets[0].element.tagName.toLowerCase() + (targets[0].element.className ? "." + targets[0].element.className.trim().split(/\s+/).join(".") : ""))) {
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
    ".game-over-modal-shell-content",
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
    if (btn.classList.contains("wintchess-button") || btn.closest(".wintchess-button-container")) {
      continue;
    }

    const btnFullText = Utils.getElementInnerText(btn).toLowerCase();
    const ariaLabel = (btn.getAttribute("aria-label") || "").toLowerCase().trim();

    const isReviewButton = reviewTermsLowercase.some(
      (term) => btnFullText.includes(term) || ariaLabel.includes(term)
    );

    if (isReviewButton) {
      if (btnFullText.length > 3 || ariaLabel.length > 3 || btn.querySelector(".icon-font-chess, svg")) {
        return btn;
      }
    }
  }
  return null;
}
