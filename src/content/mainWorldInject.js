(function() {
  try {
     const pgn = window.chesscom?.liveGame?.pgn ?? null;
     window.postMessage({ type: 'WINTRCHESS_PGN_RES', pgn: pgn, success: true }, '*');
  } catch(e) {
     window.postMessage({ type: 'WINTRCHESS_PGN_RES', error: e.message, success: false }, '*');
  }
})();
