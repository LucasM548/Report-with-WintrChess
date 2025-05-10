const WINTRCHESS_URL = "https://wintrchess.com/";
const PGN_STORAGE_KEY = "wintrChessPgnToPaste";

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "fetchPgn") {
    fetch(request.url, {
      method: "GET",
      headers: {
        Accept: "application/x-chess-pgn",
      },
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.text();
      })
      .then((data) => {
        sendResponse({ success: true, data: data });
      })
      .catch((error) => {
        console.error("[WintrChess Background] Fetch PGN error:", error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }

  if (request.action === "openWintrChess") {
    chrome.tabs.create({ url: request.url || WINTRCHESS_URL });
    sendResponse({ success: true });
    return true;
  }

  if (request.action === "storePgnAndOpenWintrChess") {
    if (request.pgn) {
      chrome.storage.local.set({ [PGN_STORAGE_KEY]: request.pgn }, () => {
        if (chrome.runtime.lastError) {
          console.error(
            "[WintrChess Background] Error setting PGN in storage:",
            chrome.runtime.lastError
          );
          sendResponse({ success: false, error: "Storage error" });
          return;
        }
        chrome.tabs.create({ url: WINTRCHESS_URL });
        sendResponse({ success: true });
      });
    } else {
      console.error(
        "[WintrChess Background] No PGN provided to storePgnAndOpenWintrChess"
      );
      sendResponse({ success: false, error: "No PGN provided" });
    }
    return true;
  }
});

// Gérer le clic sur l'icône de l'extension
chrome.action.onClicked.addListener(async (tab) => {
  if (
    tab.url &&
    (tab.url.startsWith("https://lichess.org/") ||
      tab.url.startsWith("https://www.chess.com/"))
  ) {
    try {
      const response = await chrome.tabs.sendMessage(tab.id, {
        action: "extractPgnFromIconClick",
      });

      if (response && response.pgn) {
        await chrome.storage.local.set({ [PGN_STORAGE_KEY]: response.pgn });
        chrome.tabs.create({ url: WINTRCHESS_URL });
      } else if (response && response.error) {
        console.error(
          "[WintrChess Background] Error from content script during icon click:",
          response.error
        );
      } else {
        console.error(
          "[WintrChess Background] No PGN or invalid response from content script after icon click."
        );
      }
    } catch (error) {
      console.error(
        "[WintrChess Background] Error sending message to content script or processing response:",
        error.message
      );
    }
  } else {
    // Si l'onglet actif n'est ni Lichess ni Chess.com, ouvrir WintrChess directement.
    // L'utilisateur pourra alors coller un PGN manuellement.
    chrome.tabs.create({ url: WINTRCHESS_URL });
    console.log(
      "[WintrChess Background] Icon clicked on non-chess page, opening WintrChess directly."
    );
  }
});
