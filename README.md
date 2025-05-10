# ♟️Chess Sites to WintrChess PGN Transfer

Easily transfer your chess games from **Lichess** and **Chess.com** to **[WintrChess](https://wintrchess.com/)** for in-depth analysis. Available as both a Tampermonkey script and a Chrome extension.

**[Video Presentation of WintrChess](https://youtu.be/rT5isX7mQds?si=6taY4ExPdrVeVkfr)**

**[Extension on Chrome web Store](https://chromewebstore.google.com/detail/chess-sites-to-wintrchess/ljjbgidgpkhjenpgpjfjidfflnelmpan?authuser=0&hl=en-GB)**

## ✨ Features

- Adds an "Analyze on WintrChess" button on Lichess and Chess.com
- Compatible with game pages, analysis boards, and studies
- Automatic PGN extraction via API or scraping
- One-click transfer to WintrChess
- Works on completed games or during analysis

### **Screenshots**

**Chess.com**
<img src="https://github.com/user-attachments/assets/257d8e46-e84f-4c5e-a9af-002871099326" alt="Chess.com Integration" height="500" />

**Lichess**
<img src="https://github.com/user-attachments/assets/7d787d19-8a95-4776-9fa3-7d3089ed20da" alt="Lichess Integration" height="500" />


## 🚀 Installation

1. **Developer Mode Installation**:
   - Download or clone this repository to your computer
   - Open Chrome and navigate to `chrome://extensions/`
   - Enable "Developer mode" in the top right corner
   - Click "Load unpacked extension"
   - Select the `extension` folder containing the `manifest.json` file
   - The extension is now installed and active!

## 🎮 Usage

1. Navigate to a chess game on Lichess or Chess.com
2. You'll see an "Analyze on WintrChess" button appear
3. Click on this button
4. A new WintrChess window will open with your game ready for analysis

**Alternatively:**

- Click directly on the extension icon in your browser toolbar
  - This will analyze the current chess game if one is detected
  - Or open WintrChess.com if no chess game is accessible on the current page

## 🔍 Compatible Sites

- **Lichess**:

  - Game pages (`lichess.org/{gameID}`)
  - Study pages (`lichess.org/study/{studyID}`)
  - Analysis pages (`lichess.org/analysis`)

- **Chess.com**:
  - Daily games (`chess.com/game/daily`)
  - Computer games (`chess.com/game/computer`)
  - Analysis pages (`chess.com/analysis`)
  - Play interface (`chess.com/play`)

## 🌐 Langues disponibles

L'extension est disponible dans les langues suivantes :

- Français (fr)
- Anglais (en)
- Espagnol (es)

## 💡 Acknowledgements

This script is made possible thanks to the incredible work of [WintrCat](https://wintrcat.uk/), creator of WintrChess, a powerful and innovative chess analysis platform.

## 🤖 Development Note

This script was developed with the assistance of AI to help implement the best practices for PGN extraction and web integration.

## 🐛 Report an Issue

If you encounter any problems with this script, please open an issue on this GitHub repository.
