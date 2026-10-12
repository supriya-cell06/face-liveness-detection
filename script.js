// ==========================================
// Authentication Module
// ==========================================
function initAuth() {
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    const loginCard = document.getElementById('loginCard');
    const registerCard = document.getElementById('registerCard');
    const showRegisterBtn = document.getElementById('showRegisterBtn');
    const showLoginBtn = document.getElementById('showLoginBtn');
    
    const loginError = document.getElementById('loginError');
    const regError = document.getElementById('regError');

    // Toggle between login and register
    showRegisterBtn?.addEventListener('click', () => {
        loginCard.classList.add('hidden');
        registerCard.classList.remove('hidden');
    });

    showLoginBtn?.addEventListener('click', () => {
        registerCard.classList.add('hidden');
        loginCard.classList.remove('hidden');
    });

    // Handle Registration
    registerForm?.addEventListener('submit', (e) => {
        e.preventDefault();
        const name = document.getElementById('regName').value;
        const email = document.getElementById('regEmail').value.toLowerCase().trim();
        const password = document.getElementById('regPassword').value;

        // Basic validation
        if (password.length < 6) {
            showError(regError, 'Password must be at least 6 characters');
            return;
        }
        
        let users = {};
        try {
            users = JSON.parse(localStorage.getItem('users') || '{}');
        } catch(e) {
            users = {};
        }
        
        if (users[email]) {
            showError(regError, 'Email already registered');
            return;
        }

        users[email] = { name, password: password };
        localStorage.setItem('users', JSON.stringify(users));
        
        // Auto-login
        localStorage.setItem('currentUser', JSON.stringify({ email, name }));
        window.location.href = 'enroll_face.html';
    });

    // Handle Login
    loginForm?.addEventListener('submit', (e) => {
        e.preventDefault();
        const email = document.getElementById('loginEmail').value.toLowerCase().trim();
        const password = document.getElementById('loginPassword').value;

        let users = {};
        try {
            users = JSON.parse(localStorage.getItem('users') || '{}');
        } catch(e) {
            users = {};
        }
        
        const user = users[email];

        if (!user || user.password !== password) {
            showError(loginError, 'Invalid email or password');
            return;
        }

        localStorage.setItem('currentUser', JSON.stringify({ email, name: user.name }));
        if (user.faceDescriptor) {
            window.location.href = 'dashboard.html';
        } else {
            window.location.href = 'enroll_face.html';
        }
    });

    // If already logged in, redirect
    if (localStorage.getItem('currentUser')) {
        const currentUser = JSON.parse(localStorage.getItem('currentUser'));
        let users = JSON.parse(localStorage.getItem('users') || '{}');
        let user = users[currentUser.email];
        
        if (user && user.faceDescriptor) {
            window.location.href = 'dashboard.html';
        } else {
            window.location.href = 'enroll_face.html';
        }
    }
}

function showError(el, msg) {
    el.textContent = msg;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 3000);
}

// ==========================================
// Liveness Detection Module
// ==========================================

const QUOTES = [
    "You're awesome! Keep smiling 😊",
    "Success verified — and so are you!",
    "Great job! You made it look easy 😎",
    "Stay positive and keep shining ✨",
    "Verification complete — have a wonderful day!",
    "Smile detected, happiness unlocked 😄",
    "You passed with confidence! 🚀",
    "Keep going, you're doing amazing!",
    "Bright face, bright future 🌟",
    "All set! Go conquer your day 💪"
];

const CHALLENGES = [
    { type: 'tilt_head', textKey: 'tilt_head' },
    { type: 'smile', textKey: 'smile' },
    { type: 'open_mouth', textKey: 'open_mouth' },
    { type: 'turn_left', textKey: 'turn_left' },
    { type: 'turn_right', textKey: 'turn_right' },
    { type: 'look_surprised', textKey: 'look_surprised' },
    { type: 'look_angry', textKey: 'look_angry' }
];

