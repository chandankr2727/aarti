/* ═══════════════════════════════════════════════════════════════
   AARTI DETECTION CORE — pure logic, no DOM.

   Two jobs:
     1. findThali()      — locate the aarti plate in the webcam frame
     2. createAartiTracker() — turn a stream of plate positions into
                               completed clockwise parikrama (circles)

   Kept DOM-free on purpose so `node test-aarti-detect.js` can drive it
   with synthetic input. All coordinates are normalised 0..1 (same space
   MediaPipe hands reports in), y pointing down.
═══════════════════════════════════════════════════════════════ */

// ───────────────────────────────────────────────────────────────
// 1. CIRCLE FIT (Kåsa, algebraic least squares)
//
// A rolling mean of recent points is NOT a usable circle centre: when the
// user circles slowly the window only holds a partial arc and the mean sits
// on the arc, not at its centre, which makes the measured angle sweep far
// too fast and over-counts revolutions. A least-squares fit recovers the
// true centre from any arc, so slow and fast aarti both count correctly.
// ───────────────────────────────────────────────────────────────
function fitCircle(pts) {
  const n = pts.length;
  if (n < 3) return null;

  let mx = 0, my = 0;
  for (const p of pts) { mx += p.x; my += p.y; }
  mx /= n; my /= n;

  let Suu = 0, Svv = 0, Suv = 0, Suuu = 0, Svvv = 0, Suvv = 0, Svuu = 0;
  for (const p of pts) {
    const u = p.x - mx, v = p.y - my;
    Suu += u * u;
    Svv += v * v;
    Suv += u * v;
    Suuu += u * u * u;
    Svvv += v * v * v;
    Suvv += u * v * v;
    Svuu += v * u * u;
  }

  const det = Suu * Svv - Suv * Suv;
  // Collinear (a straight swipe) — no meaningful centre exists.
  if (Math.abs(det) < 1e-12) return null;

  const c1 = 0.5 * (Suuu + Suvv);
  const c2 = 0.5 * (Svvv + Svuu);

  const uc = (c1 * Svv - c2 * Suv) / det;
  const vc = (c2 * Suu - c1 * Suv) / det;

  return {
    x: mx + uc,
    y: my + vc,
    r: Math.sqrt(Math.max(0, uc * uc + vc * vc + (Suu + Svv) / n)),
  };
}

// ───────────────────────────────────────────────────────────────
// 2. PARIKRAMA TRACKER
//
// Feed it the thali position every frame; it reports when a full circle
// closes. Sweep accumulates signed angle around the fitted centre and a
// revolution fires every 2π.
// ───────────────────────────────────────────────────────────────
function createAartiTracker(opts = {}) {
  const {
    minRadius = 0.030,   // tighter than this is hand tremor, not an aarti
    maxRadius = 0.60,    // wider than the frame — a bad fit, ignore it
    windowMs = 3000,     // history used for the circle fit
    minPoints = 8,       // fewer points than this cannot define a circle
    maxStepRad = 1.2,    // >68° in one frame = tracking jump, not motion
    reverseTolerance = 1.0, // backward sweep allowed before the arc resets
    idleMs = 1000,       // no usable motion this long → start a fresh arc
  } = opts;

  let pts = [];
  let sweep = 0;         // signed radians accumulated in the current arc
  let backtrack = 0;     // radians travelled against the arc's direction
  let revolutions = 0;
  let lastMoveAt = 0;
  let lastIntegratedT = -1; // newest buffered point already folded into sweep
  let direction = 0;
  let centre = null;

  // Angle of a point about the fitted centre, or null when it sits so close
  // to the centre that the angle is just noise.
  function angleAt(p, fit) {
    const dx = p.x - fit.x, dy = p.y - fit.y;
    if (Math.hypot(dx, dy) < minRadius) return null;
    return Math.atan2(dy, dx);
  }

  // Start a fresh arc. The buffer goes too, otherwise the next fit would
  // re-integrate the motion we just decided to discard.
  function resetArc(keep) {
    sweep = 0;
    backtrack = 0;
    direction = 0;
    pts = keep ? [keep] : [];
    lastIntegratedT = keep ? keep.t : -1;
  }

  function result(t, extra) {
    return Object.assign({
      revolution: false,
      completed: 0,
      revolutions,
      delta: 0,   // radians advanced on this frame
      speed: 0,   // radians per second — delta over the time it actually covered
      sweep,
      progress: Math.min(1, Math.abs(sweep) / (Math.PI * 2)),
      radius: 0,
      direction,
      moving: false,
      centre,
      t,
    }, extra);
  }

  return {
    get revolutions() { return revolutions; },

    reset() {
      revolutions = 0;
      centre = null;
      lastMoveAt = 0;
      resetArc(null);
    },

    /**
     * @param {number} x normalised 0..1
     * @param {number} y normalised 0..1
     * @param {number} t timestamp in ms
     */
    push(x, y, t) {
      const point = { x, y, t };

      // Stopped for a while? Whatever arc was in flight is abandoned.
      if (lastMoveAt && t - lastMoveAt > idleMs) {
        resetArc(point);
        lastMoveAt = 0;
        return result(t);
      }

      pts.push(point);
      while (pts.length && t - pts[0].t > windowMs) pts.shift();
      if (pts.length < minPoints) return result(t);

      const fit = fitCircle(pts);
      if (!fit || fit.r > maxRadius) return result(t);
      centre = { x: fit.x, y: fit.y };

      const radius = Math.hypot(x - fit.x, y - fit.y);

      // Integrate every buffered point not yet accounted for — not just the
      // newest one. On the first usable fit that back-fills the frames spent
      // waiting for enough history, so the opening circle counts in full.
      let i = 0;
      while (i < pts.length && pts[i].t <= lastIntegratedT) i++;
      let prev = i > 0 ? pts[i - 1] : pts[0];
      if (i === 0) i = 1;

      let prevAngle = angleAt(prev, fit);
      let completed = 0;
      let frameDelta = 0;
      let reset = false;
      // The first usable fit integrates the whole buffer at once, so a plain
      // per-frame delta would spike there. Dividing by the span actually
      // covered keeps the reported speed comparable on every frame.
      const spanFrom = prev.t;

      for (; i < pts.length; i++) {
        const angle = angleAt(pts[i], fit);
        lastIntegratedT = pts[i].t;

        if (prevAngle === null || angle === null) {
          prevAngle = angle;
          continue;
        }

        let delta = angle - prevAngle;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        prevAngle = angle;

        if (Math.abs(delta) > maxStepRad) continue; // tracking jump
        if (delta === 0) continue;

        lastMoveAt = pts[i].t;
        direction = Math.sign(delta);

        // Wobble is forgiven; a sustained reversal abandons the arc.
        if (sweep !== 0 && Math.sign(delta) !== Math.sign(sweep)) {
          backtrack += Math.abs(delta);
          if (backtrack > reverseTolerance) {
            resetArc(pts[pts.length - 1]);
            reset = true;
            break;
          }
        } else {
          backtrack = 0;
        }

        sweep += delta;
        frameDelta += delta;

        // EPS absorbs the float drift of summing hundreds of small deltas —
        // without it a circle can land a rounding error short of 2π and the
        // revolution silently never fires.
        while (Math.abs(sweep) >= Math.PI * 2 - 1e-9) {
          revolutions++;
          completed++;
          sweep -= Math.sign(sweep) * Math.PI * 2;
        }
      }

      const spanMs = lastIntegratedT - spanFrom;

      return result(t, {
        revolution: completed > 0,
        completed,
        delta: frameDelta,
        speed: spanMs > 0 ? frameDelta / (spanMs / 1000) : 0,
        sweep,
        progress: Math.min(1, Math.abs(sweep) / (Math.PI * 2)),
        radius,
        // +1 is clockwise on screen (y grows downward), which is the
        // traditional direction once the mirrored preview is accounted for.
        direction,
        moving: !reset && radius >= minRadius,
        centre,
      });
    },
  };
}

