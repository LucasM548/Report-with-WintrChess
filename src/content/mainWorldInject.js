(function() {
  try {
     let pgn = null;
     if (window.chesscom && window.chesscom.liveGame && window.chesscom.liveGame.pgn) {
        pgn = window.chesscom.liveGame.pgn;
     }
     window.postMessage({ type: 'WINTRCHESS_PGN_RES', pgn: pgn, success: true }, '*');
  } catch(e) {
     window.postMessage({ type: 'WINTRCHESS_PGN_RES', error: e.message, success: false }, '*');
  }
})();