let stream = null;
let challengeSequence = [];
let currentStepIndex = 0;
const TOTAL_STEPS = 3;
let currentChallenge = null;
let challengeStartTime = 0;
let challengeDuration = 5000; // 5 seconds
let animationFrameId = null;
let isVerifying = false;
let detectionState = 'WAITING'; // WAITING, ACTIVE, SUCCESS, FAILED

async function initDashboard() {
    // Auth Check
    let currentUser = null;
    try {
        currentUser = JSON.parse(localStorage.getItem('currentUser'));
    } catch(e) {}

    if (!currentUser) {
        window.location.href = 'index.html';
        return;
    }

    // Logout
    document.getElementById('logoutBtn')?.addEventListener('click', () => {
        localStorage.removeItem('currentUser');
        stopCamera();
        window.location.href = 'index.html';
    });

    document.getElementById('retryBtn')?.addEventListener('click', () => {
        resetChallenge();
    });

    try {
        // Load Models from CDN to avoid local server requirement
        const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/';
        await Promise.all([
            faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
            faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
            faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL),
            faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
        ]);

        document.getElementById('loadingState').classList.add('hidden');
        document.getElementById('livenessInterface').classList.remove('hidden');

        startCamera();
    } catch (err) {
        console.error("Model loading failed:", err);
        document.getElementById('loadingState').innerHTML = `<p style="color:var(--error)">Error loading models. Please ensure the models folder exists and you are running via a local server.</p>`;
    }
}

async function startCamera() {
    const video = document.getElementById('video');
    try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        video.srcObject = stream;
        
        video.onloadedmetadata = () => {
            const canvas = document.getElementById('overlay');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            startDetectionLoop();
        };
    } catch (err) {
        console.error("Camera access denied:", err);
        updateStatus('error', 'Camera access denied. Please allow permissions.');
    }
}

function stopCamera() {
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
    }
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
    }
}

function generateChallengeSequence() {
    let shuffled = [...CHALLENGES].sort(() => 0.5 - Math.random());
    challengeSequence = shuffled.slice(0, TOTAL_STEPS);
    currentStepIndex = 0;
    startNextStep();
}

let lastSpokenText = '';
function setInstruction(text) {
    const el = document.getElementById('instructionText');
    if (el && el.textContent !== text) {
        el.textContent = text;
        if (lastSpokenText !== text) {
            speak(text);
            lastSpokenText = text;
        }
    }
}

function startNextStep() {
    currentChallenge = challengeSequence[currentStepIndex];
    challengeStartTime = Date.now();
    detectionState = 'ACTIVE';
    
    setInstruction(`Step ${currentStepIndex + 1}/${TOTAL_STEPS}: ${t(currentChallenge.textKey)}`);
    updateStatus('verifying', t('verifying'));
}

function resetChallenge() {
    document.getElementById('retryBtn').classList.add('hidden');
    document.getElementById('statusBadge').classList.add('hidden');
    document.getElementById('quoteContainer').classList.add('hidden');
    document.getElementById('accessGrantedScreen').classList.add('hidden');
    document.getElementById('livenessInterface').classList.remove('hidden');
    detectionState = 'WAITING';
    challengeSequence = [];
    currentStepIndex = 0;
    setInstruction(t('instruction_wait'));
    document.getElementById('timer').textContent = '--';
    
    if (!stream || !stream.active) {
        startCamera();
    }
}

function showSuccess() {
    detectionState = 'SUCCESS';
    stopCamera();
    
    // Hide liveness interface entirely
    document.getElementById('livenessInterface').classList.add('hidden');
    
    // Show Access Granted Screen
    document.getElementById('accessGrantedScreen').classList.remove('hidden');

    // Show quote
    const quote = QUOTES[Math.floor(Math.random() * QUOTES.length)];
    const quoteContainer = document.getElementById('quoteContainer');
    document.getElementById('quoteText').textContent = quote;
    quoteContainer.classList.remove('hidden');
}

