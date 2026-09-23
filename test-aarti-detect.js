/* Self-check for the aarti detection core:  node test-aarti-detect.js
   Fails loudly if circle counting or plate detection breaks. */

const assert = require('assert');
const { createAartiTracker, findThali, fitCircle } = require('./aarti-detect');

// Feed the tracker a synthetic circle and report what it counted.
function circle({ turns, secondsPerTurn, radius = 0.12, fps = 30, cx = 0.5, cy = 0.5, dir = 1, noise = 0 }) {
  const tracker = createAartiTracker();
  const frames = Math.round(turns * secondsPerTurn * fps);
  let fired = 0;
  for (let i = 0; i <= frames; i++) {
    const t = (i / fps) * 1000;
    const a = dir * (i / fps / secondsPerTurn) * Math.PI * 2;
    const jx = noise ? (Math.sin(i * 12.9898) * 43758.5453 % 1) * noise : 0;
    const jy = noise ? (Math.sin(i * 78.233) * 43758.5453 % 1) * noise : 0;
    if (tracker.push(cx + Math.cos(a) * radius + jx, cy + Math.sin(a) * radius + jy, t).revolution) fired++;
  }
  return { counted: tracker.revolutions, fired };
}

// ── circle fit recovers the centre from a partial arc ──
const arc = [];
for (let i = 0; i < 12; i++) {
  const a = (i / 40) * Math.PI * 2; // only 30% of a circle
  arc.push({ x: 0.3 + Math.cos(a) * 0.2, y: 0.6 + Math.sin(a) * 0.2 });
}
const fit = fitCircle(arc);
assert.ok(Math.abs(fit.x - 0.3) < 0.01 && Math.abs(fit.y - 0.6) < 0.01, `bad centre ${JSON.stringify(fit)}`);
assert.ok(Math.abs(fit.r - 0.2) < 0.01, `bad radius ${fit.r}`);
assert.strictEqual(fitCircle([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }]), null, 'straight line must not fit');

// ── revolutions counted exactly, across realistic aarti speeds ──
for (const spt of [1.0, 2.0, 3.5, 5.0]) {
  const { counted, fired } = circle({ turns: 4, secondsPerTurn: spt });
  assert.strictEqual(counted, 4, `${spt}s/turn counted ${counted}, expected 4`);
  assert.strictEqual(fired, 4, `${spt}s/turn fired ${fired} events, expected 4`);
}

// ── counts either direction (anticlockwise is still a full circle) ──
assert.strictEqual(circle({ turns: 3, secondsPerTurn: 2, dir: -1 }).counted, 3, 'anticlockwise miscounted');

// ── small and large circles both count ──
assert.strictEqual(circle({ turns: 3, secondsPerTurn: 2, radius: 0.05 }).counted, 3, 'small circle miscounted');
assert.strictEqual(circle({ turns: 3, secondsPerTurn: 2, radius: 0.28 }).counted, 3, 'large circle miscounted');

// ── shaky hand survives noise ──
assert.strictEqual(circle({ turns: 3, secondsPerTurn: 2, noise: 0.012 }).counted, 3, 'noisy circle miscounted');

// ── things that are NOT an aarti must never score ──
const tremor = createAartiTracker();
for (let i = 0; i <= 200; i++) {
  tremor.push(0.5 + Math.sin(i * 0.9) * 0.008, 0.5 + Math.cos(i * 1.7) * 0.008, (i / 30) * 1000);
}
assert.strictEqual(tremor.revolutions, 0, 'hand tremor counted as aarti');

const swipe = createAartiTracker();
for (let i = 0; i <= 200; i++) {
  swipe.push(0.2 + (Math.abs((i % 60) - 30) / 30) * 0.5, 0.5, (i / 30) * 1000); // side to side
}
assert.strictEqual(swipe.revolutions, 0, 'straight swipe counted as aarti');

const still = createAartiTracker();
for (let i = 0; i <= 200; i++) still.push(0.5, 0.5, (i / 30) * 1000);
assert.strictEqual(still.revolutions, 0, 'still hand counted as aarti');

// ── a reversal part-way round resets the arc instead of completing it ──
const flip = createAartiTracker();
let flipped = false;
for (let i = 0; i <= 110; i++) {
  const step = i <= 55 ? i : 55 - (i - 55); // out to 0.9 turn, then back
  const a = (step / 60) * Math.PI * 2;
  if (flip.push(0.5 + Math.cos(a) * 0.12, 0.5 + Math.sin(a) * 0.12, (i / 30) * 1000).revolution) flipped = true;
}
assert.ok(!flipped && flip.revolutions === 0, 'reversal wrongly completed a circle');

