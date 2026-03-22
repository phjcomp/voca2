// Firebase modules (using v10 CDN for pure HTML apps)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

/* 
 * --------------------------------------------------------------------------
 * FIREBASE CONFIGURATION (Replace with your own when creating the Firebase project)
 * --------------------------------------------------------------------------
 */
const firebaseConfig = {
  apiKey: "AIzaSyBJwNFg9Q8oCAeDH7vaDs62q2g3AWHz8ZI",
  authDomain: "voca2-57526.firebaseapp.com",
  projectId: "voca2-57526",
  storageBucket: "voca2-57526.firebasestorage.app",
  messagingSenderId: "860798645039",
  appId: "1:860798645039:web:9789d5e07aac2613cca7da",
  measurementId: "G-E4RDLP1R8T"
};

let app, auth, db;
let hasFirebaseConfig = firebaseConfig.apiKey !== "YOUR_API_KEY";

if (hasFirebaseConfig) {
    try {
        app = initializeApp(firebaseConfig);
        auth = getAuth(app);
        db = getFirestore(app);
    } catch (e) {
        console.warn("Firebase init failed, falling back to local storage.", e);
        hasFirebaseConfig = false;
    }
}

// Deck Config
const APP_DECKS = [
    { id: 'sat_word_smart', file: 'words.json', name: 'SAT Word Smart', desc: '952 Words from Chapter 2 & 4' },
    { id: 'toefl_core', file: 'toefl.json', name: 'New SAT/TOEFL Examples', desc: 'Custom mock deck for testing switching' }
];

// State
let allWords = [];
let userData = { decks: {} }; // Support multi-deck
let activeDeckId = localStorage.getItem('activeDeckId') || 'sat_word_smart';
let currentUser = null;
let currentWord = null;
let isFlipped = false;
let isSyncing = false;
let isQuizMode = true;
let currentCombo = 0;

function getDeckData() {
    if (!userData.decks) userData.decks = {};
    if (!userData.decks[activeDeckId]) {
        userData.decks[activeDeckId] = { reviews: {} };
    }
    return userData.decks[activeDeckId];
}

// DOM Elements
const views = {
    loading: document.getElementById('loading-view'),
    auth: document.getElementById('auth-view'),
    deck: document.getElementById('deck-view'),
    card: document.getElementById('card-view')
};

const dom = {
    pos: document.getElementById('val-pos'),
    combo: document.getElementById('val-combo'),
    btnLibrary: document.getElementById('btn-library'),
    btnCloseLibrary: document.getElementById('btn-close-library'),
    deckList: document.getElementById('deck-list'),
    word: document.getElementById('val-word'),
    pronunciation: document.getElementById('val-pronunciation'),
    definition: document.getElementById('val-definition'),
    examples: document.getElementById('val-examples'),
    progress: document.getElementById('progress-text'),
    
    cardTrigger: document.getElementById('card-trigger'),
    backDetails: document.getElementById('back-details'),
    controlsFront: document.getElementById('controls-front'),
    controlsBack: document.getElementById('controls-back'),
    controlsQuiz: document.getElementById('controls-quiz'),
    
    btnTheme: document.getElementById('btn-theme'),
    btnLogin: document.getElementById('btn-login'),
    btnLogout: document.getElementById('btn-logout'),
    btnAudio: document.getElementById('btn-audio'),
    modeStudy: document.getElementById('mode-study'),
    modeQuiz: document.getElementById('mode-quiz'),
    quizOptions: document.getElementById('quiz-options'),
    
    btnKnown: document.getElementById('btn-known'),
    btnUnsure: document.getElementById('btn-unsure'),
    btnUnknown: document.getElementById('btn-unknown'),
    btnNextQuiz: document.getElementById('btn-next-quiz')
};

/* 
 * 1. INITIALIZATION & DATA LOADING 
 */