function showFailure() {
    detectionState = 'FAILED';
    updateStatus('error', t('verification_failed'));
    setInstruction(t('time_expired'));
    document.getElementById('retryBtn').classList.remove('hidden');
}

function updateStatus(type, message) {
    const badge = document.getElementById('statusBadge');
    badge.textContent = message;
    badge.className = `status-badge status-${type}`;
    badge.classList.remove('hidden');
}

// ------------------------------------------
// Math and Landmark Analysis
// ------------------------------------------

function getEuclideanDistance(pt1, pt2) {
    return Math.sqrt(Math.pow(pt1.x - pt2.x, 2) + Math.pow(pt1.y - pt2.y, 2));
}

function calculateEAR(eye) {
    // eye points: 0: outer, 1: top-outer, 2: top-inner, 3: inner, 4: bottom-inner, 5: bottom-outer
    const v1 = getEuclideanDistance(eye[1], eye[5]);
    const v2 = getEuclideanDistance(eye[2], eye[4]);
    const h = getEuclideanDistance(eye[0], eye[3]);
    return (v1 + v2) / (2.0 * h);
}

function calculateMAR(mouth) {
    // mouth points: 0-11 outer lip, 12-19 inner lip
    // Inner lip points: 12: left corner, 13: top-left, 14: top-center, 15: top-right, 16: right corner, 17: bottom-right, 18: bottom-center, 19: bottom-left
    const v1 = getEuclideanDistance(mouth[14], mouth[18]); // top-center to bottom-center inner
    const h = getEuclideanDistance(mouth[12], mouth[16]); // left corner to right corner inner
    return v1 / h;
}

// ------------------------------------------
// Main Detection Loop
// ------------------------------------------

async function startDetectionLoop() {
    const video = document.getElementById('video');
    const canvas = document.getElementById('overlay');
    const displaySize = { width: video.videoWidth, height: video.videoHeight };
    
    // Sometimes video plays slightly before dimensions are fully ready
    if(displaySize.width === 0) {
        requestAnimationFrame(startDetectionLoop);
        return;
    }

    faceapi.matchDimensions(canvas, displaySize);

    async function detect() {
        if (detectionState === 'SUCCESS') return; // Stop loop if successful

        const detections = await faceapi.detectAllFaces(video, new faceapi.TinyFaceDetectorOptions())
            .withFaceLandmarks()
            .withFaceExpressions()
            .withFaceDescriptors();
        
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        if (detections.length === 1) {
            const resizedDetections = faceapi.resizeResults(detections, displaySize);
            
            // Draw box, landmarks, and expressions
            faceapi.draw.drawDetections(canvas, resizedDetections);
            faceapi.draw.drawFaceLandmarks(canvas, resizedDetections);
            faceapi.draw.drawFaceExpressions(canvas, resizedDetections, 0.1);

            const landmarks = resizedDetections[0].landmarks;
            const expressions = resizedDetections[0].expressions;
            const descriptor = resizedDetections[0].descriptor;

            // --- Biometric Authentication Logic ---
            let currentUser = JSON.parse(localStorage.getItem('currentUser'));
            let users = JSON.parse(localStorage.getItem('users') || '{}');
            let userRecord = users[currentUser.email];
            
            if (!userRecord.faceDescriptor) {
                // Should not happen in dashboard anymore, but just in case
                window.location.href = 'enroll_face.html';
                return;
            } else {
                // Verification phase: Compare face with enrolled face
                const savedDescriptor = new Float32Array(userRecord.faceDescriptor);
                const distance = faceapi.euclideanDistance(descriptor, savedDescriptor);
                
                // 0.6 is a standard threshold for facial matching using this model
                if (distance > 0.6) {
                    setInstruction(t('face_mismatch'));
                    if (detectionState === 'ACTIVE') showFailure();
                    animationFrameId = requestAnimationFrame(detect);
                    return; // Skip action validation for wrong person
                }
            }
            // ----------------------------------------

            if (detectionState === 'WAITING') {
                generateChallengeSequence();
            } else if (detectionState === 'ACTIVE') {
                const timeElapsed = Date.now() - challengeStartTime;
                const timeLeft = Math.max(0, (challengeDuration - timeElapsed) / 1000);
                document.getElementById('timer').textContent = timeLeft.toFixed(1) + 's';

                if (timeLeft <= 0) {
                    showFailure();
                } else {
                    validateAction(landmarks, expressions);
                }
            }
        } else if (detections.length > 1) {
            setInstruction(t('multiple_faces'));
            if (detectionState === 'ACTIVE') showFailure();
        } else {
            if (detectionState === 'ACTIVE') {
                setInstruction(t('face_lost'));
            } else {
                setInstruction(t('instruction_wait'));
            }
        }

        if (detectionState !== 'SUCCESS') {
            animationFrameId = requestAnimationFrame(detect);
        }
    }
    
    detect();
}

