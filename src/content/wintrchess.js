import { Utils, NotificationManager, chromeStorage } from './utils.js';
import { CONFIG, ensureBaseInitialized } from './config.js';

export function initWintrChessAutoPaste() {
  pasteAndAnalyzeOnWintrChess();
  handleAutoFlipOnWintrChess();
}

async function handleAutoFlipOnWintrChess() {
  const orientation = await chromeStorage.getValue(CONFIG.ORIENTATION_STORAGE_KEY, null);
  if (orientation !== "black") return;

  await chromeStorage.deleteValue(CONFIG.ORIENTATION_STORAGE_KEY);

  const flipButtonSelector = 'button[data-tooltip-id="options-toolbar-flip"]';
  const MAX_ATTEMPTS = 20;
  
  let attempts = 0;
  const intervalId = setInterval(() => {
      attempts++;
      const btn = document.querySelector(flipButtonSelector);
      if (btn) {
          console.log("[WintrChess] Auto-flipping board to Black.");
          btn.click();
          clearInterval(intervalId);
      } else if (attempts >= MAX_ATTEMPTS) {
          clearInterval(intervalId);
      }
  }, 500);
}

async function pasteAndAnalyzeOnWintrChess() {
  const pgnToPaste = await chromeStorage.getValue(CONFIG.PGN_STORAGE_KEY, null);
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

  const findWintrChessElements = () => {
    for (const sel of selectorsConfig) {
      const textareas = document.querySelectorAll(sel.textarea);
      for (const textarea of textareas) {
        if (!textarea || textarea.offsetParent === null || textarea.disabled || textarea.readOnly) {
          continue;
        }

        let button = null;
        if (sel.buttonText && Array.isArray(sel.buttonText) && sel.buttonText.length > 0) {
          const potentialButtonContainers = [
            textarea.parentElement?.parentElement,
            document.body,
          ];

          for (const container of potentialButtonContainers) {
            if (!container) continue;
            button = Array.from(
              container.querySelectorAll("button:not([disabled]), [role='button']:not([disabled])")
            ).find(
              (btn) =>
                sel.buttonText.some((txt) =>
                  (Utils.getElementInnerText(btn) || "").toLowerCase().includes(txt)
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
      await Utils.sleep(50);
      textarea.value = pgnToPaste;
      textarea.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
      textarea.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));

      await Utils.sleep(100);

      if (!button.disabled) {
        button.click();
        await chromeStorage.deleteValue(CONFIG.PGN_STORAGE_KEY);
        return true;
      }
      return false;
    } catch (error) {
      console.log(Utils.getMsg("logWintrchessAutoPasteError"), error);
      return false;
    }
  };

  const MAX_WAIT_TIME = 15000;
  
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

  timeoutId = setTimeout(async () => {
    cleanup();
    
    let failMessage = Utils.getMsg("notificationWintrchessAutoPasteFailed");
    if (navigator.clipboard && pgnToPaste) {
        try {
          await navigator.clipboard.writeText(pgnToPaste);
          failMessage = Utils.getMsg("notificationWintrchessAutoPasteFailedClipboard");
        } catch (clipError) {
          console.log("[WintrChess Notification] Failed to copy PGN to clipboard:", clipError);
        }
    }
    NotificationManager.show(failMessage, 6000);
    await chromeStorage.deleteValue(CONFIG.PGN_STORAGE_KEY).catch(e => console.log("Failed to clear PGN", e));

  }, MAX_WAIT_TIME);
}
