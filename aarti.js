/* ═══════════════════════════════════════════════════════════════
   माँ दुर्गा की आरती · जय अम्बे गौरी

   The camera finds the aarti thali in the devotee's hand; circling it
   drives the plate around its orbit before the pratima, and each complete
   circle is one parikrama. Eleven complete the aarti.

   Detection maths lives in aarti-detect.js (DOM-free, covered by
   test-aarti-detect.js). All rendering lives in scene3d.js (three.js).
   This file is state, input, sound and interface.
═══════════════════════════════════════════════════════════════ */

import Scene3D from './scene3d.js';

// ═══════════════════════════════════════════════════════════════
// 1.  CONFIG & STATE
// ═══════════════════════════════════════════════════════════════
const TOTAL_PARIKRAMA = 11;
const AartiDetect = window.AartiDetect;

// Low-end devices get a lighter renderer, a lighter hand model and no face
// tracking. `?quality=low|high` overrides the guess.
// ponytail: heuristic from core count / memory; Scene3D.adapt() corrects
// at runtime by measuring real frame times, so a wrong guess self-heals.
const TIER = (() => {
  const q = new URLSearchParams(location.search).get('quality');
  if (q === 'low' || q === 'high') return q;
  const cores = navigator.hardwareConcurrency || 8;
  const mem = navigator.deviceMemory || 8;
  const mobile = /Android|iPhone|iPad|iPod|Mobi/i.test(navigator.userAgent);
  return cores <= 4 || mem <= 4 || (mobile && cores <= 6) ? 'low' : 'high';
})();

const STATE = {
  started: false,
  finished: false,
  cameraReady: false,
  usingCamera: false,
  parikrama: 0,
  progress: 0,          // 0..1 within the current circle
  startTime: 0,
  thaliFound: false,
  handSeen: false,
  glow: 0,
  muted: false,
  // Plate's position on its orbit. Starts at the bottom of the circle,
  // where an aarti traditionally begins.
  orbitAngle: Math.PI / 2,
  offerings: 0,
  name: '',
  wish: '',
};

// Rising-edge state for the two-palm pushpanjali gesture.
const gesture = { palmsOpen: false, lastOfferAt: 0 };

const tracker = AartiDetect.createAartiTracker();

// Thali position in *mirrored* space — the frame the devotee sees.
const thali = { x: 0.5, y: 0.5, active: false };

// Devanagari digits: ३ / ११, not 3 / 11.
const devaFmt = new Intl.NumberFormat('hi-IN-u-nu-deva');
const deva = (n) => devaFmt.format(n);

// ═══════════════════════════════════════════════════════════════
// 2.  DOM
// ═══════════════════════════════════════════════════════════════
const $ = (id) => document.getElementById(id);

const webcamEl = $('webcam');
const motionCanvas = $('motionCanvas');
const sceneCanvas = $('sceneCanvas');
const previewCanvas = $('cameraPreviewCanvas');

const mCtx = motionCanvas.getContext('2d', { willReadFrequently: true });
const vCtx = previewCanvas.getContext('2d');

const startScreen = $('startScreen');
const beginBtn = $('beginBtn');
const idolStatus = $('idolStatus');
const cameraStatus = $('cameraStatus');
const cameraWidget = $('cameraWidget');
const cameraWidgetDot = $('cameraWidgetDot');

const hintEl = $('hint');
const parikramaValue = $('parikramaValue');
const ringProgress = $('ringProgress');
const ringPips = $('ringPips');
const lyricsLine = $('lyricsLine');
const verseCounter = $('verseCounter');
const blessing = $('blessing');
const bells = document.querySelectorAll('.temple-bell');

let W = window.innerWidth;
let H = window.innerHeight;

function onResize() {
  W = window.innerWidth;
  H = window.innerHeight;
  motionCanvas.width = 320;
  motionCanvas.height = 240;
  Scene3D.resize();
}
window.addEventListener('resize', onResize);

// ═══════════════════════════════════════════════════════════════
// 3.  SOUND — a soft bell and a soft drum, nothing continuous.
//     Synthesised; there are no audio files.
// ═══════════════════════════════════════════════════════════════
let audioCtx = null;
let masterGain = null;

function initAudio() {
  if (audioCtx) return;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = STATE.muted ? 0 : 0.5;
    masterGain.connect(audioCtx.destination);
  } catch (err) {
    console.warn('Audio unavailable:', err);
  }
}