async function init() {
    try {
        // Load Dictionary JSON
                const activeDeck = APP_DECKS.find(d => d.id === activeDeckId) || APP_DECKS[0];
        const response = await fetch(activeDeck.file + '?v=47');
        allWords = await response.json();
    } catch (e) {
        alert("Failed to load dictionary. Please check if words.json is present.");
        return;
    }

    // Set up auth listeners or fallback
    if (hasFirebaseConfig) {
        onAuthStateChanged(auth, async (user) => {
            if (user) {
                // Backward Compatibility Migration & Aggressive Recovery!
                // Unconditionally merge legacy reviews and combo if they exist
                if (userData.reviews || userData.combo !== undefined) {
                    if (!userData.decks) userData.decks = {};
                    if (!userData.decks['sat_word_smart']) userData.decks['sat_word_smart'] = { reviews: {} };
                    
                    if (userData.reviews) {
                        userData.decks['sat_word_smart'].reviews = {
                            ...userData.decks['sat_word_smart'].reviews,
                            ...userData.reviews
                        };
                        delete userData.reviews;
                    }
                    if (userData.combo !== undefined) {
                        userData.decks['sat_word_smart'].combo = userData.combo;
                        delete userData.combo;
                    }
                    syncDataToCloud(); // Save migrated data backwards seamlessly
                }
                // Fresh start for the new user
                userData = { reviews: {} };
                currentUser = user;
                await syncDataFromCloud();
                currentCombo = getDeckData().combo || 0;
                showView('card');
                nextCard();
            } else {
                // Clear user data upon logout to prevent info leak
                currentUser = null;
                userData = { reviews: {} };
                showView('auth');
            }
        });
    } else {
        // Fallback to local storage
        console.log("Running in LocalStorage fallback mode.");
        loadLocalData('guest');
        currentCombo = getDeckData().combo || 0;
        showView('card');
        nextCard();
    }
    
    attachEventListeners();
}

/** 
 * 2. SYNC & STORAGE (Priority: Firebase -> LocalStorage)
 */
function getStorageKey() {
    return currentUser ? `sat_vocab_data_${currentUser.uid}` : "sat_vocab_data_guest";
}

async function syncDataFromCloud() {
    if (!hasFirebaseConfig || !currentUser) return;
    try {
        const docRef = doc(db, "users", currentUser.uid);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            userData = docSnap.data();
            
            // AGGRESSIVE RECOVERY MIGRATION: Restore orphaned legacy data safely!
            if (userData.reviews || userData.combo !== undefined) {
                if (!userData.decks) userData.decks = {};
                if (!userData.decks['sat_word_smart']) userData.decks['sat_word_smart'] = { reviews: {} };
                
                if (userData.reviews) {
                    userData.decks['sat_word_smart'].reviews = {
                        ...userData.reviews,
                        ...userData.decks['sat_word_smart'].reviews
                    };
                    delete userData.reviews;
                }
                
                if (userData.combo !== undefined) {
                    userData.decks['sat_word_smart'].combo = userData.combo;
                    delete userData.combo;
                }
                
                // Immediately save the securely migrated data back to the cloud
                await setDoc(docRef, userData); // Replace document entirely to permanently purge the legacy data block
            }
            
            if (!getDeckData().reviews) userData.decks[activeDeckId].reviews = {};
        } else {
            // New user, ensure completely clean slate
            userData = { reviews: {} };
        }
        // Save locally as backup
        localStorage.setItem(getStorageKey(), JSON.stringify(userData));
    } catch (e) {
        console.error("Error syncing from cloud:", e);
        loadLocalData();
    }
}

async function syncDataToCloud() {
    // Always save locally immediately using scoped key
    localStorage.setItem(getStorageKey(), JSON.stringify(userData));
    updateProgressUI();
    
    // Async save to cloud
    if (hasFirebaseConfig && currentUser) {
        try {
            await setDoc(doc(db, "users", currentUser.uid), userData, { merge: true });
        } catch (e) {
            console.error("Error saving to cloud:", e);
        }
    }
}

function loadLocalData() {
    const saved = localStorage.getItem(getStorageKey());
    if (saved) {
        userData = JSON.parse(saved);
        
        // AGGRESSIVE RECOVERY MIGRATION (Local)
        if (userData.reviews || userData.combo !== undefined) {
            if (!userData.decks) userData.decks = {};
            if (!userData.decks['sat_word_smart']) userData.decks['sat_word_smart'] = { reviews: {} };
            
            if (userData.reviews) {
                userData.decks['sat_word_smart'].reviews = {
                    ...userData.reviews,
                    ...userData.decks['sat_word_smart'].reviews
                };
                delete userData.reviews;
            }
            
            if (userData.combo !== undefined) {
                userData.decks['sat_word_smart'].combo = userData.combo;
                delete userData.combo;
            }
            
            // Sync up to ensure local purge hits cloud without merge flag
            if (hasFirebaseConfig && currentUser) {
                setDoc(doc(db, "users", currentUser.uid), userData);
            }
        }
        
        if (!getDeckData().reviews) userData.decks[activeDeckId].reviews = {};
    } else {
        userData = { reviews: {} };
    }
}

