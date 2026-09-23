# Jai Maa Ambe — Durga Aarti

A self-contained frontend that lives alongside the Rath Yatra game. The
devotee holds a real aarti thali (or any bright round object) in front of the
webcam; the app finds the plate in their hand and turns their circling into a
brass thali revolving around the pratima. Eleven parikrama completes the aarti
and lights the pandal. The interface chrome is in English; the aarti sung is
kept in Hindi (Devanagari) — *Jai Ambe Gauri*, one verse per parikrama —
since that's the actual prayer being recited, not UI text.

## The experience

1. **Arrival** — a single diya on black while the pratima loads (with real
   progress), then the veil lifts.
2. **The temple entrance** — the devotee stands outside a carved teak door
   (brass studs, knockers, lotus panels) in a sindoor-red wall, under a
   painted ॐ arch and a marigold toran, with two brass lamps burning at the
   threshold and a bell hanging beside it.
3. **Open the Temple Doors** — the bell rings, the doors swing inward, and
   the camera walks through the doorway into the sanctum (a timed, eased
   4-second walk) while the sankalp line is spoken on screen.
4. **Aarti** — inside: brass bells that really swing on every parikrama,
   marigold garlands framing the view, a ring of 22 clay diyas that light two
   per parikrama, incense smoke curling up, soft light shafts with drifting
   dust, and sparks lifting off the thali. On-screen chrome stays at the
   edges: a brass parikrama ring with eleven flames, the verse as subtitles,
   a brass-rimmed camera mirror, and guidance only when needed.
   Extras: bell button / `Space` rings the bells; flower button (or two open
   palms) offers pushpanjali.
5. **Blessing** — three bells, a petal shower, every diya lit, the closing
   verse, then the blessing with the time taken and how many aartis this
   device has done. *Save Blessing Card* composes a 1080×1350 keepsake image
   and opens the share sheet (or downloads on desktop). *Darshan* hides
   everything so the devotee can just look at her. *Leave the Temple* walks
   back out and the doors close behind you.

Sound is deliberately minimal: a soft bell and a soft drum on each
parikrama, nothing continuous.

## Performance (low-end devices)

The model is never reduced — all 1.22M triangles ship to every device. The
cost is controlled around it:

| Change | Why |
| --- | --- |
| Shadow map baked once (`shadowMap.autoUpdate = false`) | Idol, pandal and key light never move; re-rendering the idol into the shadow map every frame doubled its cost. The thali no longer casts. |
| Adaptive pixel ratio (`Scene3D.adapt`) | Measures real frame times; drops resolution in steps when a device can't hold the frame rate, raises it back with headroom. |
| No `backdrop-filter` anywhere | Blurred panels over a canvas that repaints every frame re-blur every frame. |
| No `preserveDrawingBuffer` | Avoids a per-frame buffer copy; `snapshot()` renders and reads back in one task. |
| Idol matrices frozen | Skips per-frame matrix updates for the model's node tree. |
| Hands only run during the aarti | The start screen does no hand inference. |
| Pratima not drawn behind shut doors | On the start screen the doors hide her, so she is skipped entirely. Her shadow bake, texture upload and shader compile happen in one hidden frame while the loading veil is still up. |
| Atmosphere is GPU-driven | Smoke, dust and diya flicker animate in shaders from one time uniform — no per-frame JavaScript. Each effect is one draw call; all flowers are one instanced mesh. |
| One warm light, two jobs | The door lamp outside and the diya uplight inside are the same light, moved — every point light costs per pixel. |
| Bloom (high tier only) | Flames and gold glow via UnrealBloomPass, loaded lazily; it is the first thing `adapt()` switches off if frames slow down. |
| Low tier (≤4 cores / ≤4 GB, or `?quality=low`) | No bloom, no MSAA, pixel ratio ≤1, ~30fps cap, lite hand model, no face tracking, one fewer light, fewer petals/smoke/dust, simpler marigolds. `?quality=high` forces the full path. |

Animation is time-based, so capped or struggling devices move at the same
speed.

## Run

From the **repo root** (not this folder):

```bash
python proxy.py
```

Then open <http://localhost:8000/aarti/>. Plain `python -m http.server 8000`
works too. Needs a WebGL-capable browser.

## What it is

The pandal is **real-time 3D** (three.js), not a drawn scene: the pratima,
lion, Mahishasura, chalchitra backdrop, brass lamp stands and the aarti thali
are all lit geometry under spot and point lights, with shadows, image-based
lighting and ACES filmic tone mapping. The pratima is a sculpted model; every
other texture in the pandal (alpona floor, chalchitra, curtains, petals,
environment) is generated on a canvas at load, so the only binary assets are
the model itself and a face decal used by the fallback stand-in.

| File | Contains |
| --- | --- |
| `scene3d.js` | The entire 3D pandal: geometry, materials, lighting, thali orbit. |
| `aarti-detect.js` | Plate detection and circle counting. Pure functions, no DOM. |
| `test-aarti-detect.js` | Self-check for the above. |
| `aarti.js` | State, camera input, HUD, audio, game flow. |
| `index.html`, `style.css` | Interface chrome laid over the 3D scene. |
| `assets/durga.glb` | The pratima (Draco-compressed, 5.06 MB). |
| `assets/tex-durga-face.png` | Face decal for the fallback stand-in only. |
| `assets/make-assets.py` | Regenerates the decal. |

three.js is pinned to **r162** — the last release with a WebGL1 fallback,
which is what allows the scene to be rendered headlessly for verification.

## The idol

`assets/durga.glb` — a real sculpted model of Durga seated on her lion,
1,223,643 triangles with PBR base-colour, metallic-roughness and normal maps.
It is auto-centred, auto-scaled to the plinth and shadow-enabled on load; no
per-model tuning was needed beyond that (it was authored Y-up facing +Z, which
is what `fitToPlinth` expects).

