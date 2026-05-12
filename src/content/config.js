import { Utils } from './utils.js';

export const CONFIG = {
  WINTRCHESS_URL: "https://wintrchess.com/",
  PGN_STORAGE_KEY: "wintrChessPgnToPaste",
  ORIENTATION_STORAGE_KEY: "wintrChessOrientation",
  BUTTON_TEXT_KEY: "buttonTextAnalyzeWintrChess",
  RETRY_DELAY: 1000,
  LONG_RETRY_DELAY: 3000,
  DEBOUNCE_DELAY: 250,
  BUTTON_CHECK_INTERVAL: 5000,
  SLOW_DEVICE_THRESHOLD: 50,
  BUTTON_SELECTORS: {
    REVIEW_TERMS: [
      "Game Review",
      "Отчет о партии",
      "Bilan de la partie",
      "Partieanalyse",
      "Revisión de partida",
      "खेल की समीक्षा",
    ],
    SHARED: [
      {
        selector: ".game-over-modal-content, .game-over-modal-shell-content",
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
  BUTTON_TEXT: "",
};

export function ensureBaseInitialized() {
  if (CONFIG.BUTTON_TEXT) return; // already initialized
  CONFIG.BUTTON_TEXT = Utils.getMsg(CONFIG.BUTTON_TEXT_KEY);
  if (!CONFIG.BUTTON_SELECTORS.REVIEW_TERMS_LOWERCASE) {
    CONFIG.BUTTON_SELECTORS.REVIEW_TERMS_LOWERCASE =
      CONFIG.BUTTON_SELECTORS.REVIEW_TERMS.map((term) => term.toLowerCase());
  }
}
