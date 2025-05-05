# Chess Sites to WintrChess PGN Transfer

This Tampermonkey script allows you to easily transfer your chess games from **Lichess** and **Chess.com** to **[WintrChess](https://wintrchess.com/)** for in-depth analysis.

**[Video Presantation of WintrChess](https://wintrchess.com/)**

## ✨ Features

- Adds an "Analyze on WintrChess" button on Lichess and Chess.com
- Compatible with game pages, analysis boards, and studies
- Automatic PGN extraction via API or scraping
- One-click transfer to WintrChess
- Works on completed games or during analysis

## 🚀 Installation

1. **Prerequisites**: Install the [Tampermonkey](https://www.tampermonkey.net/) extension for your browser
   - [Chrome](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)
   - [Firefox](https://addons.mozilla.org/en-US/firefox/addon/tampermonkey/)
   - [Edge](https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpaadaobahmlepeloendndfphd)
   - [Safari](https://apps.apple.com/app/tampermonkey/id1482490089)

2. **Script Installation**:
   - Click [here](https://github.com/LucasM548/Report-with-Wintrches/raw/main/Report-with-Wintrches.js) to install the script directly
   - OR
   - Open Tampermonkey in your browser
   - Click on the "Add Script" tab
   - Copy the content of the `Report-with-Wintrches.js` file
   - Paste it into the Tampermonkey editor
   - Save the script (Ctrl+S or File > Save)

## 🎮 Usage

1. Navigate to a chess game on Lichess or Chess.com
2. You'll see an "Analyze on WintrChess" button appear
3. Click on this button
4. A new WintrChess window will open with your game ready for analysis

## 🔍 Compatible Sites

- **Lichess**:
  - Game pages (`lichess.org/{gameID}`)
  - Study pages (`lichess.org/study/{studyID}`)
  - Analysis pages (`lichess.org/analysis`)

- **Chess.com**:
  - Live games (`chess.com/game/live`)
  - Daily games (`chess.com/game/daily`)
  - Computer games (`chess.com/game/computer`)
  - Analysis pages (`chess.com/analysis`)
  - Play interface (`chess.com/play`)

## 💡 Acknowledgements

This script is made possible thanks to the incredible work of [WintrCat](https://wintrcat.uk/), creator of WintrChess, a powerful and innovative chess analysis platform.

## 🤖 Development Note

This script was developed with the assistance of AI to help implement the best practices for PGN extraction and web integration.

## 📝 License

MIT License

## 🐛 Report an Issue

If you encounter any problems with this script, please open an issue on this GitHub repository.
