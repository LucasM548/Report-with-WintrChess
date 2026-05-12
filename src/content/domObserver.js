import { Utils } from './utils.js';
import { STATE } from './state.js';
import { CONFIG } from './config.js';

export const DomObserverManager = {
  _cachedSelectors: new Map(),
  _styleElement: null,

  getCombinedSelector(platform) {
    if (this._cachedSelectors.has(platform)) {
      return this._cachedSelectors.get(platform);
    }

    const relevantClassesByPlatform = {
      lichess: ["analyse__tools", "analyse__controls", "round__app"],
      "chess.com": [
        "board-controls",
        "game-controls",
        "post-game-controls",
        "game-over-modal-content",
        "analysis-controls",
        "modal-header-header",
        "sidebar-component",
        "board-layout-sidebar",
        "layout-column-two",
      ],
    };
    const relevantNodeNames = new Set(["chess-board", "vertical-move-list"]);

    const classes = relevantClassesByPlatform[platform] || [];
    const classSelectors = classes.map(c => "." + c.split(" ").join("."));
    const nodeSelectors = Array.from(relevantNodeNames);
    
    const combined = [...classSelectors, ...nodeSelectors].join(",");
    this._cachedSelectors.set(platform, combined);
    return combined;
  },

  setupObserver(callback, platform) {
    this.disconnect();
    const combinedSelector = this.getCombinedSelector(platform);
    
    // Optimisation : au lieu d'un MutationObserver global, on injecte un CSS
    // qui déclenche une animation (animationstart) lorsque les éléments apparaissent
    
    if (!this._styleElement) {
      this._styleElement = document.createElement("style");
      document.head.appendChild(this._styleElement);
    }
    
    this._styleElement.textContent = `
      @keyframes wintchessNodeInserted {
        from { outline-color: transparent; }
        to { outline-color: rgba(255,255,255,0.01); }
      }
      ${combinedSelector} {
        animation-duration: 0.001s;
        animation-name: wintchessNodeInserted;
      }
    `;

    const debouncedCallback = Utils.debounce(
      callback,
      CONFIG.DEBOUNCE_DELAY * STATE.performanceFactor || 200
    );

    this._animationListener = (event) => {
      if (event.animationName === "wintchessNodeInserted") {
        debouncedCallback();
      }
    };

    document.addEventListener("animationstart", this._animationListener, true);
    
    // We also keep a lightweight MutationObserver just for class changes on Lichess,
    // since animationstart won't trigger on simple attribute updates on an existing node
    if (platform === "lichess") {
      const observerConfig = {
        childList: false,
        subtree: true,
        attributes: true,
        attributeFilter: ["class"],
      };

      STATE.domObserver = new MutationObserver((mutationsList) => {
        let shouldTrigger = false;
        for (const mutation of mutationsList) {
           if (combinedSelector && mutation.target.matches(combinedSelector)) {
             shouldTrigger = true;
             break;
           }
        }
        if (shouldTrigger) debouncedCallback();
      });
      STATE.domObserver.observe(document.documentElement, observerConfig);
    }
  },

  disconnect() {
    if (this._animationListener) {
      document.removeEventListener("animationstart", this._animationListener, true);
      this._animationListener = null;
    }
    if (this._styleElement) {
      this._styleElement.remove();
      this._styleElement = null;
    }
    if (STATE.domObserver) {
      STATE.domObserver.disconnect();
      STATE.domObserver = null;
    }
  },
};
