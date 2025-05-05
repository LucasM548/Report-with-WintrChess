// ==UserScript==
// @name         Chess Sites to WintrChess PGN Transfer
// @namespace    http://tampermonkey.net/
// @description  Ajoute un bouton sur Lichess et Chess.com (jeu/analyse/étude) pour récupérer le PGN via API (ou scraping) et l'envoyer à WintrChess.
// @author       Lucas_M54
// @include      /^https\:\/\/lichess\.org\/[a-zA-Z0-9]{8,}/
// @include      /^https\:\/\/lichess\.org\/study\/.*/
// @include      /^https\:\/\/lichess\.org\/analysis.*/
// @include      /^https\:\/\/www\.chess\.com\/game\/live\/.*/
// @include      /^https\:\/\/www\.chess\.com\/game\/daily\/.*/
// @include      /^https\:\/\/www\.chess\.com\/game\/computer\/.*/
// @include      /^https\:\/\/www\.chess\.com\/analysis.*/
// @include      /^https\:\/\/www\.chess\.com\/play\/.*/
// @include      /^https\:\/\/www\.chess\.com\/game\/.*/
// @match        https://wintrchess.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @connect      lichess.org
// @connect      chess.com
// @connect      api.chess.com
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // Configuration
    const CONFIG = {
        WINTRCHESS_URL: "https://wintrchess.com/",
        PGN_STORAGE_KEY: "wintrChessPgnToPaste",
        BUTTON_TEXT: "Analyser sur WintrChess",
        MAX_ATTEMPTS: 60,
        RETRY_DELAY: 500,
        LONG_RETRY_DELAY: 5000,
        AUTO_PASTE_DELAY: 100,
        BUTTON_CHECK_INTERVAL: 3000
    };

    // État global
    const STATE = {
        buttonAdded: false,
        observer: null
    };

    // Détermine si nous sommes sur une page Lichess, Chess.com ou WintrChess et agit en conséquence
    function init() {
        if (window.location.hostname === 'lichess.org') {
            initLichess();
        } else if (window.location.hostname === 'www.chess.com') {
            initChessCom();
        } else if (window.location.hostname === 'wintrchess.com') {
            initWintrChess();
        }
    }

    // ===== LICHESS FUNCTIONS =====

    function initLichess() {
        const pageInfo = getLichessPageInfo();

        if (pageInfo.isRelevantPage) {
            setupMutationObserver();
            tryAddButton();

            // Ajouter des points d'entrée supplémentaires pour s'assurer que le bouton est ajouté
            window.addEventListener('load', () => setTimeout(tryAddButton, CONFIG.RETRY_DELAY));
            window.addEventListener('hashchange', () => setTimeout(tryAddButton, CONFIG.RETRY_DELAY));

            // Vérification périodique
            setInterval(() => {
                if (!STATE.buttonAdded || !document.querySelector('.wintchess-button')) {
                    tryAddButton();
                }
            }, CONFIG.BUTTON_CHECK_INTERVAL);
        }
    }

    function getLichessPageInfo() {
        const pathParts = window.location.pathname.split('/').filter(p => p.length > 0);
        let gameId = null;
        let studyId = null;
        let isRelevantPage = false;

        if (pathParts.length > 0) {
            // Page de jeu (format: /abc12345)
            if (/^[a-zA-Z0-9]{8,}$/.test(pathParts[0])) {
                isRelevantPage = true;
                gameId = pathParts[0];
            }
            // Page d'étude (format: /study/abc12345/chapitreXYZ)
            else if (pathParts[0] === 'study' && pathParts.length >= 2) {
                isRelevantPage = true;
                studyId = pathParts[1];
            }
            // Page d'analyse
            else if (pathParts[0] === 'analysis') {
                isRelevantPage = true;
            }
        }

        return { isRelevantPage, gameId, studyId };
    }

    function setupMutationObserver() {
        if (STATE.observer) {
            STATE.observer.disconnect();
        }

        STATE.observer = new MutationObserver((mutationsList) => {
            if (STATE.buttonAdded && document.querySelector('.wintchess-button')) return;

            if (STATE.buttonAdded && !document.querySelector('.wintchess-button')) {
                STATE.buttonAdded = false;
            }

            const hasRelevantChanges = mutationsList.some(m =>
                (m.type === 'childList' && m.addedNodes.length > 0) ||
                (m.type === 'attributes' && (
                    m.target.classList?.contains('analyse__tools') ||
                    m.target.classList?.contains('study__tools') ||
                    m.target.classList?.contains('analyse__underboard') ||
                    m.target.classList?.contains('puzzle__tools')
                ))
            );

            if (hasRelevantChanges) {
                tryAddButton();
            }
        });

        STATE.observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class', 'style', 'id']
        });
    }

    async function getPgnFromLichess() {
        const pageInfo = getLichessPageInfo();

        // Méthode 1: API Lichess (pour les parties uniquement)
        if (pageInfo.gameId) {
            try {
                const pgn = await fetchPgnFromApi(pageInfo.gameId);
                if (pgn) return pgn;
            } catch (error) {
                console.log("Couldn't fetch PGN via API, falling back to scraping methods");
            }
        }

        // Si l'API échoue ou n'est pas disponible, on essaie différentes méthodes de scraping
        return scrapePgnFromPage();
    }

    function fetchPgnFromApi(gameId) {
        const apiUrl = `https://lichess.org/game/export/${gameId}?pgnInJson=false&moves=true&tags=true&clocks=false&evals=false&opening=false`;

        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "GET",
                url: apiUrl,
                timeout: 10000,
                onload: function(response) {
                    if (response.status >= 200 && response.status < 300 && response.responseText) {
                        resolve(response.responseText.trim());
                    } else {
                        reject({
                            status: response.status,
                            statusText: response.statusText,
                            responseText: response.responseText
                        });
                    }
                },
                onerror: function(error) {
                    reject(error);
                },
                ontimeout: function() {
                    reject({ status: 'timeout', statusText: 'Request timed out' });
                }
            });
        });
    }

    function scrapePgnFromPage() {
        const scrapingMethods = [
            // Méthode 1: Données intégrées (analyse)
            () => {
                const element = document.querySelector('.analyse__data, #main-wrap[data-round]');
                if (element?.dataset?.round) {
                    try {
                        const data = JSON.parse(element.dataset.round);
                        if (data?.pgn) return data.pgn.trim();
                    } catch (e) {}
                }
                return null;
            },

            // Méthode 2: Données intégrées (étude)
            () => {
                const element = document.querySelector('#analyse-cm');
                if (element?.dataset?.payload) {
                    try {
                        const data = JSON.parse(element.dataset.payload);
                        if (data?.data?.game?.pgn) return data.data.game.pgn.trim();
                        if (data?.data?.chapter?.pgn) return data.data.chapter.pgn.trim();
                    } catch (e) {}
                }
                return null;
            },

            // Méthode 3: Contenu texte de la div.pgn
            () => {
                const element = document.querySelector('div.pgn');
                if (element?.textContent) {
                    const text = element.textContent.trim();
                    if (text.startsWith('[Event') || /^\s*1\./.test(text)) {
                        return text;
                    }
                }
                return null;
            },

            // Méthode 4: Textarea dans l'onglet PGN
            () => {
                const element = document.querySelector('div.pgn textarea');
                if (element?.value) return element.value.trim();
                return null;
            },

            // Méthode 5: Lien de téléchargement
            () => {
                const element = document.querySelector('.pgn .download, .gamebook .download a');
                if (element?.href?.startsWith('data:')) {
                    try {
                        let pgnData = '';
                        if (element.href.startsWith('data:text/plain;charset=utf-8,')) {
                            pgnData = decodeURIComponent(element.href.substring('data:text/plain;charset=utf-8,'.length));
                        } else if (element.href.startsWith('data:application/x-chess-pgn;charset=utf-8,')) {
                            pgnData = decodeURIComponent(element.href.substring('data:application/x-chess-pgn;charset=utf-8,'.length));
                        }

                        if (pgnData) {
                            // Nettoyer les métadonnées inutiles
                            pgnData = pgnData.replace(/\[Annotator.*?\]\s*?\n?/g, '');
                            pgnData = pgnData.replace(/\[PlyCount.*?\]\s*?\n?/g, '');
                            return pgnData.trim();
                        }
                    } catch (e) {}
                }
                return null;
            },

            // Méthode 6: FEN de l'éditeur de position
            () => {
                // Si nous sommes sur la page d'analyse, nous pouvons essayer de récupérer au moins la position FEN
                if (window.location.pathname.includes('/analysis')) {
                    const fenInput = document.querySelector('input.copyable');
                    if (fenInput?.value && fenInput.value.includes(' ')) {
                        const fen = fenInput.value.trim();
                        // Créer un PGN minimal avec la position FEN
                        return `[Event "Analysis"]\n[Site "https://lichess.org${window.location.pathname}"]\n[Date "${new Date().toISOString().slice(0, 10)}"]\n[White "?"]\n[Black "?"]\n[Result "*"]\n[SetUp "1"]\n[FEN "${fen}"]\n\n*`;
                    }
                }
                return null;
            }
        ];

        // Essayer chaque méthode jusqu'à ce qu'une fonctionne
        for (const method of scrapingMethods) {
            try {
                const pgn = method();
                if (pgn) return pgn;
            } catch (e) {
                // Continuer avec la méthode suivante
            }
        }

        return null;
    }

    function createWintrButton() {
        const wintrButton = document.createElement('button');
        wintrButton.textContent = CONFIG.BUTTON_TEXT;
        wintrButton.className = 'button button-metal wintchess-button';
        wintrButton.style.cssText = `
            display: block;
            width: calc(100% - 10px);
            margin: 8px auto;
            padding: 5px 10px;
            box-sizing: border-box;
            cursor: pointer;
            transition: background-color 0.2s;
        `;

        wintrButton.addEventListener('click', async (event) => {
            event.stopPropagation();
            wintrButton.disabled = true;
            wintrButton.textContent = 'Récupération du PGN...';

            try {
                const pgn = await getPgnFromLichess();
                if (pgn) {
                    await GM_setValue(CONFIG.PGN_STORAGE_KEY, pgn);
                    window.open(CONFIG.WINTRCHESS_URL, '_blank');

                    // Réinitialiser l'apparence du bouton après un court délai
                    setTimeout(() => {
                        wintrButton.disabled = false;
                        wintrButton.textContent = CONFIG.BUTTON_TEXT;
                    }, 1000);
                } else {
                    showNotification("Impossible de récupérer le PGN. Vérifiez la console pour plus de détails.");
                    wintrButton.disabled = false;
                    wintrButton.textContent = CONFIG.BUTTON_TEXT;
                }
            } catch (error) {
                console.error("Erreur lors de la récupération du PGN:", error);
                showNotification("Erreur lors de la récupération du PGN.");
                wintrButton.disabled = false;
                wintrButton.textContent = CONFIG.BUTTON_TEXT;
            }
        });

        return wintrButton;
    }
    
    // Crée un bouton spécifique pour la fenêtre modale de fin de partie
    function createGameOverWintrButton() {
        const wintrButton = document.createElement('button');
        wintrButton.className = 'cc-button-component cc-button-primary cc-button-xx-large cc-bg-primary cc-button-full wintchess-button';
        wintrButton.type = 'button';
        wintrButton.setAttribute('aria-label', CONFIG.BUTTON_TEXT);
        wintrButton.style.cssText = `
            width: 100%;
            margin-top: 10px;
        `;
        
        // Création du contenu du bouton avec l'icône et le texte
        wintrButton.innerHTML = `
            <span class="cc-icon-glyph cc-icon-large cc-button-icon">
                <svg viewBox="0 0 32 32" height="32" width="32" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
                    <path d="M16 26.5c5.8 0 10.5-4.7 10.5-10.5S21.8 5.5 16 5.5 5.5 10.2 5.5 16 10.2 26.5 16 26.5M12 14l3 3h-2v4h6v-4h-2l3-3h-2V9h-4v5z"></path>
                </svg>
            </span>
            <span class="cc-button-one-line">${CONFIG.BUTTON_TEXT}</span>
        `;

        wintrButton.addEventListener('click', async (event) => {
            event.stopPropagation();
            wintrButton.disabled = true;
            const textSpan = wintrButton.querySelector('.cc-button-one-line');
            if (textSpan) textSpan.textContent = 'Récupération du PGN...';
    
            try {
                const pgn = await getPgnFromChessCom();
                if (pgn) {
                    await GM_setValue(CONFIG.PGN_STORAGE_KEY, pgn);
                    window.open(CONFIG.WINTRCHESS_URL, '_blank');
    
                    // Réinitialiser l'apparence du bouton après un court délai
                    setTimeout(() => {
                        wintrButton.disabled = false;
                        const textSpan = wintrButton.querySelector('.cc-button-one-line');
                        if (textSpan) textSpan.textContent = CONFIG.BUTTON_TEXT;
                    }, 1000);
                } else {
                    showNotification("Impossible de récupérer le PGN. Vérifiez la console pour plus de détails.");
                    wintrButton.disabled = false;
                    const textSpan = wintrButton.querySelector('.cc-button-one-line');
                    if (textSpan) textSpan.textContent = CONFIG.BUTTON_TEXT;
                }
            } catch (error) {
                console.error("Erreur lors de la récupération du PGN:", error);
                showNotification("Erreur lors de la récupération du PGN.");
                wintrButton.disabled = false;
                const textSpan = wintrButton.querySelector('.cc-button-one-line');
                if (textSpan) textSpan.textContent = CONFIG.BUTTON_TEXT;
            }
        });
        
        return wintrButton;
    }
    
    // Tente d'ajouter le bouton à la fenêtre modale de fin de partie
    function tryAddButtonToGameOverModal() {
        // Vérifier si la modale de fin de partie est présente
        const gameOverModal = document.querySelector('.game-over-modal-content');
        if (!gameOverModal) return false;
        
        // Si on a déjà ajouté notre bouton dans cette modale, ne rien faire
        if (gameOverModal.querySelector('.wintchess-button')) return true;
        
        // Chercher l'endroit idéal pour insérer notre bouton (juste après le bouton "Bilan de la partie")
        const reviewButtonContainer = gameOverModal.querySelector('.game-over-review-button-component');
        const gameOverButtons = gameOverModal.querySelector('.game-over-modal-buttons');
        
        if (reviewButtonContainer) {
            // Créer une copie du conteneur du bouton bilan pour notre bouton
            const wintrButtonContainer = document.createElement('div');
            wintrButtonContainer.className = 'game-over-review-button-component wintchess-button-container';
            wintrButtonContainer.style.cssText = `
                margin-top: 10px;
            `;
            
            // Ajouter un label comme pour le bouton bilan
            const label = document.createElement('span');
            label.className = 'game-over-review-button-label';
            label.textContent = CONFIG.BUTTON_TEXT;
            wintrButtonContainer.appendChild(label);
            
            // Créer notre bouton avec le style approprié
            const wintrButton = createGameOverWintrButton();
            wintrButton.classList.add('game-over-review-button-background');
            wintrButtonContainer.appendChild(wintrButton);
            
            // Insérer notre conteneur juste après celui du bouton bilan
            if (gameOverButtons) {
                // Insérer juste après le premier bouton et avant les boutons secondaires
                gameOverButtons.insertBefore(wintrButtonContainer, reviewButtonContainer.nextSibling);
            } else {
                // Fallback: insérer après le bouton bilan s'il n'y a pas de conteneur de boutons
                reviewButtonContainer.parentNode.insertBefore(wintrButtonContainer, reviewButtonContainer.nextSibling);
            }
            
            STATE.buttonAdded = true;
            return true;
        }
        
        return false;
    }

    function showNotification(message) {
        const notification = document.createElement('div');
        notification.textContent = message;
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            padding: 10px 20px;
            background-color: #333;
            color: white;
            border-radius: 4px;
            z-index: 10000;
            box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        `;

        document.body.appendChild(notification);

        setTimeout(() => {
            notification.style.opacity = '0';
            notification.style.transition = 'opacity 0.5s ease';
            setTimeout(() => notification.remove(), 500);
        }, 3000);
    }

    function tryAddButton(attempts = 0) {
        // Vérifier si le bouton existe déjà
        if (STATE.buttonAdded && document.querySelector('.wintchess-button')) {
            return;
        }

        if (STATE.buttonAdded && !document.querySelector('.wintchess-button')) {
            STATE.buttonAdded = false;
        }

        // Priorité des sélecteurs pour l'insertion du bouton
        const selectors = [
            { selector: 'div.analyse__computer-analysis.analyse__tool', method: 'afterend' },
            { selector: '.analyse__tools .action-menu', method: 'appendChild' },
            { selector: '.analyse__tools', method: 'appendChild' },
            { selector: '.study__side .study__tools', method: 'appendChild' },
            { selector: '.analyse__controls', method: 'appendChild' },
            { selector: '.analyse__underboard', method: 'appendChild' },
            { selector: '.analyse__underboard .material', method: 'appendChild' },
            { selector: '#main-wrap .puzzle__tools', method: 'appendChild' },
            { selector: '#main-wrap .puzzle__side', method: 'appendChild' },
            { selector: '.analyse__ace', method: 'appendChild' }
        ];

        let inserted = false;

        for (const { selector, method } of selectors) {
            const container = document.querySelector(selector);
            if (container) {
                try {
                    const wintrButton = createWintrButton();

                    if (method === 'afterend') {
                        container.insertAdjacentElement('afterend', wintrButton);
                    } else {
                        // Ajuster le style pour les insertions dans les conteneurs existants
                        wintrButton.style.width = 'auto';
                        wintrButton.style.display = 'inline-block';
                        wintrButton.style.margin = '5px';
                        container.appendChild(wintrButton);
                    }

                    STATE.buttonAdded = true;
                    inserted = true;
                    break;
                } catch (e) {
                    console.error("Erreur lors de l'insertion du bouton:", e);
                }
            }
        }

        // Si nous n'avons pas réussi à insérer le bouton, réessayer
        if (!inserted) {
            if (attempts < CONFIG.MAX_ATTEMPTS - 1) {
                setTimeout(() => tryAddButton(attempts + 1), CONFIG.RETRY_DELAY);
            } else {
                // Faire une pause plus longue avant de réessayer si on atteint le max d'essais
                setTimeout(() => tryAddButton(0), CONFIG.LONG_RETRY_DELAY);
            }
        }
    }

    // ===== CHESS.COM FUNCTIONS =====

    function initChessCom() {
        const pageInfo = getChessComPageInfo();

        if (pageInfo.isRelevantPage) {
            setupChessComMutationObserver();
            tryAddChessComButton();

            // Ajouter des points d'entrée supplémentaires pour s'assurer que le bouton est ajouté
            window.addEventListener('load', () => setTimeout(tryAddChessComButton, CONFIG.RETRY_DELAY));
            window.addEventListener('hashchange', () => setTimeout(tryAddChessComButton, CONFIG.RETRY_DELAY));

            // Vérification périodique
            setInterval(() => {
                if (!STATE.buttonAdded || !document.querySelector('.wintchess-button')) {
                    tryAddChessComButton();
                }
            }, CONFIG.BUTTON_CHECK_INTERVAL);
        }
    }

    function getChessComPageInfo() {
        const path = window.location.pathname;
        let gameId = null;
        let isRelevantPage = false;

        // Partie live (format: /game/live/123456789)
        if (/^\/game\/live\/\d+/.test(path)) {
            isRelevantPage = true;
            gameId = path.split('/').pop();
        }
        // Partie daily/correspondance (format: /game/daily/123456789)
        else if (/^\/game\/daily\/\d+/.test(path)) {
            isRelevantPage = true;
            gameId = path.split('/').pop();
        }
        // Partie contre l'ordinateur (format: /game/computer/123456789)
        else if (/^\/game\/computer\/\d+/.test(path)) {
            isRelevantPage = true;
            gameId = path.split('/').pop();
        }
        // Page d'analyse
        else if (/^\/analysis/.test(path)) {
            isRelevantPage = true;
        }
        // Page de jeu en cours
        else if (/^\/play\//.test(path)) {
            isRelevantPage = true;
        }
        // Toute autre page de jeu
        else if (/^\/game\//.test(path)) {
            isRelevantPage = true;
        }

        return { isRelevantPage, gameId };
    }

    function setupChessComMutationObserver() {
        if (STATE.observer) {
            STATE.observer.disconnect();
        }

        STATE.observer = new MutationObserver((mutationsList) => {
            if (STATE.buttonAdded && document.querySelector('.wintchess-button')) return;

            if (STATE.buttonAdded && !document.querySelector('.wintchess-button')) {
                STATE.buttonAdded = false;
            }

            const hasRelevantChanges = mutationsList.some(m => {
                // Vérifier si une modale de fin de partie est ajoutée
                if (m.type === 'childList' && m.addedNodes.length > 0) {
                    for (const node of m.addedNodes) {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            if (node.querySelector && (
                                node.querySelector('.game-over-modal-content') ||
                                node.classList?.contains('game-over-modal-content') ||
                                node.querySelector('.game-over-modal-buttons') ||
                                node.querySelector('.game-over-review-button-component')
                            )) {
                                // Essayer d'ajouter le bouton avec une légère temporisation pour s'assurer que la modale est complètement chargée
                                setTimeout(() => tryAddButtonToGameOverModal(), 300);
                                return true;
                            }
                        }
                    }
                }
                return (m.type === 'childList' && m.addedNodes.length > 0) || (m.type === 'attributes');
            });

            if (hasRelevantChanges) {
                tryAddChessComButton();
            }
        });

        STATE.observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class', 'style', 'id']
        });
    }

    async function getPgnFromChessCom() {
        try {
            // Utiliser uniquement la méthode du panneau de partage qui fonctionne
            const pgnFromShare = await getPgnFromSharePanel();
            if (pgnFromShare) {
                console.log('PGN récupéré depuis le panneau de partage');
                return pgnFromShare;
            }
            
            console.error("Échec de l'extraction du PGN via le panneau de partage");
            return null;
        } catch (error) {
            console.error("Erreur lors de l'extraction du PGN", error);
            throw error;
        }
    }

    // Ouvre le panneau de partage et extrait le PGN
    async function getPgnFromSharePanel() {
        return new Promise((resolve) => {
            try {
                console.log('Tentative directe d\'extraction du PGN via le panneau de partage');
                
                // 1. Ouvrir le panneau de partage
                const shareButtons = document.querySelectorAll('button[aria-label="Share"], .icon-font-chess.share, [data-cy="share-button"]');
                let shareClicked = false;
                
                for (const btn of shareButtons) {
                    try {
                        btn.click();
                        shareClicked = true;
                        console.log('Panneau de partage ouvert');
                        break;
                    } catch (e) { /* Continuer avec le prochain bouton */ }
                }
                
                if (!shareClicked) {
                    console.error('Impossible d\'ouvrir le panneau de partage');
                    return resolve(null);
                }
                
                // 2. Attendre que le panneau apparaisse puis cliquer sur l'onglet PGN
                setTimeout(() => {
                    // Cibler précisément le bouton fourni par l'utilisateur
                    const pgnButton = document.querySelector('button.cc-tab-item-component#tab-pgn[aria-controls="tabpanel-pgn"]');
                    
                    if (pgnButton) {
                        console.log('Bouton PGN trouvé, clic...');
                        pgnButton.click();
                        
                        // 3. Attendre que le contenu PGN apparaisse et l'extraire
                        setTimeout(() => {
                            const textarea = document.querySelector('textarea.cc-textarea-component.cc-textarea-x-large.share-menu-tab-pgn-textarea[aria-label="PGN"]');
                            
                            if (textarea && textarea.value) {
                                console.log('PGN trouvé!');
                                const pgn = textarea.value;
                                
                                // 4. Fermer le panneau de partage
                                const closeButton = document.querySelector('.share-menu-close, button[aria-label="Close"]');
                                if (closeButton) closeButton.click();
                                
                                return resolve(pgn);
                            } else {
                                console.error('Textarea PGN non trouvé ou vide');
                                return resolve(null);
                            }
                        }, 1000); // Délai généreux pour s'assurer que le PGN est chargé
                    } else {
                        console.error('Bouton PGN non trouvé');
                        return resolve(null);
                    }
                }, 500);
                
            } catch (error) {
                console.error('Erreur lors de l\'extraction du PGN:', error);
                return resolve(null);
            }
        });
    }
    
    // Fonction utilitaire pour injecter et exécuter du code JavaScript dans la page
    function injectAndExecuteCode(code) {
        try {
            // Créer un élément script
            const script = document.createElement('script');
            // Ajouter le code à exécuter
            script.textContent = `
                try {
                    (function() {
                        const result = (function() {
                            ${code}
                        })();
                        document.body.setAttribute('data-script-result', JSON.stringify(result));
                    })();
                } catch (e) {
                    console.error('Erreur dans le script injecté:', e);
                    document.body.setAttribute('data-script-error', e.message);
                    document.body.setAttribute('data-script-result', 'false');
                }
            `;
            
            // Ajouter le script à la page
            document.body.appendChild(script);
            
            // Récupérer le résultat
            const resultStr = document.body.getAttribute('data-script-result');
            
            // Nettoyer
            document.body.removeAttribute('data-script-result');
            document.body.removeAttribute('data-script-error');
            script.remove();
            
            // Retourner le résultat
            try {
                return JSON.parse(resultStr);
            } catch (e) {
                return resultStr;
            }
        } catch (e) {
            console.error('Erreur lors de l\'injection du script:', e);
            return false;
        }
    }
    
    // Extrait le PGN directement depuis la page web en accédant aux variables JavaScript de Chess.com
    async function extractPgnFromPage() {
        return new Promise((resolve) => {
            try {
                // Chess.com stocke les données PGN dans plusieurs endroits possibles
                // Essayer toutes les sources possibles
                
                // Méthode 1: chesscom.gameData
                if (window.chesscom && window.chesscom.gameData) {
                    // Directement dans gameData
                    if (window.chesscom.gameData.pgn) {
                        return resolve(window.chesscom.gameData.pgn);
                    }
                    // Dans l'objet game
                    if (window.chesscom.gameData.game && window.chesscom.gameData.game.pgn) {
                        return resolve(window.chesscom.gameData.game.pgn);
                    }
                }

                // Méthode 2: Utiliser l'API du client
                if (window.ChessTools && window.ChessTools.board && window.ChessTools.board.pgn) {
                    return resolve(window.ChessTools.board.pgn);
                }
                
                // Méthode 3: Extraire via l'objet chessboard
                if (window.chessboard) {
                    try {
                        if (typeof window.chessboard.getPgn === 'function') {
                            const pgn = window.chessboard.getPgn();
                            if (isPgnValid(pgn)) {
                                return resolve(pgn);
                            }
                        }
                    } catch (e) {
                        console.warn('Erreur avec chessboard.getPgn:', e);
                    }
                }
                
                // Méthode 4: Extraire depuis l'objet global chess
                if (window.chess && window.chess.getPgn) {
                    try {
                        const pgn = window.chess.getPgn();
                        if (isPgnValid(pgn)) {
                            return resolve(pgn);
                        }
                    } catch (e) {
                        console.warn('Erreur avec chess.getPgn:', e);
                    }
                }
                
                // Méthode 5: Extraire depuis la console
                try {
                    // Insérer un script dans la page pour accéder aux données
                    const script = document.createElement('script');
                    script.textContent = `
                        window.chessPGN = null;
                        try {
                            // Essayer d'extraire le PGN d'une partie terminée
                            if (window.chessController && window.chessController.getGame) {
                                const game = window.chessController.getGame();
                                if (game && game.pgn) {
                                    window.chessPGN = game.pgn;
                                }
                            }
                            // Essayer via l'objet chess25
                            else if (window.chess25 && window.chess25.pgn) {
                                window.chessPGN = window.chess25.pgn;
                            }
                            // Essayer via l'objet d'analyse
                            else if (window.analysis && window.analysis.getPgn) {
                                window.chessPGN = window.analysis.getPgn();
                            }
                        } catch (e) {
                            console.warn('Script injection error:', e);
                        }
                    `;
                    document.head.appendChild(script);
                    document.head.removeChild(script);
                    
                    // Vérifier si nous avons récupéré le PGN
                    setTimeout(() => {
                        if (window.chessPGN && isPgnValid(window.chessPGN)) {
                            const pgn = window.chessPGN;
                            delete window.chessPGN;
                            return resolve(pgn);
                        }
                        resolve(null);
                    }, 100);
                    return; // Retourne ici pour laisser le timeout se terminer
                } catch (e) {
                    console.warn('Script injection error:', e);
                }
                
                // Si toutes les méthodes échouent
                resolve(null);
            } catch (e) {
                console.warn('Error in extractPgnFromPage:', e);
                resolve(null);
            }
        });
    }
    
    // Méthode de secours pour extraire un PGN minimal
    async function fallbackPgnExtraction() {
        try {
            // Extraire les coups depuis les éléments de la notation
            const moveElements = document.querySelectorAll('.move, .vertical-move-list .node, .move-text-component');
            let movesText = '';
            let foundMoves = false;
            
            if (moveElements.length > 0) {
                moveElements.forEach(el => {
                    const text = el.textContent.trim();
                    // Détecter les numéros de coups ou les notations d'échecs (e4, Nf3, etc.)
                    if (text.match(/^\d+\./) || text.match(/[a-h][1-8]/) || 
                        text.match(/[NBRQK][a-h]?[1-8]?x?[a-h][1-8]/)) {
                        movesText += text + ' ';
                        foundMoves = true;
                    }
                });
            }
            
            // Extraire les infos des joueurs
            const players = getPlayersFromPage();
            
            // Générer un PGN minimal
            let pgn = `[Event "Chess.com Game"]
[Site "${window.location.href}"]
[Date "${new Date().toISOString().slice(0, 10)}"]
[White "${players.white || '?'}"]
[Black "${players.black || '?'}"]
[Result "*"]
`;
            
            // Si on a trouvé des coups, les ajouter
            if (foundMoves) {
                pgn += `\n${movesText} *`;
            } 
            // Sinon, essayer de trouver la position FEN
            else {
                const fenElements = document.querySelectorAll('[data-fen], [data-position], input[type="text"][value*=" "], .fen-link');
                for (const el of fenElements) {
                    const fen = el.dataset?.fen || el.dataset?.position || el.value || el.textContent;
                    if (fen && fen.includes(' ') && fen.split(' ').length >= 4) {
                        pgn += `[SetUp "1"]
[FEN "${fen.trim()}"]
\n*`;
                        break;
                    }
                }
            }
            
            return pgn;
        } catch (e) {
            console.error('Fallback extraction failed:', e);
            // Dernière solution: juste donner un PGN vide avec les métadonnées de base
            return `[Event "Chess.com Game"]
[Site "${window.location.href}"]
[Date "${new Date().toISOString().slice(0, 10)}"]
[White "?"]
[Black "?"]
[Result "*"]

*`;
        }
    }

    function fetchPgnFromChessComApi(gameId) {
        // Les URLs de Chess.com pour récupérer le PGN
        return new Promise(async (resolve, reject) => {
            try {
                // Déterminer le type de partie (live, daily, ou computer)
                const pathMatch = window.location.pathname.match(/\/game\/(live|daily|computer)\//);
                const gameType = pathMatch ? pathMatch[1] : 'live';
                
                // Méthode 1: Accès direct aux données des callbacks - ces endpoints retournent le JSON avec le PGN
                const callbackUrls = [
                    `https://www.chess.com/callback/${gameType}/game/${gameId}`,
                    `https://www.chess.com/callback/game/${gameId}`,
                    `https://www.chess.com/callback/live/game/archive-callback/${gameId}`,
                ];
                
                for (const url of callbackUrls) {
                    try {
                        console.log(`Essai de récupération du PGN via ${url}`);
                        const response = await fetchWithHeaders(url);
                        if (response && response.length > 100) { // Éviter les réponses vides ou erreurs
                            try {
                                const jsonData = JSON.parse(response);
                                if (jsonData && jsonData.game && jsonData.game.pgn) {
                                    console.log('PGN récupéré avec succès depuis le callback');
                                    return resolve(jsonData.game.pgn);
                                }
                            } catch (e) {
                                // Si ce n'est pas du JSON valide, continuer
                            }
                        }
                    } catch (e) {
                        console.log(`Erreur avec ${url}:`, e);
                        // Continuer avec la prochaine URL
                    }
                }
                
                // Méthode 2: Utiliser l'API d'export qui permet d'obtenir directement le PGN
                // Cette méthode est plus fiable mais peut nécessiter d'être connecté
                const exportUrls = [
                    `https://www.chess.com/games/exportPgn/${gameId}`,
                    `https://www.chess.com/live/game/${gameId}/download`,
                    `https://www.chess.com/game/${gameType}/${gameId}/download`,
                    `https://www.chess.com/game/download/${gameId}`
                ];
                
                for (const url of exportUrls) {
                    try {
                        console.log(`Essai de récupération du PGN via export ${url}`);
                        const pgnContent = await fetchWithHeaders(url, {
                            'Accept': 'application/x-chess-pgn',
                            'Content-Type': 'application/x-chess-pgn'
                        });
                        
                        if (pgnContent && typeof pgnContent === 'string' && isPgnValid(pgnContent)) {
                            console.log('PGN récupéré avec succès depuis l’export');
                            return resolve(pgnContent.trim());
                        }
                    } catch (e) {
                        console.log(`Erreur avec ${url}:`, e);
                        // Continuer avec la prochaine URL
                    }
                }
                
                // Méthode 3: Essayer d'extraire le PGN depuis la page Web
                try {
                    // Charger la page de la partie pour en extraire le PGN
                    console.log(`Chargement de la page de la partie pour extraction`);
                    const gamePageUrl = `https://www.chess.com/game/${gameType}/${gameId}`;
                    const gamePage = await fetchWithHeaders(gamePageUrl);
                    
                    // Chercher le PGN dans la page
                    if (gamePage && gamePage.includes('[Event')) {
                        const pgnMatches = gamePage.match(/\[Event[^\[]*(?:\[[^\[\]]*\][^\[]*)*1\./s);
                        if (pgnMatches && pgnMatches[0]) {
                            const pgn = pgnMatches[0].trim();
                            if (isPgnValid(pgn)) {
                                console.log('PGN extrait avec succès depuis la page');
                                return resolve(pgn);
                            }
                        }
                    }
                    
                    // Chercher l'URL du bouton de téléchargement dans la page
                    const downloadUrlMatch = gamePage.match(/href="([^"]+\/download[^"]+)"/i);
                    if (downloadUrlMatch && downloadUrlMatch[1]) {
                        const downloadUrl = downloadUrlMatch[1].replace(/&amp;/g, '&');
                        if (downloadUrl.startsWith('/')) {
                            const fullUrl = `https://www.chess.com${downloadUrl}`;
                            console.log(`Tentative de téléchargement via URL extraite: ${fullUrl}`);
                            const pgnContent = await fetchWithHeaders(fullUrl, {
                                'Accept': 'application/x-chess-pgn'
                            });
                            if (pgnContent && isPgnValid(pgnContent)) {
                                console.log('PGN récupéré avec succès depuis l’URL extraite');
                                return resolve(pgnContent.trim());
                            }
                        }
                    }
                } catch (pageError) {
                    console.log('Erreur lors de l’extraction depuis la page:', pageError);
                }
                
                // Si aucune méthode n'a fonctionné, rejeter la promesse
                throw new Error("Impossible de récupérer le PGN via l'API Chess.com");
            } catch (error) {
                reject(error);
            }
        });
    }
    
    // Fonction utilitaire pour faire des requêtes avec des en-têtes spécifiques
    function fetchWithHeaders(url, headers = {}) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "GET",
                url: url,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                    ...headers
                },
                timeout: 10000,
                responseType: 'text',
                onload: function(response) {
                    if (response.status >= 200 && response.status < 300 && response.responseText) {
                        resolve(response.responseText);
                    } else {
                        reject({
                            status: response.status,
                            statusText: response.statusText,
                            responseText: response.responseText
                        });
                    }
                },
                onerror: function(error) {
                    reject(error);
                },
                ontimeout: function() {
                    reject({ status: 'timeout', statusText: 'Request timed out' });
                }
            });
        });
    }

    function scrapePgnFromChessComPage() {
        return new Promise(async (resolve, reject) => {
            try {
                // Récupérer l'ID du jeu à partir de l'URL
                const pathname = window.location.pathname;
                let gameId = null;
                const gameMatch = pathname.match(/\/game\/(?:live|daily|computer)\/([0-9]+)/);
                if (gameMatch && gameMatch[1]) {
                    gameId = gameMatch[1];
                }

                // Si nous avons un ID de jeu, essayer de récupérer le PGN via l'API
                if (gameId) {
                    try {
                        // Essayer via des endpoints directs de la page
                        const directUrls = [
                            `https://www.chess.com/callback/live/game/${gameId}`,
                            `https://www.chess.com/callback/daily/game/${gameId}`,
                            `https://www.chess.com/callback/computer/game/${gameId}`
                        ];

                        for (const url of directUrls) {
                            try {
                                const response = await fetchWithHeaders(url);
                                if (response) {
                                    try {
                                        const jsonData = JSON.parse(response);
                                        if (jsonData && jsonData.game && jsonData.game.pgn) {
                                            return resolve(jsonData.game.pgn);
                                        }
                                    } catch (e) {
                                        // Si ce n'est pas du JSON, continuer
                                    }
                                }
                            } catch (e) {
                                // Ignorer les erreurs pour cette URL et essayer la suivante
                            }
                        }
                    } catch (apiError) {
                        console.warn("Erreur lors de la récupération via le point d'accès direct:", apiError);
                    }
                }

                // Méthode 1: Extraire le PGN des données window.chesscom
                if (window.chesscom && window.chesscom.gameData) {
                    // Chercher le PGN dans les données de jeu
                    const gameData = window.chesscom.gameData;
                    if (gameData.pgn) {
                        return resolve(gameData.pgn);
                    }
                    // Chercher dans les détails du jeu
                    if (gameData.game && gameData.game.pgn) {
                        return resolve(gameData.game.pgn);
                    }
                }

                // Méthode 2: Bouton de téléchargement PGN existant
                const downloadButtons = document.querySelectorAll(
                    'a[aria-label="Download Game"], a[data-cy="download-pgn-button"], ' +
                    'a.icon-font-chess.download, a[href*="/games/download/"], ' +
                    'a.share-menu-item[href*="download"], button[data-cy="download-pgn-button"]'
                );

                for (const button of downloadButtons) {
                    try {
                        // Si c'est un lien avec un href
                        if (button.href && button.href.includes('/games/download')) {
                            const pgn = await fetchWithHeaders(button.href, {
                                'Accept': 'application/x-chess-pgn'
                            });
                            if (pgn && isPgnValid(pgn)) {
                                return resolve(pgn);
                            }
                        } 
                        // Si c'est un bouton, essayer de l'utiliser pour extraire l'URL
                        else if (button.dataset && button.dataset.url) {
                            const pgn = await fetchWithHeaders(button.dataset.url, {
                                'Accept': 'application/x-chess-pgn'
                            });
                            if (pgn && isPgnValid(pgn)) {
                                return resolve(pgn);
                            }
                        }
                    } catch (e) {
                        console.warn("Erreur avec le bouton de téléchargement:", e);
                    }
                }

                // Méthode 3: Données JSON intégrées dans les scripts
                const scripts = Array.from(document.querySelectorAll('script:not([src])'));
                for (const script of scripts) {
                    try {
                        const content = script.textContent;
                        if (content.includes('"pgn"')) {
                            // Essayer des stratégies d'extraction différentes
                            let pgn = null;
                            
                            // Stratégie 1: Recherche de la propriété pgn dans un objet JSON
                            const matches = content.match(/['"]pgn['"]:['"]((?:\\.|[^'"\\])*)['"]/);
                            if (matches && matches[1]) {
                                pgn = matches[1].replace(/\\n/g, '\n')
                                              .replace(/\\"/g, '"')
                                              .replace(/\\\\/g, '\\')
                                              .trim();
                                if (isPgnValid(pgn)) {
                                    return resolve(pgn);
                                }
                            }
                            
                            // Stratégie 2: Chercher un objet PGNJSON complet
                            try {
                                // Extraire tout ce qui ressemble à un objet JSON contenant pgn
                                const jsonMatch = content.match(/\{[^\{\}]*"pgn"\s*:[^\{\}]*\}/);
                                if (jsonMatch) {
                                    const jsonStr = jsonMatch[0];
                                    // Tenter de transformer en JSON valide
                                    const validJson = jsonStr.replace(/'/g, '"')
                                                             .replace(/([{,]\s*)([a-zA-Z][a-zA-Z0-9]*)\s*:/g, '$1"$2":')
                                                             .replace(/:\s*'([^']*)'/g, ':"$1"');
                                    try {
                                        const parsed = JSON.parse(validJson);
                                        if (parsed.pgn && isPgnValid(parsed.pgn)) {
                                            return resolve(parsed.pgn);
                                        }
                                    } catch (jsonError) {
                                        // JSON invalide, continuer
                                    }
                                }
                            } catch (strategyError) {
                                // Erreur dans la stratégie, continuer
                            }
                        }
                    } catch (e) {
                        // Continuer avec le script suivant
                    }
                }

                // Méthode 4: Éléments du DOM contenant le PGN
                const pgnElements = document.querySelectorAll(
                    'div.pgn-source, div.pgn-body, div.copy-pgn-component, ' +
                    'textarea.pgn-text, pre.pgn, .pgn-panel textarea, ' +
                    'div[data-cy="pgn-text"], div[data-test="pgn"]'
                );

                for (const element of pgnElements) {
                    if (element.value || element.textContent) {
                        const content = (element.value || element.textContent).trim();
                        if (isPgnValid(content)) {
                            return resolve(content);
                        }
                    }
                }

                // Méthode 5: Construire un PGN minimal à partir de la position FEN (pour la page d'analyse)
                if (window.location.pathname.includes('/analysis')) {
                    // Chercher le FEN dans divers endroits de la page
                    const fenElements = [
                        ...document.querySelectorAll('input[type="text"][value*=" "]'),
                        ...document.querySelectorAll('div.fen-link, .board-fen-wrapper, [data-cy="analysis-position-fen"]')
                    ];

                    for (const element of fenElements) {
                        const value = element.value || element.textContent || element.dataset?.value;
                        if (value && value.includes(' ') && value.split(' ').length >= 4) {
                            const fen = value.trim();
                            // Créer un PGN minimal avec la position FEN
                            const pgnFromFen = `[Event "Analysis"]
[Site "https://www.chess.com${window.location.pathname}"]
[Date "${new Date().toISOString().slice(0, 10)}"]
[White "?"]
[Black "?"]
[Result "*"]
[SetUp "1"]
[FEN "${fen}"]

*`;
                            return resolve(pgnFromFen);
                        }
                    }

                    // Si aucune méthode n'a fonctionné, essayer de récupérer au moins les coups de la partie
                    const chesscomAnalysis = window.chesscom?.analysis;
                    if (chesscomAnalysis) {
                        try {
                            if (chesscomAnalysis.getPgn) {
                                const pgn = chesscomAnalysis.getPgn();
                                if (isPgnValid(pgn)) {
                                    return resolve(pgn);
                                }
                            } else if (chesscomAnalysis.board && chesscomAnalysis.board.getFen) {
                                const fen = chesscomAnalysis.board.getFen();
                                if (fen) {
                                    const pgnFromFen = `[Event "Analysis"]
[Site "https://www.chess.com${window.location.pathname}"]
[Date "${new Date().toISOString().slice(0, 10)}"]
[White "?"]
[Black "?"]
[Result "*"]
[SetUp "1"]
[FEN "${fen}"]

*`;
                                    return resolve(pgnFromFen);
                                }
                            }
                        } catch (apiError) {
                            console.warn("Erreur avec l'API chesscom.analysis:", apiError);
                        }
                    }
                }

                // Si toutes les méthodes ont échoué, essayer d'extraire les coups à partir de la notation
                try {
                    const moveElements = document.querySelectorAll('.vertical-move-list .node, .move, .move-text-component');
                    if (moveElements.length > 0) {
                        let movesText = '';
                        moveElements.forEach(el => {
                            const text = el.textContent.trim();
                            if (text.match(/^\d+\./) || text.match(/[a-h][1-8]/) || text.match(/[NBRQK][a-h]?[1-8]?x?[a-h][1-8]/)) {
                                movesText += text + ' ';
                            }
                        });
                        
                        if (movesText) {
                            // Créer un PGN minimal avec les coups extraits
                            const minimalPgn = `[Event "Chess.com Game"]
[Site "https://www.chess.com${window.location.pathname}"]
[Date "${new Date().toISOString().slice(0, 10)}"]
[White "?"]
[Black "?"]
[Result "*"]

${movesText} *`;
                            
                            return resolve(minimalPgn);
                        }
                    }
                } catch (extractError) {
                    console.warn("Erreur lors de l'extraction des coups:", extractError);
                }

                // Si tout échoue, essayer de construire un PGN avec les infos disponibles
                const players = getPlayersFromPage();
                if (players.white || players.black) {
                    // Créer un PGN minimal avec les infos des joueurs
                    const fallbackPgn = `[Event "Chess.com Game"]
[Site "https://www.chess.com${window.location.pathname}"]
[Date "${new Date().toISOString().slice(0, 10)}"]
[White "${players.white || '?'}"]
[Black "${players.black || '?'}"]
[Result "*"]

*`;
                    
                    return resolve(fallbackPgn);
                }

                // Si vraiment tout a échoué
                throw new Error("Impossible de récupérer le PGN depuis la page Chess.com");
            } catch (error) {
                reject(error);
            }
        });
    }
    
    // Vérifie si une chaîne est un PGN valide
    function isPgnValid(text) {
        if (!text || typeof text !== 'string') return false;
        // Un PGN valide doit contenir au moins une balise d'événement et une balise de joueur
        return (text.includes('[Event') || text.includes('[Date')) && 
               (text.includes('[White') || text.includes('[Black')) &&
               (text.includes('1.') || text.includes('[FEN'));
    }
    
    // Essaie d'extraire les noms des joueurs depuis la page
    function getPlayersFromPage() {
        const players = { white: null, black: null };
        
        // Méthode 1: Chercher dans les éléments du profil du joueur
        const whitePlayer = document.querySelector('.white.user-username a, .white-player-name, [data-cy="header-white-player-name"]');
        const blackPlayer = document.querySelector('.black.user-username a, .black-player-name, [data-cy="header-black-player-name"]');
        
        if (whitePlayer) players.white = whitePlayer.textContent.trim();
        if (blackPlayer) players.black = blackPlayer.textContent.trim();
        
        // Méthode 2: Chercher dans les données de la page
        if (window.chesscom && window.chesscom.gameData) {
            const gameData = window.chesscom.gameData;
            if (gameData.players) {
                if (gameData.players.white && gameData.players.white.username) {
                    players.white = gameData.players.white.username;
                }
                if (gameData.players.black && gameData.players.black.username) {
                    players.black = gameData.players.black.username;
                }
            }
        }
        
        return players;
    }

    function fetchPgnFromUrl(url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "GET",
                url: url,
                timeout: 10000,
                onload: function(response) {
                    if (response.status >= 200 && response.status < 300 && response.responseText) {
                        resolve(response.responseText.trim());
                    } else {
                        reject({
                            status: response.status,
                            statusText: response.statusText,
                            responseText: response.responseText
                        });
                    }
                },
                onerror: function(error) {
                    reject(error);
                },
                ontimeout: function() {
                    reject({ status: 'timeout', statusText: 'Request timed out' });
                }
            });
        });
    }

    // Crée un bouton standard pour la page de jeu
    function createChessComWintrButton() {
        const wintrButton = document.createElement('button');
        wintrButton.className = 'cc-button-component cc-button-primary cc-button-xx-large cc-bg-primary cc-button-full wintchess-button';
        wintrButton.type = 'button';
        wintrButton.style.cssText = `
            margin-top: 8px;
            width: 100%;
            margin-bottom: 6px;
        `;
        
        // Création du contenu du bouton avec l'icône et le texte comme sur le bouton "Bilan de la partie"
        wintrButton.innerHTML = `
            <span class="cc-icon-glyph cc-icon-large cc-button-icon">
                <svg viewBox="0 0 32 32" height="32" width="32" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
                    <path d="M16 26.5c5.8 0 10.5-4.7 10.5-10.5S21.8 5.5 16 5.5 5.5 10.2 5.5 16 10.2 26.5 16 26.5M12 14l3 3h-2v4h6v-4h-2l3-3h-2V9h-4v5z"></path>
                </svg>
            </span>
            <span class="cc-button-one-line">${CONFIG.BUTTON_TEXT}</span>
        `;
    
        wintrButton.addEventListener('click', async (event) => {
            event.stopPropagation();
            wintrButton.disabled = true;
            const textSpan = wintrButton.querySelector('.cc-button-one-line');
            if (textSpan) textSpan.textContent = 'Récupération du PGN...';
    
            try {
                const pgn = await getPgnFromChessCom();
                if (pgn) {
                    await GM_setValue(CONFIG.PGN_STORAGE_KEY, pgn);
                    window.open(CONFIG.WINTRCHESS_URL, '_blank');
    
                    // Réinitialiser l'apparence du bouton après un court délai
                    setTimeout(() => {
                        wintrButton.disabled = false;
                        const textSpan = wintrButton.querySelector('.cc-button-one-line');
                        if (textSpan) textSpan.textContent = CONFIG.BUTTON_TEXT;
                    }, 1000);
                } else {
                    showNotification("Impossible de récupérer le PGN. Vérifiez la console pour plus de détails.");
                    wintrButton.disabled = false;
                    const textSpan = wintrButton.querySelector('.cc-button-one-line');
                    if (textSpan) textSpan.textContent = CONFIG.BUTTON_TEXT;
                }
            } catch (error) {
                console.error("Erreur lors de la récupération du PGN:", error);
                showNotification("Erreur lors de la récupération du PGN.");
                wintrButton.disabled = false;
                const textSpan = wintrButton.querySelector('.cc-button-one-line');
                if (textSpan) textSpan.textContent = CONFIG.BUTTON_TEXT;
            }
        });
    
        return wintrButton;
    }
    
    // Crée un bouton spécifique pour la fenêtre modale de fin de partie
    function createGameOverWintrButton() {
        const wintrButton = document.createElement('button');
        wintrButton.className = 'cc-button-component cc-button-primary cc-button-xx-large cc-bg-primary cc-button-full wintchess-button';
        wintrButton.type = 'button';
        wintrButton.setAttribute('aria-label', CONFIG.BUTTON_TEXT);
        wintrButton.style.cssText = `
            width: 100%;
            margin-top: 10px;
        `;
        
        // Création du contenu du bouton avec l'icône et le texte
        wintrButton.innerHTML = `
            <span class="cc-icon-glyph cc-icon-large cc-button-icon">
                <svg viewBox="0 0 32 32" height="32" width="32" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
                    <path d="M16 26.5c5.8 0 10.5-4.7 10.5-10.5S21.8 5.5 16 5.5 5.5 10.2 5.5 16 10.2 26.5 16 26.5M12 14l3 3h-2v4h6v-4h-2l3-3h-2V9h-4v5z"></path>
                </svg>
            </span>
            <span class="cc-button-one-line">${CONFIG.BUTTON_TEXT}</span>
        `;

        wintrButton.addEventListener('click', async (event) => {
            event.stopPropagation();
            wintrButton.disabled = true;
            const textSpan = wintrButton.querySelector('.cc-button-one-line');
            if (textSpan) textSpan.textContent = 'Récupération du PGN...';
    
            try {
                const pgn = await getPgnFromChessCom();
                if (pgn) {
                    await GM_setValue(CONFIG.PGN_STORAGE_KEY, pgn);
                    window.open(CONFIG.WINTRCHESS_URL, '_blank');
    
                    // Réinitialiser l'apparence du bouton après un court délai
                    setTimeout(() => {
                        wintrButton.disabled = false;
                        const textSpan = wintrButton.querySelector('.cc-button-one-line');
                        if (textSpan) textSpan.textContent = CONFIG.BUTTON_TEXT;
                    }, 1000);
                } else {
                    showNotification("Impossible de récupérer le PGN. Vérifiez la console pour plus de détails.");
                    wintrButton.disabled = false;
                    const textSpan = wintrButton.querySelector('.cc-button-one-line');
                    if (textSpan) textSpan.textContent = CONFIG.BUTTON_TEXT;
                }
            } catch (error) {
                console.error("Erreur lors de la récupération du PGN:", error);
                showNotification("Erreur lors de la récupération du PGN.");
                wintrButton.disabled = false;
                const textSpan = wintrButton.querySelector('.cc-button-one-line');
                if (textSpan) textSpan.textContent = CONFIG.BUTTON_TEXT;
            }
        });
        
        return wintrButton;
    }
    
    // Tente d'ajouter le bouton à la fenêtre modale de fin de partie
    function tryAddButtonToGameOverModal() {
        // Vérifier si la modale de fin de partie est présente
        const gameOverModal = document.querySelector('.game-over-modal-content');
        if (!gameOverModal) return false;
        
        // Si on a déjà ajouté notre bouton dans cette modale, ne rien faire
        if (gameOverModal.querySelector('.wintchess-button')) return true;
        
        // Chercher l'endroit idéal pour insérer notre bouton (juste après le bouton "Bilan de la partie")
        const reviewButtonContainer = gameOverModal.querySelector('.game-over-review-button-component');
        const gameOverButtons = gameOverModal.querySelector('.game-over-modal-buttons');
        
        if (reviewButtonContainer) {
            // Créer une copie du conteneur du bouton bilan pour notre bouton
            const wintrButtonContainer = document.createElement('div');
            wintrButtonContainer.className = 'game-over-review-button-component wintchess-button-container';
            wintrButtonContainer.style.cssText = `
                margin-top: 10px;
            `;
            
            // Ajouter un label comme pour le bouton bilan
            const label = document.createElement('span');
            label.className = 'game-over-review-button-label';
            label.textContent = CONFIG.BUTTON_TEXT;
            wintrButtonContainer.appendChild(label);
            
            // Créer notre bouton avec le style approprié
            const wintrButton = createGameOverWintrButton();
            wintrButton.classList.add('game-over-review-button-background');
            wintrButtonContainer.appendChild(wintrButton);
            
            // Insérer notre conteneur juste après celui du bouton bilan
            if (gameOverButtons) {
                // Insérer juste après le premier bouton et avant les boutons secondaires
                gameOverButtons.insertBefore(wintrButtonContainer, reviewButtonContainer.nextSibling);
            } else {
                // Fallback: insérer après le bouton bilan s'il n'y a pas de conteneur de boutons
                reviewButtonContainer.parentNode.insertBefore(wintrButtonContainer, reviewButtonContainer.nextSibling);
            }
            
            STATE.buttonAdded = true;
            return true;
        }
        
        return false;
    }

    function tryAddChessComButton(attempts = 0) {
        // Vérifier si le bouton existe déjà
        if (STATE.buttonAdded && document.querySelector('.wintchess-button')) {
            return;
        }

        if (STATE.buttonAdded && !document.querySelector('.wintchess-button')) {
            STATE.buttonAdded = false;
        }
        
        // Attendre que la page soit bien chargée pour éviter d'insérer le bouton trop tôt
        if (document.readyState !== 'complete' && attempts < 5) {
            setTimeout(() => tryAddChessComButton(attempts + 1), CONFIG.RETRY_DELAY);
            return;
        }
        
        // Vérifier si nous sommes dans la modale de fin de partie (priorité la plus haute)
        if (tryAddButtonToGameOverModal()) {
            return;
        }

        // Créer le bouton une seule fois
        const wintrButton = createChessComWintrButton();
        let inserted = false;
        
        // Chercher d'abord le bouton 'Bilan de la partie' pour placer notre bouton juste après
        let bilanButton = null;
        const bilanSelectors = [
            'button.cc-button-component.cc-button-primary.cc-button-xx-large.cc-bg-primary:not(.wintchess-button)',
            'button.cc-button-component.cc-button-primary:not(.wintchess-button)',
            'button.cc-button-component:not(.wintchess-button)',
            'button.cc-button-xx-large:not(.wintchess-button)',
            '.post-game-button button:not(.wintchess-button)',
            '.review-button button:not(.wintchess-button)',
            '.game-review-button button:not(.wintchess-button)'
        ];
        
        // Essayer de trouver un bouton qui contient "Bilan de la partie" ou "Game Review"
        const allButtons = document.querySelectorAll(bilanSelectors.join(', '));
        for (const btn of allButtons) {
            const btnText = btn.textContent.toLowerCase();
            if (btnText.includes('bilan') || 
                btnText.includes('review') ||
                btnText.includes('analysis') ||
                btnText.includes('analyser') ||
                btnText.includes('analyze')) {
                bilanButton = btn;
                break;
            }
        }
        
        // Si on ne trouve pas le bouton, essayer d'en trouver un similaire par la classe
        if (!bilanButton) {
            const similarButtons = document.querySelectorAll('button.cc-button-component.cc-button-xx-large:not(.wintchess-button)');
            if (similarButtons.length > 0) {
                bilanButton = similarButtons[0];
            }
        }

        // Si on trouve le bouton bilan, insérer après lui
        if (bilanButton && bilanButton.parentNode) {
            // Créer une div wrapper pour positionner notre bouton exactement sous le bilan
            const wrapper = document.createElement('div');
            wrapper.className = 'wintchess-button-wrapper';
            wrapper.style.cssText = `
                width: 100%;
                display: block;
                margin-top: 8px;
            `;
            wrapper.appendChild(wintrButton);
            
            // S'assurer que l'élément parent a le style correct pour l'alignement
            if (bilanButton.parentNode) {
                const computedStyle = window.getComputedStyle(bilanButton);
                wintrButton.style.width = computedStyle.width;
                wintrButton.style.maxWidth = computedStyle.maxWidth;
                wintrButton.style.boxSizing = computedStyle.boxSizing;
                wintrButton.style.display = computedStyle.display;
                
                // Si le bouton est dans une flexbox, placer notre bouton sous lui dans le même conteneur
                if (bilanButton.nextElementSibling) {
                    bilanButton.parentNode.insertBefore(wrapper, bilanButton.nextElementSibling);
                } else {
                    bilanButton.parentNode.appendChild(wrapper);
                }
                STATE.buttonAdded = true;
                return true; // Button added successfully
            }
        }
        
        // Si on n'a pas pu insérer directement, essayer les sélecteurs génériques
        if (!STATE.buttonAdded) {
            // Sinon, utiliser les sélecteurs génériques comme avant
            let targetSelectors = [
                { selector: '.cc-modal-content-component, .review-sidebar-module, .post-game-dialog-content', method: 'appendChild', priority: 9 },
                { selector: '.board-controls-panel, .game-controls-panel, .layout-bottom-panel', method: 'appendChild', priority: 8 },
                { selector: '.board-layout-main, .analysis-diagram-container, .analysis-controls', method: 'appendChild', priority: 7 },
                { selector: '.game-controls, .board-controls', method: 'appendChild', priority: 6 },
                { selector: '.sidebar-tabset, .sidebar-tabsetContent, .review-sidebar', method: 'appendChild', priority: 5 },
                { selector: '.game-over-modal-content, .game-result-component', method: 'appendChild', priority: 4 },
                { selector: '.board-layout-sidebar, .layout-sidebar-main', method: 'appendChild', priority: 3 },
                { selector: '.header-control-buttons, .board-controls-extra', method: 'appendChild', priority: 2 }
            ];
        }

        // Trier les sélecteurs par priorité si définie
        const sortedSelectors = targetSelectors.sort((a, b) => (b.priority || 0) - (a.priority || 0));

        for (const { selector, method } of sortedSelectors) {
            // Si selector est déjà un élément DOM, l'utiliser directement
            const containers = selector instanceof Element ? [selector] : document.querySelectorAll(selector);
            if (containers.length > 0) {
                try {
                    const container = containers[0];

                    if (method === 'afterend') {
                        container.insertAdjacentElement('afterend', wintrButton);
                    } else {
                        container.appendChild(wintrButton);
                    }

                    STATE.buttonAdded = true;
                    inserted = true;
                    break;
                } catch (e) {
                    console.error("Erreur lors de l'insertion du bouton:", e);
                }
            }
        }

        // Si nous n'avons pas réussi à insérer le bouton, réessayer
        if (!inserted) {
            if (attempts < CONFIG.MAX_ATTEMPTS - 1) {
                setTimeout(() => tryAddChessComButton(attempts + 1), CONFIG.RETRY_DELAY);
            } else {
                // Faire une pause plus longue avant de réessayer si on atteint le max d'essais
                setTimeout(() => tryAddChessComButton(0), CONFIG.LONG_RETRY_DELAY);
            }
        }
    }

    // ===== WINTRCHESS FUNCTIONS =====

    function initWintrChess() {
        pasteAndAnalyze();
    }

    async function pasteAndAnalyze() {
        const pgnToPaste = await GM_getValue(CONFIG.PGN_STORAGE_KEY, null);

        if (pgnToPaste) {
            // Sélecteurs pour WintrChess
            const selectors = {
                textarea: 'textarea.TerVPsT9aZ0soO8yjZU4',
                analyzeButton: 'button.rHBNQrpvd7mwKp3HqjVQ.THArhyJIfuOy42flULV6',
                // Sélecteurs alternatifs pour tenir compte des changements potentiels de classes
                alternateTextarea: 'textarea[placeholder*="PGN"]',
                alternateButton: 'button:not([disabled]):contains("Analyser"), button:not([disabled]):contains("Analyze")'
            };

            let attempts = 0;
            const maxAttempts = 20;
            const retryDelay = 500;

            const intervalId = setInterval(async () => {
                attempts++;

                // Tenter les différents sélecteurs
                const textarea = document.querySelector(selectors.textarea) ||
                                 document.querySelector(selectors.alternateTextarea);

                const analyzeButton = document.querySelector(selectors.analyzeButton) ||
                                      findButtonByText(["Analyser", "Analyze"]);

                if (textarea && analyzeButton) {
                    clearInterval(intervalId);

                    try {
                        // Mettre le focus sur le textarea
                        textarea.focus();
                        await sleep(CONFIG.AUTO_PASTE_DELAY);

                        // Définir directement la valeur
                        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
                            window.HTMLTextAreaElement.prototype, 'value'
                        ).set;
                        nativeInputValueSetter.call(textarea, pgnToPaste);

                        // Déclencher l'événement input pour simuler une saisie utilisateur
                        textarea.dispatchEvent(new Event('input', { bubbles: true }));
                        await sleep(CONFIG.AUTO_PASTE_DELAY * 2);

                        // Retirer le focus
                        textarea.blur();
                        await sleep(CONFIG.AUTO_PASTE_DELAY);

                        // Cliquer sur le bouton d'analyse
                        analyzeButton.click();

                        // Supprimer les données PGN du stockage après utilisation
                        await GM_deleteValue(CONFIG.PGN_STORAGE_KEY);
                    } catch (error) {
                        console.error("Erreur lors du collage automatique:", error);
                    }
                } else if (attempts >= maxAttempts) {
                    clearInterval(intervalId);
                    console.log("Impossible de trouver les éléments nécessaires sur WintrChess après plusieurs tentatives.");
                }
            }, retryDelay);
        }
    }

    // ===== HELPER FUNCTIONS =====

    function findButtonByText(textOptions) {
        // Fonction pour trouver un bouton par son texte
        for (const text of textOptions) {
            const elements = Array.from(document.querySelectorAll('button:not([disabled])'));
            for (const el of elements) {
                if (el.textContent.includes(text)) {
                    return el;
                }
            }
        }
        return null;
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // ===== BOOTSTRAP =====
    init();
})();