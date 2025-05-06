// Background script pour l'extension Chess Sites to WintrChess
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Gestion des requêtes fetch vers Lichess (remplace GM_xmlhttpRequest)
  if (request.action === "fetchPgn") {
    fetch(request.url, {
      method: "GET",
      headers: {
        "Accept": "application/x-chess-pgn"
      }
    })
    .then(response => {
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return response.text();
    })
    .then(data => {
      sendResponse({ success: true, data: data });
    })
    .catch(error => {
      sendResponse({ success: false, error: error.message });
    });
    
    return true; // Indique que la réponse sera envoyée de manière asynchrone
  }
  
  // Ouvrir WintrChess dans un nouvel onglet
  if (request.action === "openWintrChess") {
    chrome.tabs.create({ url: request.url });
    sendResponse({ success: true });
    return true;
  }
});