function validateAction(landmarks, expressions) {
    const leftEye = landmarks.getLeftEye();
    const rightEye = landmarks.getRightEye();
    const mouth = landmarks.getMouth();
    const nose = landmarks.getNose();
    const jawOutline = landmarks.getJawOutline();

    const leftEAR = calculateEAR(leftEye);
    const rightEAR = calculateEAR(rightEye);
    const avgEAR = (leftEAR + rightEAR) / 2;
    const mar = calculateMAR(mouth);

    // Head pose estimation (very basic)
    const noseTip = nose[3];
    const leftEdge = jawOutline[0];
    const rightEdge = jawOutline[16];
    
    const distLeft = getEuclideanDistance(noseTip, leftEdge);
    const distRight = getEuclideanDistance(noseTip, rightEdge);
    const ratio = distLeft / distRight;

    let isActionPassed = false;

    switch (currentChallenge.type) {
        case 'tilt_head':
            // Check the angle between the outer corners of the eyes
            const dY = rightEye[3].y - leftEye[0].y;
            const dX = rightEye[3].x - leftEye[0].x;
            const tiltAngle = Math.abs(Math.atan2(dY, dX) * 180 / Math.PI);
            if (tiltAngle > 12) isActionPassed = true;
            break;
        case 'smile':
            // MAR > 0.3 can indicate open mouth, but for a smile we look at mouth corners distance expanding
            // For simplicity, a wide MAR or significant horizontal stretching of outer lips (0 and 6)
            const mouthWidth = getEuclideanDistance(mouth[0], mouth[6]);
            const faceWidth = getEuclideanDistance(jawOutline[2], jawOutline[14]);
            if (mouthWidth / faceWidth > 0.45 || mar > 0.4) isActionPassed = true;
            break;
        case 'open_mouth':
            if (mar > 0.5) isActionPassed = true;
            break;
        case 'turn_left':
            // Since camera is mirrored, turning head left (user's left) means nose moves towards right edge of image
            // distance to left edge increases, right decreases
            if (ratio > 1.8) isActionPassed = true;
            break;
        case 'turn_right':
            if (ratio < 0.55) isActionPassed = true;
            break;
        case 'look_surprised':
            if (expressions && expressions.surprised > 0.8) isActionPassed = true;
            break;
        case 'look_angry':
            if (expressions && expressions.angry > 0.8) isActionPassed = true;
            break;
    }

    if (isActionPassed) {
        currentStepIndex++;
        if (currentStepIndex >= TOTAL_STEPS) {
            showSuccess();
        } else {
            detectionState = 'STEP_PASSED';
            updateStatus('success', t('step_passed'));
            setInstruction(t('step_passed'));
            setTimeout(() => {
                if (detectionState === 'STEP_PASSED') {
                    startNextStep();
                }
            }, 1500); // 1.5 second pause between steps
        }
    }
}

