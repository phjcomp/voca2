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
  apiKey: "AIzaSyCaK4SbAEUjIE65jizDY2fqbvUpZMspng8",
  authDomain: "voca-9f610.firebaseapp.com",
  projectId: "voca-9f610",
  storageBucket: "voca-9f610.firebasestorage.app",
  messagingSenderId: "869261146669",
  appId: "1:869261146669:web:ce613469bc3986cc8f96a4",
  measurementId: "G-V2MNKMCFLQ"
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

// State
let allWords = [];
let userData = { reviews: {} }; // wordId -> { interval, nextReview, step }
let currentUser = null;
let currentWord = null;
let isFlipped = false;
let isSyncing = false;
let isQuizMode = true;

// DOM Elements
const views = {
    loading: document.getElementById('loading-view'),
    auth: document.getElementById('auth-view'),
    card: document.getElementById('card-view')
};

const dom = {
    pos: document.getElementById('val-pos'),
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
        const response = await fetch('words.json');
        allWords = await response.json();
    } catch (e) {
        alert("Failed to load dictionary. Please check if words.json is present.");
        return;
    }

    // Set up auth listeners or fallback
    if (hasFirebaseConfig) {
        onAuthStateChanged(auth, async (user) => {
            if (user) {
                currentUser = user;
                await syncDataFromCloud();
                showView('card');
                nextCard();
            } else {
                showView('auth');
            }
        });
    } else {
        // Fallback to local storage
        console.log("Running in LocalStorage fallback mode.");
        loadLocalData();
        showView('card');
        nextCard();
    }
    
    attachEventListeners();
}

/** 
 * 2. SYNC & STORAGE (Priority: Firebase -> LocalStorage)
 */
async function syncDataFromCloud() {
    if (!hasFirebaseConfig || !currentUser) return;
    try {
        const docRef = doc(db, "users", currentUser.uid);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            userData = docSnap.data();
            if (!userData.reviews) userData.reviews = {};
        }
        // Save locally as backup
        localStorage.setItem("sat_vocab_data", JSON.stringify(userData));
    } catch (e) {
        console.error("Error syncing from cloud:", e);
        loadLocalData();
    }
}

async function syncDataToCloud() {
    // Always save locally immediately
    localStorage.setItem("sat_vocab_data", JSON.stringify(userData));
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
    const saved = localStorage.getItem("sat_vocab_data");
    if (saved) {
        userData = JSON.parse(saved);
        if (!userData.reviews) userData.reviews = {};
    }
}

function updateProgressUI() {
    const total = allWords.length;
    
    // Mastered: step >= 3 (Correct 3 times)
    const mastered = Object.keys(userData.reviews).filter(id => userData.reviews[id].step >= 3).length;
    
    // Seen: seenCount > 0 or has interval (fallback for old data)
    const seen = Object.keys(userData.reviews).filter(id => {
        const rev = userData.reviews[id];
        return (rev.seenCount && rev.seenCount > 0) || rev.interval > 0;
    }).length;
    
    dom.progress.innerText = `${mastered} Mastered  |  ${seen} / ${total} Seen`;
}

/* 
 * 3. SPACED REPETITION ALGORITHM
 */
function getNextWord() {
    const now = Date.now();
    let dueReviews = [];
    let newWords = [];
    
    for (const w of allWords) {
        const reviewData = userData.reviews[w.id];
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
    let rev = userData.reviews[id] || { step: 0, interval: 0, nextReview: 0 };
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
    userData.reviews[id] = rev;
    
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
    document.body.className = 'state-front';
    dom.backDetails.style.display = 'none';
    dom.backDetails.scrollTop = 0;
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
    
    let rev = userData.reviews[currentWord.id];
    let seenCount = (rev && rev.seenCount) ? rev.seenCount : 0;
    if (seenCount === 0 && rev && rev.interval > 0) seenCount = 1; // Fallback for old data
    
    let seenStr = seenCount > 0 ? ` • Seen ${seenCount} times` : ' • New';
    dom.pos.innerText = `${currentWord.pos}${seenStr}`;
    
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
    
    document.body.className = 'state-back';
    dom.backDetails.style.display = 'block';
    dom.controlsFront.style.display = 'none';
    dom.controlsBack.style.display = 'flex';
}

function generateQuiz() {
    let quizAnswered = false;
    let options = [];
    options.push({ text: currentWord.definition, correct: true, word: currentWord.word });
    
    let candidates = allWords.filter(w => w.id !== currentWord.id);
    candidates.sort(() => 0.5 - Math.random());
    
    for (let i = 0; i < 3; i++) {
        let cw = candidates[i];
        options.push({ text: cw.definition, correct: false, word: cw.word });
        
        // Count as "Seen" because it was presented as an option
        let r = userData.reviews[cw.id] || { step: 0, interval: 0, nextReview: 0 };
        r.seenCount = (r.seenCount || 0) + 1;
        userData.reviews[cw.id] = r;
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
            
            gradeAnswer(opt.correct ? 'known' : 'unknown');
            
            const allBtns = dom.quizOptions.querySelectorAll('.quiz-btn');
            allBtns.forEach(b => {
                const bOpt = b.optData;
                if (bOpt.correct) b.classList.add('correct');
                else if (b === btn) b.classList.add('wrong');
                
                const wordSpan = document.createElement('div');
                wordSpan.className = 'quiz-word-reveal';
                wordSpan.innerText = `👉 ${bOpt.word}`;
                b.insertBefore(wordSpan, b.firstChild);
            });
            
            dom.controlsQuiz.style.display = 'flex';
        };
        dom.quizOptions.appendChild(btn);
    });
}

function showView(viewId) {
    Object.keys(views).forEach(key => views[key].classList.add('hidden'));
    views[viewId].classList.remove('hidden');
    if (viewId === 'auth') document.body.className = 'state-auth';
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