// Temple ghanti — inharmonic partials, gentle attack, long decay.
function playBell(strength = 1, at = 0) {
  if (!audioCtx || STATE.muted) return;
  const now = audioCtx.currentTime + at;
  const base = 540 + Math.random() * 30;

  [1, 2.76, 5.4].forEach((ratio, i) => {
    const osc = audioCtx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = base * ratio;

    const g = audioCtx.createGain();
    const peak = (0.11 / (i + 1)) * strength;
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(peak, now + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 3.2 / (i * 0.6 + 1));

    osc.connect(g).connect(masterGain);
    osc.start(now);
    osc.stop(now + 3.4);
  });
}

// One soft dholak thump — a falling low sine.
function playDrum(strength = 1, at = 0) {
  if (!audioCtx || STATE.muted) return;
  const now = audioCtx.currentTime + at;
  const osc = audioCtx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(120, now);
  osc.frequency.exponentialRampToValueAtTime(58, now + 0.28);

  const g = audioCtx.createGain();
  g.gain.setValueAtTime(0, now);
  g.gain.linearRampToValueAtTime(0.16 * strength, now + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);

  osc.connect(g).connect(masterGain);
  osc.start(now);
  osc.stop(now + 0.45);
}

// ═══════════════════════════════════════════════════════════════
// 4.  CAMERA + MEDIAPIPE
// ═══════════════════════════════════════════════════════════════
let mpHands = null;
let mpFace = null;
let frameNo = 0;

function setCameraStatus(text, cls) {
  cameraStatus.textContent = text;
  cameraStatus.className = cls || '';
}