async function initEnrollment() {
    let currentUser = JSON.parse(localStorage.getItem('currentUser'));
    if (!currentUser) {
        window.location.href = 'index.html';
        return;
    }

    document.getElementById('logoutBtn')?.addEventListener('click', () => {
        localStorage.removeItem('currentUser');
        stopCamera();
        window.location.href = 'index.html';
    });

    try {
        const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/';
        await Promise.all([
            faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
            faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
            faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL),
            faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
        ]);

        document.getElementById('loadingState').classList.add('hidden');
        document.getElementById('enrollInterface').classList.remove('hidden');

        startEnrollmentCamera();
    } catch (err) {
        console.error("Model loading failed:", err);
        document.getElementById('loadingState').innerHTML = `<p style="color:var(--error)">Error loading models.</p>`;
    }
}

async function startEnrollmentCamera() {
    const video = document.getElementById('video');
    try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        video.srcObject = stream;
        
        video.onloadedmetadata = () => {
            const canvas = document.getElementById('overlay');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            startEnrollmentLoop();
        };
    } catch (err) {
        console.error("Camera access denied:", err);
    }
}

async function startEnrollmentLoop() {
    const video = document.getElementById('video');
    const canvas = document.getElementById('overlay');
    const displaySize = { width: video.videoWidth, height: video.videoHeight };
    
    if(displaySize.width === 0) {
        requestAnimationFrame(startEnrollmentLoop);
        return;
    }

    faceapi.matchDimensions(canvas, displaySize);

    let framesWithFace = 0;

    async function detect() {
        const detections = await faceapi.detectAllFaces(video, new faceapi.TinyFaceDetectorOptions())
            .withFaceLandmarks()
            .withFaceExpressions()
            .withFaceDescriptors();
        
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        if (detections.length === 1) {
            const resizedDetections = faceapi.resizeResults(detections, displaySize);
            faceapi.draw.drawDetections(canvas, resizedDetections);
            faceapi.draw.drawFaceLandmarks(canvas, resizedDetections);
            
            framesWithFace++;
            
            if (framesWithFace > 10) {
                // Ensure they are looking somewhat straight and neutral before capturing
                const descriptor = resizedDetections[0].descriptor;
                
                let currentUser = JSON.parse(localStorage.getItem('currentUser'));
                let users = JSON.parse(localStorage.getItem('users') || '{}');
                let userRecord = users[currentUser.email];
                
                userRecord.faceDescriptor = Array.from(descriptor);
                users[currentUser.email] = userRecord;
                localStorage.setItem('users', JSON.stringify(users));
                
                currentUser.faceDescriptor = userRecord.faceDescriptor;
                localStorage.setItem('currentUser', JSON.stringify(currentUser));
                
                document.getElementById('statusBadge').textContent = t('face_enrolled');
                document.getElementById('statusBadge').className = 'status-badge status-success';
                document.getElementById('statusBadge').classList.remove('hidden');
                
                stopCamera();
                setTimeout(() => {
                    window.location.href = 'dashboard.html';
                }, 1500);
                return;
            }
        } else {
            framesWithFace = 0;
            if (detections.length > 1) {
                setInstruction(t('multiple_faces'));
            } else {
                setInstruction(t('enroll_instruction'));
            }
        }

        animationFrameId = requestAnimationFrame(detect);
    }
    
    detect();
}

// Auto-initialize based on the page content
document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('loginForm') || document.getElementById('registerForm')) {
        initAuth();
    }
    
    if (document.getElementById('enrollInterface')) {
        const checkFaceApi = setInterval(() => {
            if (typeof faceapi !== 'undefined') {
                clearInterval(checkFaceApi);
                initEnrollment();
            }
        }, 100);
    }
    
    if (document.getElementById('livenessInterface')) {
        const checkFaceApi = setInterval(() => {
            if (typeof faceapi !== 'undefined') {
                clearInterval(checkFaceApi);
                initDashboard();
            }
        }, 100);
    }
});