**It ships compressed.** The source export was 46.7 MB, which is a long silent
wait on a first visit. Re-packed with Draco geometry compression and WebP
textures it is **5.06 MB — 9× smaller with every triangle intact** (verified by
round-tripping it back through the decoder: 1,223,643 triangles, identical
bounding box). The original archive is kept alongside as
`goddess-durga-on-a-lion.zip`.

To re-do that after replacing the model:

```bash
npx @gltf-transform/cli optimize in.glb out.glb \n  --compress draco --texture-compress webp --texture-size 2048 --simplify false
```

`--simplify false` matters: the default simplifier silently drops ~38% of the
triangles, which on a sculpted face is visible.

### Replacing it

Drop a new `assets/durga.glb` in and it is picked up automatically.

| Requirement | Value |
| --- | --- |
| Format | `.glb` (binary glTF 2.0), textures embedded |
| Orientation | Y-up, facing **+Z** |
| Scale / position | Irrelevant — auto-fitted to the plinth |
| Compression | Draco supported |
| Content | Full tableau preferred. Durga alone → set `modelIncludesVahana: false` in the `IDOL` block atop `scene3d.js` to keep the built-in lion and asura |

If it loads rotated or off-centre, `rotation` and `offset` in that same `IDOL`
block are the only knobs needed.

A cut-out photograph at `assets/durga.png` is used as a fallback if no model is
present, and primitive geometry as a last resort. Both paths still work.

## The thali orbit

The plate revolves on a **fixed vertical circle in front of the pratima** and
stays **perfectly level** — it does not tilt, bank, or wander across the
screen. The devotee's hand motion maps one-to-one onto the orbit angle: the
tracker reports how far the hand swept this frame, and the plate advances by
exactly that angle. Circling back rolls the plate back with you.

The plate carries its own point light, so the pratima is genuinely lit by the
moving flame — that moving highlight is the thing that makes the orbit read as
three-dimensional rather than as a sprite on a path.

It is a **tight circle in front of her torso** — centred low enough that the
top of the sweep passes below her face rather than across it, and high enough
that the bottom clears the plinth.

The two standing lamps light one wick per parikrama, five a side, with the
floor lamp before the idol lighting on the eleventh.

## Two things beyond the aarti

**Head-tracked parallax (darshan).** MediaPipe Face Detection follows the
devotee's head and the virtual camera answers it — move left and you see
around the right side of the lion, lean in and you come closer. Because the
camera keeps looking at a fixed point while the eye moves, near geometry
slides against far geometry exactly as it would in life, so the pandal reads
as an alcove behind the screen rather than a picture of one. It runs at a
third of the hand-tracking rate and is heavily smoothed; two MediaPipe graphs
at full rate costs more than the effect is worth. Off on the low tier.

**Pushpanjali.** Open both palms to the camera and flowers fly from you to
her feet, with a bloom of light where they land. A finger counts as extended
when its tip is further from the wrist than its middle joint — scale- and
rotation-invariant, so it works at any distance. It fires on the rising edge
only, so holding your palms up does not pour flowers continuously, and it
cannot be confused with circling a thali (that is a closed grip, and this
needs two open hands). A पुष्प button does the same for devotees without a camera.

## Face swap — disabled

Switched off as requested, not deleted. The pipeline itself is untouched
(`../face-swap.js`, `../logger.js`, `assets/devotee-*.png`). What is commented
out, and must all be un-commented together to restore it:

1. the face-swap panel in `index.html`
2. the `../face-swap.js` module tag at the bottom of `index.html`
3. the wiring block at the end of `aarti.js`

`../logger.js` is still active — session logging and webcam recording are
independent of the swap.

## How the detection works

**Finding the thali** — `findThali()` scores pixels in a box around the palm
(located by MediaPipe Hands) as either polished steel (bright, colourless) or
brass/diya flame (bright, warm). If enough of the box matches, its centroid is
the plate. Restricting the search to the hand is what stops a lamp or a bright
window from being mistaken for a thali.

This is a colour heuristic, not an object detector. It struggles under coloured
stage lighting. To upgrade, replace that one function with a TFJS detector —
nothing else depends on how the position is obtained. If no plate is found the
app silently falls back to tracking the palm itself, so it still works
bare-handed.

**Counting circles** — `createAartiTracker()` keeps ~3s of positions, fits a
circle through them by algebraic least squares (Kåsa), and accumulates the
signed angle swept about that centre. Every 2π is one parikrama.

The least-squares fit matters: a rolling *mean* of the points is not the centre
of the circle when the window only holds a partial arc, which makes slow
circling over-count badly. The fit recovers the true centre from any arc, so
slow and fast aarti both count correctly.

Guards against false positives: a minimum radius (rejects hand tremor), a
degenerate-fit check (rejects straight swipes), a per-frame step cap (rejects
tracking jumps), a reversal tolerance (a real direction change abandons the
arc), and an idle timeout.

## Tests

```bash
node aarti/test-aarti-detect.js
```

Covers circle counting at four speeds, both directions, small/large/noisy
circles, the four things that must never count (tremor, straight swipe, still
hand, reversal), angular-speed scaling, and steel/brass plate detection with
two negatives.

## Controls

| Input | Action |
| --- | --- |
| Thali in hand, circled | Perform the aarti |
| Mouse / finger circles | Fallback when no camera is available |
| Both palms open to camera | Offer pushpanjali |
| Move your head | Look around the pratima |
| `Space` / bell button | Ring the temple bell |
| Flower button | Offer pushpanjali |
| `F` | Fullscreen |
| `M` | Mute |

The bell and drum are synthesised with the Web Audio API; there are no audio
files.
#   a a r t i 
 
 