// ── pausing mid-circle drops the stale arc ──
const paused = createAartiTracker();
for (let i = 0; i <= 40; i++) {
  const a = (i / 60) * Math.PI * 2;
  paused.push(0.5 + Math.cos(a) * 0.12, 0.5 + Math.sin(a) * 0.12, (i / 30) * 1000);
}
for (let i = 0; i <= 40; i++) {
  const a = (40 / 60) * Math.PI * 2 + (i / 60) * Math.PI * 2;
  paused.push(0.5 + Math.cos(a) * 0.12, 0.5 + Math.sin(a) * 0.12, 60000 + (i / 30) * 1000); // 60s later
}
assert.strictEqual(paused.revolutions, 0, 'arc survived a long pause');

// ── `speed` drives the steadiness score, which divides by its mean ──
// A constant-speed circle must therefore report a near-constant speed. The
// cumulative `sweep` would not: it ramps 0→2π and resets, and a raw per-frame
// delta spikes on the frame that back-fills the buffer.
function speedsFor(secondsPerTurn) {
  const out = [];
  const tr = createAartiTracker();
  for (let i = 0; i <= 30 * secondsPerTurn * 3; i++) {
    const a = (i / 30 / secondsPerTurn) * Math.PI * 2;
    const r = tr.push(0.5 + Math.cos(a) * 0.12, 0.5 + Math.sin(a) * 0.12, (i / 30) * 1000);
    if (r.speed) out.push(Math.abs(r.speed));
  }
  return out;
}
function cv(xs) {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return { mean: m, cv: Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length) / m };
}

const steady = speedsFor(2);
assert.ok(steady.length > 100, `expected a speed most frames, got ${steady.length}`);
const s2 = cv(steady);
assert.ok(s2.cv < 0.05, `steady circling should give even speed, got cv=${s2.cv.toFixed(3)}`);
// One turn per 2s = π rad/s.
assert.ok(Math.abs(s2.mean - Math.PI) < 0.05, `speed magnitude off: ${s2.mean}`);
// Half the speed at half the rate — the measure is time-based, not frame-based.
assert.ok(Math.abs(cv(speedsFor(4)).mean - Math.PI / 2) < 0.05, 'speed did not scale with rate');

// Uneven circling must score a visibly worse spread than steady circling.
const jerky = [];
const jt = createAartiTracker();
let ang = 0;
for (let i = 0; i <= 200; i++) {
  ang += (i % 8 < 4 ? 0.035 : 0.17); // lurch, pause, lurch
  const r = jt.push(0.5 + Math.cos(ang) * 0.12, 0.5 + Math.sin(ang) * 0.12, (i / 30) * 1000);
  if (r.speed) jerky.push(Math.abs(r.speed));
}
assert.ok(cv(jerky).cv > s2.cv * 3, 'jerky circling should spread more than steady');

// ── thali detection ──
const W = 160, H = 120;
function frame(paint) {
  const px = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) { // dim room
    px[i * 4] = 40; px[i * 4 + 1] = 35; px[i * 4 + 2] = 30; px[i * 4 + 3] = 255;
  }
  paint(px);
  return px;
}
const palm = { x: 0.5, y: 0.5, scale: 0.12 };

const steel = frame((px) => {
  for (let y = 48; y < 72; y++) for (let x = 68; x < 92; x++) {
    const i = (y * W + x) * 4;
    px[i] = 235; px[i + 1] = 233; px[i + 2] = 230;
  }
});
const steelHit = findThali(steel, W, H, palm);
assert.ok(steelHit.found, 'steel thali missed');
assert.ok(Math.abs(steelHit.x - 0.5) < 0.05 && Math.abs(steelHit.y - 0.5) < 0.05, 'steel thali mislocated');

const brass = frame((px) => {
  for (let y = 48; y < 72; y++) for (let x = 68; x < 92; x++) {
    const i = (y * W + x) * 4;
    px[i] = 220; px[i + 1] = 150; px[i + 2] = 40; // warm brass + diya glow
  }
});
assert.ok(findThali(brass, W, H, palm).found, 'brass thali missed');

assert.ok(!findThali(frame(() => {}), W, H, palm).found, 'empty frame reported a thali');

// A bright lamp in the corner is outside the palm ROI and must be ignored.
const lamp = frame((px) => {
  for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) {
    const i = (y * W + x) * 4;
    px[i] = 250; px[i + 1] = 250; px[i + 2] = 250;
  }
});
assert.ok(!findThali(lamp, W, H, palm).found, 'background light mistaken for a thali');

console.log('aarti-detect: all checks passed');
