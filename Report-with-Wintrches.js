// ==UserScript==
// @name         Lichess to WintrChess PGN Transfer
// @namespace    http://tampermonkey.net/
// @description  Ajoute un bouton sur Lichess (jeu/analyse/étude) pour récupérer le PGN via API (ou scraping) et l'envoyer à WintrChess.
// @author       Lucas_M54
// @include      /^https\:\/\/lichess\.org\/[a-zA-Z0-9]{8,}/
// @include      /^https\:\/\/lichess\.org\/study\/.*/
// @include      /^https\:\/\/lichess\.org\/analysis.*/
// @match        https://wintrchess.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @connect      lichess.org
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

    // Détermine si nous sommes sur une page Lichess ou WintrChess et agit en conséquence
    function init() {
        if (window.location.hostname === 'lichess.org') {
            initLichess();
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
            // Page d'entraînement/puzzle
            else if (pathParts[0] === 'training' && pathParts.length >= 2) {
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