function updateProgressUI() {
    const total = allWords.length;
    
    // Known: step >= 1 (Got correct at least once)
    const known = Object.keys(getDeckData().reviews).filter(id => getDeckData().reviews[id].step >= 1).length;
    
    // Calculate cycles/turns based on the minimum seenCount across ALL words.
    let minSeen = Infinity;
    for (const w of allWords) {
        const rev = getDeckData().reviews[w.id];
        // Handle fallback for old data
        const sc = (rev && (rev.seenCount || rev.interval > 0)) ? (rev.seenCount || 1) : 0;
        if (sc < minSeen) minSeen = sc;
    }
    if (minSeen === Infinity) minSeen = 0; // Fallback
    
    // Progress for the *current* turn.
    let currentTurnSeen = 0;
    for (const w of allWords) {
        const rev = getDeckData().reviews[w.id];
        const sc = (rev && (rev.seenCount || rev.interval > 0)) ? (rev.seenCount || 1) : 0;
        if (sc > minSeen) {
            currentTurnSeen++;
        }
    }
    
    dom.progress.innerText = `${known} Known | Turn ${minSeen + 1}: ${currentTurnSeen}/${total} Seen`;
}

/* 
 * 3. SPACED REPETITION ALGORITHM
 */
function getNextWord() {
    const now = Date.now();
    let dueReviews = [];
    let newWords = [];
    
    for (const w of allWords) {
        const reviewData = getDeckData().reviews[w.id];
        if (reviewData && reviewData.interval > 0) {
            // Collect all due reviews for priority 1
            if (reviewData.nextReview <= now) {
                dueReviews.push(w);
            }
        } else {
            // Collect unseen words for priority 2
            newWords.push(w);
        }
    }
    
    if (dueReviews.length > 0) {
        return dueReviews[Math.floor(Math.random() * dueReviews.length)];
    }
    
    if (newWords.length > 0) {
        // Return a random new word rather than alphabetical
        return newWords[Math.floor(Math.random() * newWords.length)];
    }
    
    // Fallback: If everything is perfectly queued (no new words, no due reviews),
    // return a completely random word to kill time.
    return allWords[Math.floor(Math.random() * allWords.length)];
}

function gradeAnswer(rating) {
    if (!currentWord) return;
    const id = currentWord.id;
    let rev = getDeckData().reviews[id] || { step: 0, interval: 0, nextReview: 0 };
    rev.seenCount = (rev.seenCount || 0) + 1;
    
    const now = Date.now();
    const M_MINUTE = 60 * 1000;
    const M_DAY = 24 * 60 * M_MINUTE;
    
    // Simple Spaced Repetition (SuperMemo-2 inspired simplified logic)
    if (rating === 'known') { // Left Swipe
        if (rev.step === 0) {
            rev.interval = 1 * M_DAY;
        } else {
            rev.interval = Math.max(1 * M_DAY, rev.interval * 2.5);
        }
        rev.step++;
    } else if (rating === 'unsure') { // Up Swipe
        rev.interval = 12 * 60 * M_MINUTE; // 12 hours
    } else if (rating === 'unknown') { // Right Swipe
        rev.step = 0;
        rev.interval = 10 * M_MINUTE; // See it again in 10 minutes
    }
    
    rev.nextReview = now + rev.interval;
    getDeckData().reviews[id] = rev;
    
    syncDataToCloud();
}

function processAnswer(rating) {
    gradeAnswer(rating);
    nextCard();
}

/* 
 * 4. UI Rendering
 */