async function initCamera() {
  try {
    mpHands = new Hands({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
    });
    mpHands.setOptions({
      maxNumHands: 2,
      // The lite model is several times cheaper and still finds a palm
      // reliably; weak devices need that headroom for the 3D scene.
      modelComplexity: TIER === 'low' ? 0 : 1,
      // A hand gripping a thali is a less "hand-like" shape, so a high
      // confidence floor would drop it out of results entirely.
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    mpHands.onResults(onHandsResults);

    // Head-tracked parallax. Skipped on low-end devices: a second
    // MediaPipe graph is more CPU than the effect is worth there.
    if (TIER !== 'low') {
      try {
        mpFace = new FaceDetection({
          locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_detection/${file}`,
        });
        mpFace.setOptions({ model: 'short', minDetectionConfidence: 0.5 });
        mpFace.onResults(onFaceResults);
      } catch (err) {
        console.warn('Face detection unavailable, parallax disabled:', err);
        mpFace = null;
      }
    }

    const mpCamera = new Camera(webcamEl, {
      onFrame: async () => {
        if (!STATE.cameraReady && webcamEl.videoWidth > 0) {
          STATE.cameraReady = true;
          STATE.usingCamera = true;
          setCameraStatus('कैमरा तैयार', 'ready');
          cameraWidgetDot.classList.remove('no-signal');

          if (window.RathLogger) {
            window.RathLogger.log('Aarti Detection', `Webcam active, MediaPipe Hands loaded (tier: ${TIER}).`, 'info');
            const recordingEnabled = localStorage.getItem('aarti_video_recording_enabled') !== 'false';
            if (recordingEnabled && previewCanvas) {
              window.RathLogger.startRecording(previewCanvas.captureStream(20));
            }
          }
        }
        // Hands only matter once the aarti is under way; skipping them on
        // the start screen keeps the opening smooth.
        if (STATE.started && !STATE.finished) await mpHands.send({ image: webcamEl });
        if (mpFace && (frameNo++ % 3 === 0)) await mpFace.send({ image: webcamEl });
      },
      width: 320,
      height: 240,
    });

    mpCamera.start();

    // start() resolves even when the permission prompt is never answered,
    // so without this the start screen would sit on "getting ready" forever.
    setTimeout(() => {
      if (!STATE.cameraReady) cameraUnavailable('camera permission not granted in time');
    }, 9000);
  } catch (err) {
    cameraUnavailable(err.message || err);
  }
}

function cameraUnavailable(reason) {
  STATE.cameraReady = false;
  STATE.usingCamera = false;
  setCameraStatus('कैमरा नहीं मिला — माउस या उँगली से आरती कर सकते हैं', 'warn');
  cameraWidgetDot.classList.add('no-signal');
  if (window.RathLogger) {
    window.RathLogger.log('Aarti Detection', 'Camera unavailable: ' + reason, 'warning');
  }
}

function onHandsResults(results) {
  // Raw (unmirrored) frame into the analysis buffer, so pixel coordinates
  // line up with the landmark coordinates MediaPipe reports.
  mCtx.drawImage(results.image, 0, 0, 320, 240);

  const hands = results.multiHandLandmarks;
  STATE.handSeen = !!(hands && hands.length);

  let plate = null;
  let palm = null;

  if (STATE.handSeen) {
    // Prefer the higher hand — the one lifting the thali.
    const hand = hands.slice().sort((a, b) => a[9].y - b[9].y)[0];
    palm = {
      x: (hand[0].x + hand[9].x) / 2,
      y: (hand[0].y + hand[9].y) / 2,
      scale: Math.max(0.04, Math.hypot(hand[9].x - hand[0].x, hand[9].y - hand[0].y)),
    };

    let pixels = null;
    try {
      pixels = mCtx.getImageData(0, 0, 320, 240).data;
    } catch (_) { /* tainted canvas — fall back to the palm */ }

    plate = pixels ? AartiDetect.findThali(pixels, 320, 240, palm) : null;
  }

  checkPushpanjali(hands, performance.now());
  updateThali(plate, palm);
  drawCameraPreview(results.image, plate);
}

// ── Head-tracked parallax ──
// The camera answers the devotee's head, so the pandal behaves like an
// alcove seen through the screen instead of a picture of one.
function onFaceResults(res) {
  const det = res.detections && res.detections[0];
  if (!det) {
    Scene3D.setViewer(0, 0, 0);
    return;
  }
  const bb = det.boundingBox;
  // The webcam image is not mirrored, so moving right lowers xCenter. The
  // camera must travel the same way the head does, hence (0.5 - centre).
  const hx = (0.5 - bb.xCenter) * 2.2;
  const hy = (0.5 - bb.yCenter) * 1.8;
  // Apparent face width stands in for distance: leaning in moves you in.
  const near = (bb.width - 0.15) / 0.16;
  Scene3D.setViewer(hx, hy, near);
}

// ── Pushpanjali ──
// A finger counts as extended when its tip is further from the wrist than
// its middle joint — robust to hand size, rotation and distance.
function isOpenPalm(lm) {
  const wrist = lm[0];
  const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  let extended = 0;
  for (const [tip, pip] of [[8, 6], [12, 10], [16, 14], [20, 18]]) {
    if (d(lm[tip], wrist) > d(lm[pip], wrist) * 1.18) extended++;
  }
  return extended >= 3;
}

function checkPushpanjali(hands, now) {
  const open = !!(hands && hands.length >= 2 && hands.every(isOpenPalm));
  // Fire on the rising edge only, so holding your palms up does not pour
  // flowers continuously.
  if (open && !gesture.palmsOpen && now - gesture.lastOfferAt > 900) {
    gesture.lastOfferAt = now;
    offerFlowers();
  }
  gesture.palmsOpen = open;
}

function offerFlowers() {
  if (!STATE.started || STATE.finished) return;
  STATE.offerings++;
  Scene3D.pushpanjali();
  playBell(0.45);
  showHint('पुष्पांजलि अर्पित', '', 1800);

  if (window.RathLogger) {
    window.RathLogger.log('Aarti Detection', `Pushpanjali offered (${STATE.offerings}).`, 'info');
  }
}

function updateThali(plate, palm) {
  STATE.thaliFound = !!(plate && plate.found);

  const source = STATE.thaliFound ? plate : palm;
  if (!source) {
    thali.active = false;
    updateHint(null);
    return;
  }

  thali.active = true;
  // Mirror X: everything downstream works in the frame the devotee sees.
  thali.x += ((1 - source.x) - thali.x) * 0.45;
  thali.y += (source.y - thali.y) * 0.45;

  if (STATE.started && !STATE.finished) feedTracker(thali.x, thali.y, performance.now());
}

// ═══════════════════════════════════════════════════════════════
// 5.  AARTI PROGRESS
// ═══════════════════════════════════════════════════════════════
function feedTracker(x, y, t) {
  const res = tracker.push(x, y, t);

  STATE.progress = res.progress;
  // The plate's orbit angle advances by exactly the angle the hand swept,
  // so the plate tracks the devotee's circling one-to-one.
  if (res.delta) STATE.orbitAngle += res.delta;

  for (let i = 0; i < res.completed; i++) onParikramaComplete();

  updateHint(res);
  updateHud();
}

function onParikramaComplete() {
  STATE.parikrama = Math.min(TOTAL_PARIKRAMA, tracker.revolutions);

  playBell(0.8);
  playDrum(1);
  ringBells();
  Scene3D.pulse();

  if (window.RathLogger) {
    window.RathLogger.log('Aarti Detection', `Parikrama ${STATE.parikrama}/${TOTAL_PARIKRAMA} completed.`, 'info');
  }

  if (STATE.parikrama >= TOTAL_PARIKRAMA && !STATE.finished) completeAarti();
  else showVerse(STATE.parikrama);
}

function ringBells() {
  bells.forEach((b) => {
    b.classList.remove('ring');
    void b.getBoundingClientRect(); // restart the CSS animation
    b.classList.add('ring');
  });
}

function updateHud() {
  parikramaValue.textContent = deva(STATE.parikrama);

  const circumference = 2 * Math.PI * 50;
  const shown = Math.min(1, (STATE.parikrama + STATE.progress) / TOTAL_PARIKRAMA);
  ringProgress.style.strokeDasharray = `${circumference}`;
  ringProgress.style.strokeDashoffset = `${circumference * (1 - shown)}`;

  [...ringPips.children].forEach((pip, i) => pip.classList.toggle('lit', i < STATE.parikrama));
}

// ── Guidance ──
// Speaks only when something needs doing; while the aarti flows, it leaves.
let hintHoldUntil = 0;
let hintShown = '';

function showHint(text, tone = '', holdMs = 0) {
  if (holdMs) hintHoldUntil = performance.now() + holdMs;
  const key = text + '|' + tone;
  if (key === hintShown) return;           // no DOM writes on unchanged frames
  hintShown = key;
  if (text) hintEl.textContent = text;
  hintEl.className = (text ? 'show ' : '') + tone;
}

function updateHint(res) {
  cameraWidgetDot.className = !STATE.usingCamera ? 'no-signal'
    : STATE.thaliFound ? '' : STATE.handSeen ? 'searching' : 'no-signal';

  if (!STATE.started || STATE.finished) return;
  if (performance.now() < hintHoldUntil) return;

  const moving = res && res.moving;
  if (!STATE.usingCamera) {
    showHint(moving ? '' : 'माउस या उँगली से धीरे-धीरे गोल घुमाएँ');
  } else if (!STATE.handSeen) {
    showHint('थाली लेकर कैमरे के सामने आइए', 'warn');
  } else if (!moving) {
    showHint(STATE.thaliFound ? 'धीरे-धीरे गोल घुमाना आरंभ करें' : 'थाली या दीपक हाथ में लेकर गोल घुमाएँ');
  } else if (res.direction < 0) {
    showHint('घड़ी की दिशा में घुमाएँ', 'warn');
  } else {
    showHint('');
  }
}

// ═══════════════════════════════════════════════════════════════
// 6.  AARTI — जय अम्बे गौरी
//     One pad per parikrama; "कंचन थाल विराजत" — the thali itself —
//     falls on the eleventh. The closing pad plays as the aarti completes.
// ═══════════════════════════════════════════════════════════════
const VERSES = [
  'जय अम्बे गौरी, मैया जय श्यामा गौरी।<br>तुमको निशदिन ध्यावत, हरि ब्रह्मा शिवरी॥',
  'माँग सिंदूर विराजत, टीको मृगमद को।<br>उज्ज्वल से दोउ नैना, चन्द्रवदन नीको॥',
  'कनक समान कलेवर, रक्ताम्बर राजै।<br>रक्तपुष्प गल माला, कण्ठन पर साजै॥',
  'केहरि वाहन राजत, खड्ग खप्पर धारी।<br>सुर-नर-मुनिजन सेवत, तिनके दुखहारी॥',
  'कानन कुण्डल शोभित, नासाग्रे मोती।<br>कोटिक चन्द्र दिवाकर, सम राजत ज्योती॥',
  'शुम्भ-निशुम्भ बिदारे, महिषासुर घाती।<br>धूम्र विलोचन नैना, निशदिन मदमाती॥',
  'चण्ड-मुण्ड संहारे, शोणित बीज हरे।<br>मधु-कैटभ दोउ मारे, सुर भयहीन करे॥',
  'ब्रह्माणी रुद्राणी, तुम कमला रानी।<br>आगम निगम बखानी, तुम शिव पटरानी॥',
  'चौंसठ योगिनी मंगल गावत, नृत्य करत भैरों।<br>बाजत ताल मृदंगा, अरु बाजत डमरू॥',
  'तुम ही जग की माता, तुम ही हो भरता।<br>भक्तन की दुख हरता, सुख सम्पत्ति करता॥',
  'कंचन थाल विराजत, अगर कपूर बाती।<br>श्रीमालकेतु में राजत, कोटि रतन ज्योती॥',
];
const CLOSING = 'श्री अम्बेजी की आरती, जो कोई नर गावै।<br>कहत शिवानन्द स्वामी, सुख सम्पत्ति पावै॥';

let verseTimer = 0;
function setLyrics(html, counter) {
  clearTimeout(verseTimer);
  lyricsLine.classList.add('out');
  verseTimer = setTimeout(() => {
    lyricsLine.innerHTML = html;
    verseCounter.textContent = counter;
    lyricsLine.classList.remove('out');
  }, 550);
}

// `done` parikrama completed so far → the pad for the round now under way.
function showVerse(done) {
  const i = Math.min(VERSES.length - 1, Math.max(0, done));
  setLyrics(VERSES[i], `${deva(i + 1)} / ${deva(VERSES.length)}`);
}

// ═══════════════════════════════════════════════════════════════
// 7.  CAMERA MIRROR — the devotee's own image, and a soft ring on the
//     thali once it is found. No skeletons, no readouts.
// ═══════════════════════════════════════════════════════════════
function drawCameraPreview(image, plate) {
  vCtx.save();
  vCtx.scale(-1, 1);
  vCtx.drawImage(image, -320, 0, 320, 240);
  vCtx.restore();

  if (plate && plate.found) {
    const px = (1 - plate.x) * 320;
    const py = plate.y * 240;
    const pr = Math.max(14, plate.radius * 320);
    vCtx.strokeStyle = 'rgba(255, 214, 130, 0.9)';
    vCtx.lineWidth = 3;
    vCtx.beginPath();
    vCtx.arc(px, py, pr + 4, -Math.PI / 2, -Math.PI / 2 + Math.max(0.05, STATE.progress) * Math.PI * 2);
    vCtx.stroke();
  }
}

// ═══════════════════════════════════════════════════════════════
// 8.  MAIN LOOP
// ═══════════════════════════════════════════════════════════════
// ponytail: ~30fps cap on low tier; Scene3D scales motion by real dt.
const FRAME_MIN_MS = TIER === 'low' ? 30 : 0;
let lastRender = 0;

function loop(t) {
  requestAnimationFrame(loop);
  if (t - lastRender < FRAME_MIN_MS) return;
  lastRender = t;

  // The pandal brightens as the aarti progresses, from a dim base light.
  const completion = (STATE.parikrama + STATE.progress) / TOTAL_PARIKRAMA;
  const target = STATE.finished ? 1 : 0.10 + Math.min(1, completion) * 0.90;
  STATE.glow += (target - STATE.glow) * 0.04;

  Scene3D.frame(t, {
    glow: STATE.glow,
    parikrama: STATE.parikrama,
    orbitAngle: STATE.orbitAngle,
    thaliVisible: STATE.started && !STATE.finished,
    finished: STATE.finished,
  });
}

// ═══════════════════════════════════════════════════════════════
// 9.  COMPLETION — the blessing
// ═══════════════════════════════════════════════════════════════
const BLESSINGS = [
  'सुख, शान्ति और समृद्धि आपके घर में सदा बनी रहे',
  'आपके सब संकट दूर हों, हर मार्ग मंगलमय हो',
  'आपकी श्रद्धा और भक्ति दिन-दिन बढ़ती रहे',
  'माँ की कृपा आप पर और आपके परिवार पर सदा बनी रहे',
  'आपका जीवन माँ की ज्योति से सदा प्रकाशित रहे',
];

function ordinal(n) {
  return { 1: 'पहली', 2: 'दूसरी', 3: 'तीसरी', 4: 'चौथी', 6: 'छठी' }[n] || `${deva(n)}वीं`;
}

function durationText(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m ? `${deva(m)} मिनट ${deva(s)} सेकंड` : `${deva(s)} सेकंड`;
}

let finaleTimers = [];

function completeAarti() {
  STATE.finished = true;
  const seconds = Math.round((Date.now() - STATE.startTime) / 1000);
  const count = Number(localStorage.getItem('aarti_count') || 0) + 1;
  localStorage.setItem('aarti_count', String(count));

  document.body.classList.remove('playing');
  document.body.classList.add('finished', 'finale');
  Scene3D.setMode('finale');
  showHint('');
  setLyrics(CLOSING, '');

  // Three bells and a petal shower as the lamps all light.
  playBell(1);
  playDrum(0.9);
  playBell(0.8, 0.9);
  playBell(0.6, 1.8);
  ringBells();
  Scene3D.pulse();
  Scene3D.pushpanjali(2.4);
  finaleTimers.push(setTimeout(() => Scene3D.pushpanjali(2.4), 700));
  finaleTimers.push(setTimeout(() => Scene3D.pushpanjali(2.4), 1400));

  $('blessingName').textContent = STATE.name
    ? `${STATE.name} जी, माँ अम्बे आपकी हर मनोकामना पूर्ण करें`
    : 'माँ अम्बे आपकी हर मनोकामना पूर्ण करें';
  $('blessingText').textContent = STATE.wish
    ? `“${STATE.wish}” — माँ आपकी यह प्रार्थना स्वीकार करें`
    : BLESSINGS[Math.floor(Math.random() * BLESSINGS.length)];
  $('blessingMeta').textContent =
    `${deva(TOTAL_PARIKRAMA)} परिक्रमा · ${durationText(seconds)} · आपकी ${ordinal(count)} आरती`;

  if (window.RathLogger) {
    window.RathLogger.log('Aarti Detection', `Aarti completed: ${STATE.parikrama} parikrama in ${seconds}s.`, 'info');
    window.RathLogger.stopRecording();
  }

  // Let the closing pad and the petals have the screen before the blessing.
  finaleTimers.push(setTimeout(() => {
    document.body.classList.remove('finale');
    blessing.classList.remove('hidden');
  }, 4200));
}

// ── आशीर्वाद चित्र — a keepsake card: the lit pandal, her blessing, the date ──
function wrapText(ctx, text, x, y, maxW, lineH) {
  const words = text.split(' ');
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, y);
      line = w;
      y += lineH;
    } else {
      line = test;
    }
  }
  ctx.fillText(line, x, y);
  return y + lineH;
}

async function saveBlessingCard() {
  await document.fonts.ready;
  const CW = 1080, CH = 1350;
  const c = document.createElement('canvas');
  c.width = CW;
  c.height = CH;
  const ctx = c.getContext('2d');

  // Must be drawn in the same task as snapshot(): the WebGL buffer is only
  // guaranteed until the task ends.
  const src = Scene3D.snapshot();
  const s = Math.max(CW / src.width, CH / src.height);
  const dw = src.width * s, dh = src.height * s;
  ctx.drawImage(src, (CW - dw) / 2, (CH - dh) / 2 - CH * 0.06, dw, dh);

  const fade = ctx.createLinearGradient(0, CH * 0.45, 0, CH);
  fade.addColorStop(0, 'rgba(8,3,5,0)');
  fade.addColorStop(0.45, 'rgba(8,3,5,0.78)');
  fade.addColorStop(1, 'rgba(8,3,5,0.96)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, CW, CH);

  ctx.strokeStyle = 'rgba(232,201,106,0.45)';
  ctx.lineWidth = 2;
  ctx.strokeRect(28, 28, CW - 56, CH - 56);

  ctx.textAlign = 'center';
  ctx.shadowColor = 'rgba(0,0,0,0.8)';
  ctx.shadowBlur = 16;

  ctx.fillStyle = '#E8C96A';
  ctx.font = '34px "Tiro Devanagari Hindi", serif';
  ctx.fillText('॥ आरती सम्पन्न ॥', CW / 2, CH - 440);

  ctx.fillStyle = '#FFE7B0';
  ctx.font = '104px "Tiro Devanagari Hindi", serif';
  ctx.fillText('जय माता दी', CW / 2, CH - 320);

  ctx.fillStyle = '#F6EDDC';
  ctx.font = '40px "Tiro Devanagari Hindi", serif';
  let y = wrapText(ctx, $('blessingName').textContent, CW / 2, CH - 230, CW - 180, 56);

  ctx.fillStyle = '#E8C96A';
  ctx.font = '32px Mukta, sans-serif';
  y = wrapText(ctx, $('blessingText').textContent, CW / 2, y + 6, CW - 200, 46);

  ctx.fillStyle = '#9A8672';
  ctx.font = '26px Mukta, sans-serif';
  const date = new Date().toLocaleDateString('hi-IN-u-nu-deva', { day: 'numeric', month: 'long', year: 'numeric' });
  ctx.fillText(date, CW / 2, Math.max(y + 16, CH - 70));

  c.toBlob(async (blob) => {
    if (!blob) return;
    const file = new File([blob], 'maa-ambe-aashirwad.jpg', { type: 'image/jpeg' });
    // Phones: the share sheet (WhatsApp etc.). Desktop: a download.
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'जय माँ अम्बे' });
        return;
      } catch (err) {
        if (err.name === 'AbortError') return;
      }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }, 'image/jpeg', 0.92);
}

// ── दर्शन — every piece of chrome steps aside; touch anywhere to return ──
function enterDarshan() {
  document.body.classList.add('darshan');
  // Deferred so the click that opened darshan does not also close it.
  setTimeout(() => {
    $('stage').addEventListener('pointerdown', () => document.body.classList.remove('darshan'), { once: true });
  }, 300);
}

// ═══════════════════════════════════════════════════════════════
// 10.  START / RESET
// ═══════════════════════════════════════════════════════════════
let startToken = 0;

function startAarti() {
  initAudio();
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();

  STATE.name = $('devoteeName').value.trim();
  STATE.wish = $('devoteeWish').value.trim();
  localStorage.setItem('aarti_name', STATE.name);

  // Sankalp: a moment of stillness while the camera walks up to her.
  $('sankalpLine').innerHTML = STATE.name
    ? `${escapeHtml(STATE.name)} जी की ओर से<br>माँ अम्बे को सादर आरती अर्पित`
    : 'श्रद्धा भाव से<br>माँ अम्बे को सादर आरती अर्पित';
  startScreen.classList.add('fade-out');
  $('sankalpMoment').classList.add('show');
  Scene3D.setMode('aarti');
  playBell(0.6);

  const token = ++startToken;
  setTimeout(() => {
    if (token !== startToken) return;       // restarted during the pause
    startScreen.style.display = 'none';
    $('sankalpMoment').classList.remove('show');

    clearRound(true);
    document.body.classList.add('playing');
    if (STATE.cameraReady) cameraWidget.classList.remove('stowed');
    playDrum(0.8);
    updateHint(null);

    if (window.RathLogger) window.RathLogger.log('Aarti Detection', 'Aarti started.', 'info');
  }, 3400);
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

// `running` says whether to carry straight on or drop back to the start screen.
function clearRound(running) {
  finaleTimers.forEach(clearTimeout);
  finaleTimers = [];
  blessing.classList.add('hidden');
  document.body.classList.remove('finished', 'finale', 'darshan');
  tracker.reset();
  STATE.parikrama = 0;
  STATE.progress = 0;
  STATE.finished = false;
  STATE.started = running;
  STATE.startTime = Date.now();
  STATE.orbitAngle = Math.PI / 2;
  STATE.offerings = 0;
  showVerse(0);
  updateHud();
}

function resetAarti() {
  clearRound(true);
  Scene3D.setMode('aarti');
  document.body.classList.add('playing');
  playBell(0.6);
}

function startNewAarti() {
  startToken++;
  clearRound(false);
  showHint('');
  document.body.classList.remove('playing');
  $('sankalpMoment').classList.remove('show');
  startScreen.style.display = '';
  startScreen.classList.remove('fade-out');
  cameraWidget.classList.add('stowed');
  Scene3D.setMode('start');
}

// ═══════════════════════════════════════════════════════════════
// 11.  POINTER FALLBACK — circle with a mouse or finger
// ═══════════════════════════════════════════════════════════════
function enablePointerFallback() {
  const onMove = (clientX, clientY) => {
    if (!STATE.started || STATE.finished) return;
    // If the camera is already supplying a position (thali *or* bare hand),
    // stay out of the way — interleaving two sources would feed the tracker
    // jumps between them and wreck the sweep.
    if (STATE.usingCamera && thali.active) return;
    thali.x = clientX / W;
    thali.y = clientY / H;
    thali.active = true;
    feedTracker(thali.x, thali.y, performance.now());
  };

  window.addEventListener('pointermove', (e) => onMove(e.clientX, e.clientY));
  window.addEventListener('touchmove', (e) => {
    if (e.touches[0]) onMove(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: true });
}

// ═══════════════════════════════════════════════════════════════
// 12.  INIT
// ═══════════════════════════════════════════════════════════════
function buildRingPips() {
  const ns = 'http://www.w3.org/2000/svg';
  for (let i = 0; i < TOTAL_PARIKRAMA; i++) {
    const a = (i / TOTAL_PARIKRAMA) * Math.PI * 2 - Math.PI / 2;
    const pip = document.createElementNS(ns, 'circle');
    pip.setAttribute('cx', 60 + Math.cos(a) * 50);
    pip.setAttribute('cy', 60 + Math.sin(a) * 50);
    pip.setAttribute('r', 3);
    pip.setAttribute('class', 'pip');
    ringPips.appendChild(pip);
  }
}

function toggleMute() {
  STATE.muted = !STATE.muted;
  $('muteIcon').setAttribute('href', STATE.muted ? '#i-mute' : '#i-sound');
  if (audioCtx) masterGain.gain.setTargetAtTime(STATE.muted ? 0 : 0.5, audioCtx.currentTime, 0.2);
}

function toggleFullscreen() {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
  else document.exitFullscreen?.();
}

function ringManualBell() {
  initAudio();
  playBell(1);
  ringBells();
}

(function init() {
  const veilText = $('veilText');
  const veilFill = $('veilFill');

  Scene3D.init(sceneCanvas, {
    tier: TIER,
    // A few MB of pratima should not load in silence.
    onIdolProgress: (frac) => {
      if (frac >= 0) {
        veilFill.style.width = `${Math.round(frac * 100)}%`;
        veilText.textContent = `माँ का आगमन हो रहा है… ${deva(Math.round(frac * 100))}%`;
      }
    },
    onIdolReady: (kind) => {
      veilFill.style.width = '100%';
      beginBtn.disabled = false;
      idolStatus.textContent = kind === 'placeholder' ? 'प्रतिमा अस्थायी रूप में' : 'प्रतिमा विराजमान';
      idolStatus.className = kind === 'placeholder' ? 'warn' : 'ready';
      // Let the first lit frame land before the veil lifts.
      setTimeout(() => document.body.classList.remove('loading'), 400);
    },
  });
  onResize();
  buildRingPips();
  $('parikramaTotal').textContent = `/ ${deva(TOTAL_PARIKRAMA)}`;
  parikramaValue.textContent = deva(0);
  $('devoteeName').value = localStorage.getItem('aarti_name') || '';
  requestAnimationFrame(loop);

  initCamera();
  enablePointerFallback();

  $('sankalpForm').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!beginBtn.disabled) startAarti();
  });
  $('bellBtn').addEventListener('click', ringManualBell);
  $('flowerBtn').addEventListener('click', offerFlowers);
  $('muteBtn').addEventListener('click', toggleMute);
  $('fullscreenBtn').addEventListener('click', toggleFullscreen);
  $('restartBtn').addEventListener('click', startNewAarti);
  $('saveCardBtn').addEventListener('click', saveBlessingCard);
  $('darshanBtn').addEventListener('click', enterDarshan);
  $('againBtn').addEventListener('click', resetAarti);
  $('newBtn').addEventListener('click', startNewAarti);

  document.addEventListener('keydown', (e) => {
    // Typing a name must not mute the sound or ring the bell.
    if (e.target instanceof HTMLInputElement) return;
    if (e.code === 'KeyF') toggleFullscreen();
    if (e.code === 'KeyM') toggleMute();
    if (e.code === 'Space' && STATE.started && !STATE.finished) {
      e.preventDefault();
      ringManualBell();
    }
  });

  showVerse(0);

  /* ═══════════════════════════════════════════════════════════
     FACE SWAP — DISABLED

     The pipeline itself is untouched (../face-swap.js, ../logger.js,
     assets/devotee-*.png); only this wiring and the markup it drives are
     switched off. To bring it back: un-comment the face-swap panel in
     index.html, restore the `../face-swap.js` module tag there, and
     un-comment this block.

  window.RATH_DEFAULT_TARGET = 'assets/devotee-male.png';
  window.RATH_TARGET_IMAGE = 'assets/devotee-male.png';
  window.RATH_PLACEHOLDER_IMAGE = 'assets/placeholder-face.png';

  const genderControls = document.getElementById('genderSelectionControls');
  const startControls = document.getElementById('startSelectionControls');
  const swapDetails = document.getElementById('faceSwapDetails');
  const personImage = document.getElementById('personImage');

  function chooseForm(target, btn) {
    window.RATH_TARGET_IMAGE = target;
    if (personImage) personImage.src = target;
    document.querySelectorAll('.choice-card').forEach((c) => c.classList.remove('selected'));
    btn.classList.add('selected');
    setTimeout(() => {
      genderControls.classList.add('hidden');
      startControls.classList.remove('hidden');
    }, 260);
  }

  document.getElementById('selectMaleBtn').addEventListener('click', (e) =>
    chooseForm('assets/devotee-male.png', e.currentTarget));
  document.getElementById('selectFemaleBtn').addEventListener('click', (e) =>
    chooseForm('assets/devotee-female.png', e.currentTarget));

  document.getElementById('startWithFaceSwapBtn').addEventListener('click', () => {
    startControls.classList.add('hidden');
    swapDetails.classList.remove('hidden');
  });

  document.getElementById('backToSelectionBtn').addEventListener('click', () => {
    if (typeof window.stopCamera === 'function') window.stopCamera();
    swapDetails.classList.add('hidden');
    startControls.classList.remove('hidden');
  });

  document.getElementById('skipFaceSwapBtn').addEventListener('click', () => startAarti());
  ═══════════════════════════════════════════════════════════ */

  console.log(`%c🔱 जय माँ अम्बे — आरती (quality: ${TIER})`,
    'color:#E8C96A;font-size:15px;font-weight:bold;background:#2A0A12;padding:8px 14px;border-radius:6px;');
})();

// The disabled face-swap markup calls this inline.
window.startAarti = startAarti;
