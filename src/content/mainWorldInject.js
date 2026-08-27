(function() {
  try {
    // Try multiple known paths in the Chess.com global state
    const pgn =
      window.chesscom?.game?.pgn ??
      window.chesscom?.liveGame?.pgn ??
      window.chesscom?.dailyGame?.pgn ??
      window.chesscom?.computerGame?.pgn ??
      window.chesscom?.analysis?.pgn ??
      null;

    window.postMessage({ type: 'WINTRCHESS_PGN_RES', pgn: pgn, success: !!pgn }, '*');
  } catch(e) {
    window.postMessage({ type: 'WINTRCHESS_PGN_RES', error: e.message, success: false }, '*');
  }
})();