function nextCard() {
    isFlipped = false;
    currentWord = getNextWord();
    
    // Reset classes and scroll position
    document.body.classList.remove('state-back', 'state-auth');
    document.body.classList.add('state-front');
    dom.backDetails.style.display = 'none';
    dom.backDetails.scrollTop = 0;
    if (dom.cardTrigger) dom.cardTrigger.scrollTop = 0; /* Fixes scroll retention across cards */
    dom.controlsBack.style.display = 'none';
    
    // Quiz Mode Logic
    dom.quizOptions.innerHTML = '';
    
    if (isQuizMode) {
        dom.modeStudy.classList.remove('active');
        dom.modeQuiz.classList.add('active');
        
        dom.quizOptions.classList.remove('hidden');
        dom.controlsFront.style.display = 'none';
        dom.controlsQuiz.style.display = 'none';
        
        generateQuiz();
    } else {
        dom.modeQuiz.classList.remove('active');
        dom.modeStudy.classList.add('active');
        
        dom.quizOptions.classList.add('hidden');
        dom.controlsFront.style.display = 'flex';
        dom.controlsQuiz.style.display = 'none';
    }
    
    // Populate Front
    dom.word.innerText = currentWord.word;
    
    let rev = getDeckData().reviews[currentWord.id];
    let seenCount = (rev && rev.seenCount) ? rev.seenCount : 0;
    if (seenCount === 0 && rev && rev.interval > 0) seenCount = 1; // Fallback for old data
    
    let rankIcon = '🌱';
    let step = rev ? rev.step : 0;
    if (step >= 4) rankIcon = '👑';
    else if (step === 3) rankIcon = '🥇';
    else if (step === 2) rankIcon = '🥈';
    else if (step === 1) rankIcon = '🥉';

    let seenStr = seenCount > 0 ? ` • SEEN ${seenCount} TIMES` : ' • NEW';
    dom.pos.innerText = `${currentWord.pos}${seenStr} ${rankIcon}`;
    
    if (dom.combo) dom.combo.innerText = `${currentCombo} Combo!`;
    
    dom.pronunciation.innerText = currentWord.pronunciation;
    
    // Pre-populate Back
    dom.definition.innerText = currentWord.definition;
    
    dom.examples.innerHTML = '';
    if (currentWord.examples && currentWord.examples.length > 0) {
        currentWord.examples.forEach(ex => {
            const li = document.createElement('li');
            li.innerText = ex;
            dom.examples.appendChild(li);
        });
    } else {
        dom.examples.innerHTML = '<li>No examples provided.</li>';
    }
    
    updateProgressUI();
}

function flipCard() {
    if (isQuizMode || isFlipped) return;
    isFlipped = true;
    
    document.body.classList.remove('state-front');
    document.body.classList.add('state-back');
    dom.backDetails.style.display = 'block';
    dom.controlsFront.style.display = 'none';
    dom.controlsBack.style.display = 'flex';
}

