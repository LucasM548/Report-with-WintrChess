export const Utils = {
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
      console.log(
        `[WintrChess Notification] Missing/Error for i18n key: ${messageKey}`,
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

export const chromeStorage = {
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

export const NotificationManager = (() => {
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

export function getPlatform() {
  const hostname = window.location.hostname;
  if (hostname.includes("lichess.org")) return "lichess";
  if (hostname.includes("www.chess.com")) return "chess.com";
  if (hostname.includes("wintrchess.com")) return "wintrchess";
  return null;
}

export function getBoardOrientation(platform) {
  if (platform === "lichess") {
    if (document.querySelector(".orientation-black")) return "black";
    if (window.location.pathname.includes("/black")) return "black";
    return "white";
  } else if (platform === "chess.com") {
    if (document.querySelector(".flipped") || document.querySelector(".board.flipped")) return "black";
    return "white";
  }
  return "white";
}

export function getLichessPageInfo() {
  const path = window.location.pathname;
  const gameIdRegex = /^\/([a-zA-Z0-9]{8})(?:\/(?:white|black))?(?:#\d+)?$/;

  return {
    isRelevantPage: gameIdRegex.test(path) || path.startsWith("/analysis"),
    gameId: gameIdRegex.test(path) ? path.split("/")[1] : null,
  };
}

export function getChessComPageInfo() {
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