// ───────────────────────────────────────────────────────────────
// 3. THALI (AARTI PLATE) DETECTION
//
// ponytail: colour/brightness heuristic, not an object detector. A thali is
// either polished steel (bright + colourless) or brass with a lit diya
// (bright + warm hue), and it is always in the hand — so we only score
// pixels in a box around the palm, which kills most false positives.
// Ceiling: struggles under coloured stage lighting or against a bright
// window. Upgrade path: swap this one function for a TFJS object detector,
// the return shape is all the caller depends on.
// ───────────────────────────────────────────────────────────────
function findThali(pixels, width, height, palm, opts = {}) {
  const {
    boxScale = 3.2,      // ROI size as a multiple of palm length
    step = 2,            // pixel stride — 2 is plenty at 320×240
    minCoverage = 0.10,  // fraction of ROI that must look like metal
  } = opts;

  const empty = { found: false, x: palm.x, y: palm.y, radius: 0, confidence: 0 };
  if (!pixels || !palm) return empty;

  const half = Math.max(12, palm.scale * boxScale * width * 0.5);
  const cx = palm.x * width;
  const cy = palm.y * height;

  const x0 = Math.max(0, Math.floor(cx - half));
  const x1 = Math.min(width - 1, Math.ceil(cx + half));
  const y0 = Math.max(0, Math.floor(cy - half));
  const y1 = Math.min(height - 1, Math.ceil(cy + half));
  if (x1 <= x0 || y1 <= y0) return empty;

  let hits = 0, total = 0;
  let sumX = 0, sumY = 0, sumXX = 0, sumYY = 0;

  for (let y = y0; y <= y1; y += step) {
    for (let x = x0; x <= x1; x += step) {
      const i = (y * width + x) * 4;
      const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
      total++;

      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const v = max / 255;
      const s = max === 0 ? 0 : (max - min) / max;

      // Steel / silver thali: bright and nearly colourless.
      const metal = v > 0.70 && s < 0.22;
      // Brass thali or the diya flame: bright and warm (red ≥ green > blue).
      const warm = v > 0.62 && s > 0.28 && r >= g && g > b;

      if (metal || warm) {
        hits++;
        sumX += x; sumY += y;
        sumXX += x * x; sumYY += y * y;
      }
    }
  }

  if (!total || hits / total < minCoverage) return empty;

  const mx = sumX / hits;
  const my = sumY / hits;
  // Spread of the blob doubles as its radius — a tight cluster is a small
  // plate, a wide one is a large thali held close to the lens.
  const spread = Math.sqrt(
    Math.max(0, sumXX / hits - mx * mx) + Math.max(0, sumYY / hits - my * my)
  );

  return {
    found: true,
    x: mx / width,
    y: my / height,
    radius: (spread * 1.6) / width,
    confidence: Math.min(1, (hits / total) / 0.35),
  };
}

// Browser global + node require, same file either way.
if (typeof window !== 'undefined') {
  window.AartiDetect = { fitCircle, createAartiTracker, findThali };
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { fitCircle, createAartiTracker, findThali };
}