function generateQuiz() {
    let quizAnswered = false;
    let options = [];
    options.push({ text: currentWord.definition, correct: true, word: currentWord.word, pronunciation: currentWord.pronunciation, roots: currentWord.roots });
    
    // Strict POS Matching Filtering
    let candidates = allWords.filter(w => w.id !== currentWord.id && w.pos === currentWord.pos);
    
    // Fallback if not enough matches found
    if (candidates.length < 3) {
        candidates = allWords.filter(w => w.id !== currentWord.id);
    }
    
    candidates.sort(() => 0.5 - Math.random());
    
    for (let i = 0; i < 3; i++) {
        let cw = candidates[i];
        options.push({ text: cw.definition, correct: false, word: cw.word, pronunciation: cw.pronunciation, roots: cw.roots });
        
        // Count as "Seen" because it was presented as an option
        let r = getDeckData().reviews[cw.id] || { step: 0, interval: 0, nextReview: 0 };
        r.seenCount = (r.seenCount || 0) + 1;
        getDeckData().reviews[cw.id] = r;
    }
    
    options.sort(() => 0.5 - Math.random());
    
    options.forEach(opt => {
        const btn = document.createElement('button');
        btn.className = 'quiz-btn';
        btn.innerHTML = `<div class="quiz-def">${opt.text}</div>`;
        btn.optData = opt;
        
        btn.onclick = (e) => {
            e.stopPropagation();
            if (quizAnswered) return;
            quizAnswered = true;
            
            if (opt.correct) {
                currentCombo++;
            } else {
                currentCombo--;
                if (currentCombo < 0) currentCombo = 0;
            }
            
            getDeckData().combo = currentCombo;
            gradeAnswer(opt.correct ? 'known' : 'unknown');
            
            const allBtns = dom.quizOptions.querySelectorAll('.quiz-btn');
            allBtns.forEach(b => {
                const bOpt = b.optData;
                if (bOpt.correct) b.classList.add('correct');
                else if (b === btn) b.classList.add('wrong');
                
                const wordSpan = document.createElement('div');
                wordSpan.className = 'quiz-word-reveal';
                wordSpan.style.display = 'flex';
                wordSpan.style.alignItems = 'center';
                
                const speakerBtn = document.createElement('button');
                speakerBtn.className = 'icon-btn audio-btn';
                speakerBtn.style.padding = '0';
                speakerBtn.style.marginRight = '8px';
                speakerBtn.style.width = '24px';
                speakerBtn.style.height = '24px';
                speakerBtn.innerHTML = '<ion-icon name="volume-high-outline"></ion-icon>';
                speakerBtn.onclick = (ev) => {
                    ev.stopPropagation();
                    speakText(bOpt.word);
                };
                
                const textSpan = document.createElement('span');
                let pronunStr = bOpt.pronunciation ? ` <span class="quiz-pronun">(${bOpt.pronunciation})</span>` : '';
                textSpan.innerHTML = `${bOpt.word}${pronunStr}`;
                
                const wordContainer = document.createElement('div');
                wordContainer.style.display = 'flex';
                wordContainer.style.flexDirection = 'column';
                wordContainer.style.alignItems = 'flex-start';
                
                const topRow = document.createElement('div');
                topRow.style.display = 'flex';
                topRow.style.alignItems = 'center';
                topRow.appendChild(speakerBtn);
                topRow.appendChild(textSpan);
                
                wordContainer.appendChild(topRow);
                
                if (bOpt.roots) {
                    const rootsSpan = document.createElement('div');
                    rootsSpan.style.marginTop = '4px';
                    rootsSpan.style.fontSize = '0.9rem';
                    rootsSpan.innerHTML = `<em>${bOpt.roots}</em>`;
                    rootsSpan.style.marginLeft = '32px';
                    wordContainer.appendChild(rootsSpan);
                }
                
                wordSpan.appendChild(wordContainer);
                b.insertBefore(wordSpan, b.firstChild);
            });
            
            if (dom.combo) dom.combo.innerText = `${currentCombo} Combo!`;
            
            const topCombo = document.getElementById('combo-display');
            if (topCombo) {
                if (currentCombo >= 10) {
                    topCombo.innerText = `🔥 ${currentCombo} COMBO!`;
                    topCombo.style.opacity = '1';
                } else {
                    topCombo.style.opacity = '0';
                }
            }
            
            dom.controlsQuiz.style.display = 'flex';
        };
        dom.quizOptions.appendChild(btn);
    });
}

function showView(viewId) {
    Object.keys(views).forEach(key => views[key].classList.add('hidden'));
    views[viewId].classList.remove('hidden');
    if (viewId === 'auth') {
        document.body.classList.remove('state-front', 'state-back');
        document.body.classList.add('state-auth');
    } else {
        document.body.classList.remove('state-auth');
    }
}

// Text to Speech
window.speakWord = function() {
    if (!currentWord) return;
    const utterance = new SpeechSynthesisUtterance(currentWord.word);
    utterance.lang = 'en-US';
    window.speechSynthesis.speak(utterance);
}

/* 
 * 5. Event Listeners
 */
function attachEventListeners() {
    // Auth
    dom.btnLogin.addEventListener('click', () => {
        if (!hasFirebaseConfig) {
            alert("Firebase is not configured! Check app.js. Running in LocalStorage mode instead.");
            showView('card');
            nextCard();
            return;
        }
        signInWithPopup(auth, new GoogleAuthProvider()).catch(e => console.error(e));
    });
    
    dom.btnLogout.addEventListener('click', () => {
        if (hasFirebaseConfig && auth.currentUser) {
            signOut(auth).then(() => showView('auth'));
        } else {
            showView('auth');
        }
    });

    // Theme Toggle
    let isLightMode = localStorage.getItem('sat_vocab_theme') === 'light';
    function applyTheme() {
        if (isLightMode) {
            document.body.classList.add('light-mode');
            dom.btnTheme.innerHTML = '<ion-icon name="sunny-outline"></ion-icon>';
        } else {
            document.body.classList.remove('light-mode');
            dom.btnTheme.innerHTML = '<ion-icon name="moon-outline"></ion-icon>';
        }
    }
    applyTheme();
    
    dom.btnLibrary.addEventListener('click', () => {
        renderDeckList();
        showView('deck');
    });

    dom.btnCloseLibrary.addEventListener('click', () => {
        showView('card');
    });

    dom.btnTheme.addEventListener('click', () => {
        isLightMode = !isLightMode;
        localStorage.setItem('sat_vocab_theme', isLightMode ? 'light' : 'dark');
        applyTheme();
    });

    // Mode Toggle
    dom.modeStudy.addEventListener('click', () => {
        if (!isQuizMode) return;
        isQuizMode = false;
        nextCard();
    });
    
    dom.modeQuiz.addEventListener('click', () => {
        if (isQuizMode) return;
        isQuizMode = true;
        nextCard();
    });

    // Card Flipping & Tabbing
    dom.cardTrigger.addEventListener('click', flipCard);
    dom.btnAudio.addEventListener('click', (e) => {
        e.stopPropagation();
        window.speakWord();
    });

    // Swipe buttons
    dom.btnKnown.addEventListener('click', () => processAnswer('known'));
    dom.btnUnsure.addEventListener('click', () => processAnswer('unsure'));
    dom.btnUnknown.addEventListener('click', () => processAnswer('unknown'));
    dom.btnNextQuiz.addEventListener('click', (e) => {
        e.stopPropagation();
        nextCard();
    });
    
    // Keyboard Support (Arrows)
    document.addEventListener('keydown', (e) => {
        if (views.card.classList.contains('hidden') || isQuizMode) return;
        
        if (!isFlipped && (e.code === 'Space' || e.code === 'Enter' || e.code === 'ArrowUp')) {
            flipCard();
        } else if (isFlipped) {
            if (e.code === 'ArrowLeft') processAnswer('known');
            if (e.code === 'ArrowUp') processAnswer('unsure');
            if (e.code === 'ArrowRight') processAnswer('unknown');
        }
    });

    // ----------------------------------------------------
    // Simple Swipe Gesture Recognition for Mobile
    // ----------------------------------------------------
    let touchStartX = 0;
    let touchStartY = 0;
    
    document.addEventListener('touchstart', e => {
        touchStartX = e.changedTouches[0].screenX;
        touchStartY = e.changedTouches[0].screenY;
    });

    document.addEventListener('touchend', e => {
        if (!isFlipped || views.card.classList.contains('hidden') || isQuizMode) return;
        
        let touchEndX = e.changedTouches[0].screenX;
        let touchEndY = e.changedTouches[0].screenY;
        
        handleSwipe(touchStartX, touchStartY, touchEndX, touchEndY);
    });

    function handleSwipe(startX, startY, endX, endY) {
        const diffX = endX - startX;
        const diffY = endY - startY;
        const threshold = 50;

        // Ensure vertical scroll doesn't trigger swipe
        if (Math.abs(diffX) > Math.abs(diffY)) {
            if (diffX > threshold) {
                // Swipe Right (Don't Know)
                processAnswer('unknown');
            } else if (diffX < -threshold) {
                // Swipe Left (Know)
                processAnswer('known');
            }
        }
    }
}

// Start
init();

function speakText(text) {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = 0.9;
    window.speechSynthesis.speak(utterance);
}

function renderDeckList() {
    if (!dom.deckList) return;
    dom.deckList.innerHTML = '';
    APP_DECKS.forEach(d => {
        const item = document.createElement('div');
        item.className = `deck-item ${d.id === activeDeckId ? 'active' : ''}`;
        item.innerHTML = `<h3>${d.name}</h3><p>${d.desc}</p>`;
        item.onclick = async () => {
            activeDeckId = d.id;
            localStorage.setItem('activeDeckId', activeDeckId);
            showView('loading');
            
            try {
                const response = await fetch(d.file + '?v=47');
                allWords = await response.json();
            } catch (e) {
                console.error("Failed to load deck:", e);
            }
            
            currentCombo = getDeckData().combo || 0;
            if (dom.combo) dom.combo.innerText = `${currentCombo} Combo!`;
            
            showView('card');
            nextCard();
        };
        dom.deckList.appendChild(item);
    });
}
