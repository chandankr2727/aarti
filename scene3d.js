/* ═══════════════════════════════════════════════════════════════
   DURGA PUJA PANDAL — real-time 3D (three.js r162)

   Everything on screen is lit geometry, not painted sprites: the pratima,
   the pandal, the brass lamps and the aarti thali are meshes under real
   lights with shadows and filmic tone mapping. The only image asset is the
   pratima's face decal; every other texture is generated at runtime.

   The thali orbits the idol on a fixed vertical circle and stays level —
   it never tilts and never wanders across the screen.
═══════════════════════════════════════════════════════════════ */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

// ═══════════════════════════════════════════════════════════════
// THE IDOL
//
// Order of preference, best first:
//   1. assets/durga.glb  — a real 3D model. Auto-centred, auto-scaled and
//                          dropped onto the plinth; nothing else to edit.
//   2. assets/durga.png  — a cut-out photograph of a real pratima, stood up
//                          as a lit plane. Flat, but genuinely photoreal.
//   3. built-in geometry — a stand-in only. It is primitives and it looks
//                          like primitives; it exists so the scene runs
//                          before you supply art, not as a finished idol.
//
// See README "Supplying the idol" for the file specs.
// ═══════════════════════════════════════════════════════════════
const IDOL = {
  model: 'assets/durga.glb',
  photo: 'assets/durga.png',
  targetHeight: 5.0,      // world units, base of idol to top
  baseY: 0.62,            // top of the plinth
  // Nudges for models that were not authored Y-up facing +Z.
  rotation: { x: 0, y: 0, z: 0 },
  offset: { x: 0, y: 0, z: 0 },
  // Set false if your model is Durga alone and you want the built-in lion
  // and Mahishasura kept.
  modelIncludesVahana: true,
};

// World scale: the pratima stands about 4.4 units tall on a 0.6 platform.
// A tight circle in front of the deity's torso. Centred low enough that the
// top of the sweep passes below her face rather than across it, and high
// enough that the bottom clears the plinth.
const ORBIT = { x: 0, y: 2.55, z: 2.35, radius: 1.10 };
const TOTAL_WICKS = 10;         // five per lamp stand; the 11th is the floor lamp

// ───────────────────────────────────────────────────────────────
// Runtime textures — keeps the asset folder to a single image.
// ───────────────────────────────────────────────────────────────
function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function canvasTexture(w, h, paint, repeat) {
  const c = makeCanvas(w, h);
  paint(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  if (repeat) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat[0], repeat[1]);
  }
  tex.anisotropy = 8;
  return tex;
}

// Soft radial falloff, used for every additive glow in the scene.
function glowTexture() {
  return canvasTexture(128, 128, (ctx, w) => {
    const g = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.18, 'rgba(255,226,170,0.85)');
    g.addColorStop(0.45, 'rgba(255,150,60,0.28)');
    g.addColorStop(1, 'rgba(255,110,30,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, w);
  });
}

// White rice-paste alpona on terracotta.
function alponaTexture() {
  return canvasTexture(1024, 1024, (ctx, w) => {
    ctx.fillStyle = '#7A3B2A';
    ctx.fillRect(0, 0, w, w);
    const g = ctx.createRadialGradient(w / 2, w / 2, 40, w / 2, w / 2, w / 2);
    g.addColorStop(0, '#9A5038');
    g.addColorStop(1, '#5E2B1E');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, w);

    ctx.strokeStyle = 'rgba(245,238,225,0.85)';
    ctx.lineCap = 'round';
    const cx = w / 2, cy = w / 2;

    for (const r of [120, 200, 300, 420]) {
      ctx.lineWidth = r > 300 ? 5 : 3;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Lotus petals in two rings
    for (const [count, rIn, rOut, wide] of [[16, 200, 300, 0.10], [24, 300, 420, 0.07]]) {
      ctx.lineWidth = 3;
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * rIn, cy + Math.sin(a) * rIn);
        ctx.quadraticCurveTo(
          cx + Math.cos(a + wide) * (rIn + rOut) / 2, cy + Math.sin(a + wide) * (rIn + rOut) / 2,
          cx + Math.cos(a) * rOut, cy + Math.sin(a) * rOut);
        ctx.quadraticCurveTo(
          cx + Math.cos(a - wide) * (rIn + rOut) / 2, cy + Math.sin(a - wide) * (rIn + rOut) / 2,
          cx + Math.cos(a) * rIn, cy + Math.sin(a) * rIn);
        ctx.stroke();
      }
    }
  });
}

// Red Benarasi with a gold zari border along one edge.
// Red Benarasi. The lathe that wears it maps v from hem (0) to waist (1),
// so the zari border belongs at the *bottom* of the texture.
function sareeTexture() {
  return canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#5E0812';
    ctx.fillRect(0, 0, w, h);
    // Woven variation
    for (let i = 0; i < 4000; i++) {
      ctx.fillStyle = `rgba(${96 + Math.random() * 54}, ${10 + Math.random() * 20}, ${22 + Math.random() * 18}, 0.34)`;
      ctx.fillRect(Math.random() * w, Math.random() * h, 3, 1.5);
    }
    // Small gold butis
    ctx.fillStyle = 'rgba(190,152,60,0.62)';
    for (let y = 16; y < h; y += 42) {
      for (let x = 16 + ((y / 42) % 2) * 21; x < w; x += 42) {
        ctx.beginPath();
        ctx.ellipse(x, y, 3.4, 5.5, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // Zari border along the hem
    const bg = ctx.createLinearGradient(0, 0, 0, 78);
    bg.addColorStop(0, '#8A6A14');
    bg.addColorStop(0.5, '#F2DE9A');
    bg.addColorStop(1, '#9A7718');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, 78);
    ctx.strokeStyle = 'rgba(110,72,8,0.5)';
    ctx.lineWidth = 2.5;
    for (let x = 0; x < w; x += 26) {
      ctx.beginPath();
      ctx.arc(x + 13, 40, 10, 0, Math.PI * 2);
      ctx.stroke();
    }
  }, [4, 1]);
}

// The painted arc (prabhavali) that stands behind the pratima.
function chalchitraTexture() {
  return canvasTexture(1024, 512, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#7C1520');
    g.addColorStop(0.55, '#A62231');
    g.addColorStop(1, '#5E0F18');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // Radiating gold rays from the centre bottom
    ctx.save();
    ctx.translate(w / 2, h);
    for (let i = 0; i < 48; i++) {
      ctx.rotate((Math.PI * 2) / 48);
      ctx.fillStyle = i % 2 ? 'rgba(226,186,86,0.30)' : 'rgba(255,225,150,0.14)';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(18, -h * 1.4);
      ctx.lineTo(-18, -h * 1.4);
      ctx.fill();
    }
    ctx.restore();

    // Scalloped gold trim along the top
    ctx.strokeStyle = '#E8C96A';
    ctx.lineWidth = 7;
    ctx.beginPath();
    for (let x = 0; x <= w; x += 64) ctx.arc(x + 32, 26, 32, Math.PI, Math.PI * 2);
    ctx.stroke();

    // Floral medallions
    for (let i = 0; i < 9; i++) {
      const x = (i + 0.5) * (w / 9);
      const y = h * 0.42 + Math.sin(i * 1.1) * 28;
      ctx.fillStyle = 'rgba(232,201,106,0.55)';
      for (let p = 0; p < 8; p++) {
        const a = (p / 8) * Math.PI * 2;
        ctx.beginPath();
        ctx.ellipse(x + Math.cos(a) * 20, y + Math.sin(a) * 20, 11, 6, a, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#F4E3A8';
      ctx.beginPath();
      ctx.arc(x, y, 9, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

// Metals reflect their surroundings; with only point lights and no
// environment, brass and gold render near-black. This stands in for the
// pandal's interior so they pick up warm bounce.
function envTexture() {
  const tex = canvasTexture(512, 256, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#1C0A12');
    g.addColorStop(0.40, '#6E2A1C');
    g.addColorStop(0.58, '#D89248');
    g.addColorStop(0.74, '#7A3A22');
    g.addColorStop(1, '#2A1410');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // Bright patches where the lamps stand
    for (const x of [0.18, 0.5, 0.82]) {
      const rg = ctx.createRadialGradient(x * w, h * 0.60, 2, x * w, h * 0.60, w * 0.13);
      rg.addColorStop(0, 'rgba(255,226,160,0.95)');
      rg.addColorStop(1, 'rgba(255,200,120,0)');
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, w, h);
    }
  });
  tex.mapping = THREE.EquirectangularReflectionMapping;
  return tex;
}

function petalTexture() {
  return canvasTexture(64, 64, (ctx, w) => {
    const g = ctx.createRadialGradient(w * 0.4, w * 0.4, 2, w / 2, w / 2, w / 2);
    g.addColorStop(0, 'rgba(255,240,240,0.95)');
    g.addColorStop(0.5, 'rgba(232,90,110,0.9)');
    g.addColorStop(1, 'rgba(160,30,55,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(w / 2, w / 2, w * 0.46, w * 0.26, 0.6, 0, Math.PI * 2);
    ctx.fill();
  });
}

// ───────────────────────────────────────────────────────────────
// Materials
// ───────────────────────────────────────────────────────────────
const MAT = {};
function buildMaterials(tex) {
  MAT.brass = new THREE.MeshStandardMaterial({ color: 0xC9A227, roughness: 0.34, metalness: 0.85 });
  MAT.brassDark = new THREE.MeshStandardMaterial({ color: 0x8A6A18, roughness: 0.42, metalness: 0.9 });
  MAT.gold = new THREE.MeshStandardMaterial({ color: 0xE3BC58, roughness: 0.32, metalness: 0.82 });
  MAT.skin = new THREE.MeshStandardMaterial({ color: 0xD9A273, roughness: 0.66, metalness: 0.0 });
  MAT.saree = new THREE.MeshStandardMaterial({ map: tex.saree, roughness: 0.78, metalness: 0.06 });
  MAT.red = new THREE.MeshStandardMaterial({ color: 0xA81A2A, roughness: 0.72, metalness: 0.05 });
  MAT.hair = new THREE.MeshStandardMaterial({ color: 0x14100F, roughness: 0.52, metalness: 0.05 });
  // Matte, not metal: MAT.gold on an animal reads as black chrome.
  MAT.lion = new THREE.MeshStandardMaterial({ color: 0xD9A441, roughness: 0.62, metalness: 0.10 });
  MAT.maneDark = new THREE.MeshStandardMaterial({ color: 0x7E4A18, roughness: 0.78, metalness: 0.05 });
  MAT.stone = new THREE.MeshStandardMaterial({ color: 0x6E5A4E, roughness: 0.92, metalness: 0.0 });
  MAT.terracotta = new THREE.MeshStandardMaterial({ map: tex.alpona, roughness: 0.88, metalness: 0.0 });
  MAT.chalchitra = new THREE.MeshStandardMaterial({
    map: tex.chalchitra, roughness: 0.85, metalness: 0.05, side: THREE.DoubleSide,
  });
  MAT.drape = new THREE.MeshStandardMaterial({ color: 0x8C1420, roughness: 0.9, side: THREE.DoubleSide });
  MAT.demon = new THREE.MeshStandardMaterial({ color: 0x2E4A36, roughness: 0.7, metalness: 0.12 });
  MAT.flame = new THREE.MeshStandardMaterial({
    color: 0xFFD070, emissive: 0xFF8A20, emissiveIntensity: 2.1, roughness: 1, transparent: true, opacity: 0.92,
  });
}

// ───────────────────────────────────────────────────────────────
// Small builders
// ───────────────────────────────────────────────────────────────
function makeGlow(tex, scale, color) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
  }));
  s.scale.setScalar(scale);
  return s;
}

// A wick: emissive teardrop plus an additive halo. Returned as a group so it
// can be switched on and off as parikrama are offered.
function makeWick(glowTex, scale = 1) {
  const g = new THREE.Group();
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.045 * scale, 0.17 * scale, 10), MAT.flame);
  flame.position.y = 0.085 * scale;
  g.add(flame);
  const halo = makeGlow(glowTex, 0.40 * scale, 0xFFB24A);
  halo.position.y = 0.08 * scale;
  g.add(halo);
  g.userData.flame = flame;
  g.userData.halo = halo;
  return g;
}

// Turned brass lamp stand (samai) with five wick arms.
function makeLampStand(glowTex) {
  const g = new THREE.Group();

  const profile = [];
  const pts = [[0.42, 0], [0.42, 0.05], [0.26, 0.10], [0.13, 0.16], [0.07, 0.30],
    [0.13, 0.42], [0.07, 0.54], [0.15, 0.70], [0.07, 0.84], [0.06, 1.90], [0.16, 2.00],
    [0.10, 2.06], [0.05, 2.16], [0.0, 2.22]];
  for (const [x, y] of pts) profile.push(new THREE.Vector2(x, y));
  const shaft = new THREE.Mesh(new THREE.LatheGeometry(profile, 28), MAT.brass);
  shaft.castShadow = true;
  g.add(shaft);

  g.userData.wicks = [];
  for (let i = 0; i < 5; i++) {
    const y = 0.95 + i * 0.22;
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.30, 8), MAT.brass);
    arm.rotation.z = Math.PI / 2;
    arm.position.set(0.15, y, 0);
    g.add(arm);

    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.055, 0.05, 14), MAT.brass);
    cup.position.set(0.30, y + 0.01, 0);
    g.add(cup);

    const wick = makeWick(glowTex, 0.9);
    wick.position.set(0.30, y + 0.04, 0);
    wick.visible = false;
    g.add(wick);
    g.userData.wicks.push(wick);
  }

  const finial = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 12), MAT.gold);
  finial.position.y = 2.26;
  finial.scale.y = 1.6;
  g.add(finial);
  return g;
}

// ───────────────────────────────────────────────────────────────
// The pratima
// ───────────────────────────────────────────────────────────────
function makeDurga(tex, glowTex) {
  const g = new THREE.Group();

  // ── Saree-draped lower body ──
  const skirt = [];
  for (const [x, y] of [[0.0, 0], [1.05, 0.02], [1.02, 0.35], [0.86, 0.95],
    [0.70, 1.55], [0.60, 2.10], [0.54, 2.46]]) skirt.push(new THREE.Vector2(x, y));
  const lower = new THREE.Mesh(new THREE.LatheGeometry(skirt, 40), MAT.saree);
  lower.castShadow = lower.receiveShadow = true;
  g.add(lower);

  // ── Torso ──
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.44, 0.62, 8, 20), MAT.skin);
  torso.position.y = 2.42;
  torso.scale.set(1.12, 1, 0.78);
  torso.castShadow = true;
  g.add(torso);

  // Blouse
  const blouse = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.47, 0.52, 22, 1, true), MAT.red);
  blouse.position.y = 2.62;
  blouse.scale.set(1.1, 1, 0.82);
  g.add(blouse);

  // ── Ten arms ──
  // Five a side, fanned. Each is a tapered limb ending in a weapon.
  const WEAPONS = ['trishul', 'khadga', 'chakra', 'dhanush', 'abhaya',
    'shankha', 'gada', 'padma', 'ghanta', 'baan'];
  g.userData.arms = [];
  let wi = 0;
  for (const side of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      const spread = -0.30 + i * 0.52;            // fans from low to high
      const arm = new THREE.Group();
      arm.position.set(side * 0.46, 2.72, -0.05 + i * 0.03);
      arm.rotation.z = side * spread;

      const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.068, 0.82, 10), MAT.skin);
      upper.position.set(side * 0.40, 0.05, 0);
      upper.rotation.z = side * -Math.PI / 2;
      upper.castShadow = true;
      arm.add(upper);

      const fore = new THREE.Mesh(new THREE.CylinderGeometry(0.068, 0.055, 0.78, 10), MAT.skin);
      fore.position.set(side * 1.14, 0.20, 0);
      fore.rotation.z = side * -Math.PI / 2.55;
      fore.castShadow = true;
      arm.add(fore);

      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 10), MAT.skin);
      hand.position.set(side * 1.48, 0.38, 0);
      arm.add(hand);

      // Bangles
      for (const by of [0.14, 0.24]) {
        const b = new THREE.Mesh(new THREE.TorusGeometry(0.062, 0.016, 8, 16), MAT.gold);
        b.position.set(side * (1.30 + by * 0.4), by + 0.08, 0);
        b.rotation.y = Math.PI / 2;
        b.rotation.x = side * -0.4;
        arm.add(b);
      }

      const weapon = makeWeapon(WEAPONS[wi++], side, glowTex);
      if (weapon) {
        weapon.position.set(side * 1.52, 0.42, 0);
        arm.add(weapon);
      }

      g.add(arm);
      g.userData.arms.push(arm);
    }
  }

  // ── Neck + head ──
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.19, 0.26, 14), MAT.skin);
  neck.position.y = 3.10;
  g.add(neck);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.40, 40, 32), MAT.skin);
  head.position.y = 3.44;
  head.scale.set(0.90, 1.12, 0.92);
  head.castShadow = true;
  g.add(head);

  // Face decal: a curved patch sitting just proud of the head so it follows
  // the surface instead of floating as a flat card.
  const faceMat = new THREE.MeshStandardMaterial({
    map: tex.face, transparent: true, roughness: 0.6, metalness: 0,
    alphaTest: 0.03, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
  });
  const arc = 1.55;
  const faceGeo = new THREE.CylinderGeometry(0.385, 0.385, 0.68, 40, 1, true, -arc / 2, arc);
  const face = new THREE.Mesh(faceGeo, faceMat);
  face.position.set(0, 3.47, 0.012);
  face.scale.set(0.95, 1, 0.97);
  // Hidden until the decal arrives — an unmapped material would show as a
  // blank white patch over the face.
  face.visible = false;
  g.userData.face = face;
  g.add(face);

  // Hair framing the face
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.44, 32, 24), MAT.hair);
  hair.position.set(0, 3.52, -0.13);
  hair.scale.set(0.94, 1.10, 0.78);
  g.add(hair);
  const bun = new THREE.Mesh(new THREE.SphereGeometry(0.22, 20, 16), MAT.hair);
  bun.position.set(0, 3.52, -0.36);
  g.add(bun);

  // ── Mukut (crown) ──
  const crown = new THREE.Group();
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.40, 0.40, 0.16, 32), MAT.gold);
  band.position.y = 3.86;
  crown.add(band);
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.36, 0.84, 24), MAT.gold);
  cone.position.y = 4.32;
  crown.add(cone);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.07, 14, 12), MAT.gold);
  tip.position.y = 4.78;
  crown.add(tip);
  // Radiating spikes around the band
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const sp = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.30, 8), MAT.gold);
    sp.position.set(Math.cos(a) * 0.40, 4.02, Math.sin(a) * 0.40);
    sp.rotation.z = -Math.cos(a) * 0.4;
    sp.rotation.x = Math.sin(a) * 0.4;
    crown.add(sp);
  }
  crown.traverse((m) => { if (m.isMesh) m.castShadow = true; });
  g.add(crown);

  // ── Jewellery ──
  for (const [y, r, tube] of [[3.12, 0.22, 0.030], [3.00, 0.30, 0.026], [2.86, 0.38, 0.022]]) {
    const n = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 8, 28), MAT.gold);
    n.position.y = y;
    n.rotation.x = Math.PI / 2 - 0.25;
    g.add(n);
  }
  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.018, 8, 16), MAT.gold);
    ear.position.set(side * 0.35, 3.34, 0.02);
    g.add(ear);
  }

  return g;
}

// Prabhamandal. Lives in the scene, not on the idol, so it survives the
// placeholder being swapped out for a real model.
function makePrabhamandal(glowTex) {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(1.35, 0.055, 10, 64),
    new THREE.MeshStandardMaterial({
      color: 0xE8C96A, emissive: 0xFFB43C, emissiveIntensity: 1.4, metalness: 0.8, roughness: 0.3,
    }),
  );
  g.add(ring);
  const halo = makeGlow(glowTex, 4.2, 0xFFA83C);
  halo.position.z = -0.15;
  g.add(halo);
  g.position.set(0, 4.05, -0.75);
  g.userData = { ring, halo };
  return g;
}

function makeWeapon(kind, side, glowTex) {
  const g = new THREE.Group();
  const haft = (len, r = 0.022) =>
    new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 8), MAT.brassDark);

  switch (kind) {
    case 'trishul': {
      const h = haft(2.0, 0.026); h.position.y = 0.6; g.add(h);
      for (const dx of [-0.13, 0, 0.13]) {
        const p = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.34, 8), MAT.gold);
        p.position.set(dx, 1.68 + (dx === 0 ? 0.1 : 0), 0);
        g.add(p);
      }
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.035, 0.035), MAT.gold);
      bar.position.y = 1.48; g.add(bar);
      break;
    }
    case 'khadga': {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.10, 1.05, 0.022), MAT.gold);
      blade.position.y = 0.66; blade.rotation.z = side * -0.12; g.add(blade);
      const grip = haft(0.24); grip.position.y = 0.06; g.add(grip);
      break;
    }
    case 'chakra': {
      const c = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.035, 8, 24), MAT.gold);
      c.position.y = 0.22; c.rotation.y = Math.PI / 2; g.add(c);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const sp = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.10, 6), MAT.gold);
        sp.position.set(0, 0.22 + Math.sin(a) * 0.26, Math.cos(a) * 0.26);
        sp.rotation.x = -a; g.add(sp);
      }
      break;
    }
    case 'dhanush': {
      const bow = new THREE.Mesh(new THREE.TorusGeometry(0.52, 0.022, 8, 24, Math.PI * 1.1), MAT.brassDark);
      bow.position.y = 0.3; bow.rotation.z = side * 1.2; g.add(bow);
      break;
    }
    case 'shankha': {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.11, 14, 12),
        new THREE.MeshStandardMaterial({ color: 0xF2EADA, roughness: 0.32, metalness: 0.05 }));
      s.scale.set(0.8, 1.5, 0.8);
      s.position.y = 0.12; s.rotation.z = side * 0.5; g.add(s);
      break;
    }
    case 'gada': {
      const h = haft(0.62); h.position.y = 0.26; g.add(h);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 12), MAT.gold);
      head.position.y = 0.64; g.add(head);
      break;
    }
    case 'padma': {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const p = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8),
          new THREE.MeshStandardMaterial({ color: 0xE86A86, roughness: 0.6 }));
        p.position.set(Math.cos(a) * 0.10, 0.12, Math.sin(a) * 0.10);
        p.scale.set(1, 0.4, 0.55);
        g.add(p);
      }
      break;
    }
    case 'ghanta': {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.15, 0.24, 14), MAT.brass);
      b.position.y = 0.0; g.add(b);
      break;
    }
    case 'baan': {
      const sh = haft(0.9, 0.014); sh.position.y = 0.4; g.add(sh);
      const tipM = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.14, 8), MAT.gold);
      tipM.position.y = 0.92; g.add(tipM);
      break;
    }
    default: // abhaya — open palm, nothing held
      return null;
  }
  return g;
}

// The lion (simha), and Mahishasura beneath her foot. Both are matte —
// fully metallic materials made them read as black chrome pipes.
function makeVahana() {
  const g = new THREE.Group();

  // ── Simha, standing at her left, turned toward the camera ──
  const lion = new THREE.Group();
  lion.position.set(-2.25, 0, 0.55);
  lion.rotation.y = 0.42;

  const body = new THREE.Mesh(new THREE.SphereGeometry(0.52, 24, 18), MAT.lion);
  body.position.set(0, 1.02, -0.30);
  body.scale.set(0.95, 0.88, 1.55);
  body.castShadow = true;
  lion.add(body);

  const chest = new THREE.Mesh(new THREE.SphereGeometry(0.44, 20, 16), MAT.lion);
  chest.position.set(0, 1.08, 0.52);
  chest.scale.set(1, 0.95, 1);
  lion.add(chest);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.30, 22, 18), MAT.lion);
  head.position.set(0, 1.52, 0.86);
  head.scale.set(1, 0.92, 0.95);
  head.castShadow = true;
  lion.add(head);

  const mane = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.17, 12, 24), MAT.maneDark);
  mane.position.set(0, 1.50, 0.74);
  lion.add(mane);

  const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 12), MAT.lion);
  muzzle.position.set(0, 1.44, 1.10);
  muzzle.scale.set(1, 0.8, 1.1);
  lion.add(muzzle);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), MAT.maneDark);
  nose.position.set(0, 1.48, 1.22);
  lion.add(nose);

  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), MAT.lion);
    ear.position.set(s * 0.22, 1.74, 0.82);
    ear.scale.z = 0.5;
    lion.add(ear);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 8), MAT.maneDark);
    eye.position.set(s * 0.12, 1.58, 1.08);
    lion.add(eye);
  }

  for (const [lx, lz] of [[0.26, 0.72], [-0.26, 0.72], [0.26, -0.78], [-0.26, -0.78]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.135, 1.0, 12), MAT.lion);
    leg.position.set(lx, 0.50, lz);
    leg.castShadow = true;
    lion.add(leg);
    const paw = new THREE.Mesh(new THREE.SphereGeometry(0.145, 12, 10), MAT.lion);
    paw.position.set(lx, 0.10, lz + 0.05);
    paw.scale.set(1, 0.6, 1.25);
    lion.add(paw);
  }

  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.025, 1.1, 8), MAT.lion);
  tail.position.set(0.18, 1.32, -1.0);
  tail.rotation.set(-0.7, 0, -0.3);
  lion.add(tail);
  const tuft = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), MAT.maneDark);
  tuft.position.set(0.32, 1.72, -1.28);
  lion.add(tuft);

  g.add(lion);

  // ── Mahishasura, fallen at her right foot ──
  const demon = new THREE.Group();
  demon.position.set(1.85, 0, 0.75);
  demon.rotation.y = -0.5;

  const dTorso = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.52, 8, 14), MAT.demon);
  dTorso.position.set(0, 0.52, 0);
  dTorso.rotation.z = 0.55;
  dTorso.castShadow = true;
  demon.add(dTorso);

  const dHead = new THREE.Mesh(new THREE.SphereGeometry(0.23, 18, 14), MAT.demon);
  dHead.position.set(0.42, 0.88, 0.05);
  demon.add(dHead);

  // Buffalo horns
  for (const s of [-1, 1]) {
    const horn = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.04, 8, 16, Math.PI * 0.8), MAT.stone);
    horn.position.set(0.44, 1.02, s * 0.16);
    horn.rotation.set(Math.PI / 2, s * 0.5, s * 1.1);
    demon.add(horn);
  }

  // One arm thrown up
  const dArm = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.06, 0.72, 10), MAT.demon);
  dArm.position.set(0.05, 1.02, 0.30);
  dArm.rotation.set(0.3, 0, -0.8);
  demon.add(dArm);

  const dLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.075, 0.78, 10), MAT.demon);
  dLeg.position.set(-0.55, 0.30, 0.02);
  dLeg.rotation.z = 1.15;
  demon.add(dLeg);

  g.add(demon);

  return g;
}

// ───────────────────────────────────────────────────────────────
// The aarti thali — orbits the idol, always level.
// ───────────────────────────────────────────────────────────────
function makeThali(glowTex) {
  const g = new THREE.Group();

  const profile = [];
  for (const [x, y] of [[0, 0], [0.40, 0], [0.42, 0.015], [0.44, 0.055],
    [0.455, 0.10], [0.44, 0.115], [0.40, 0.085], [0.38, 0.035], [0, 0.028]]) {
    profile.push(new THREE.Vector2(x, y));
  }
  const plate = new THREE.Mesh(new THREE.LatheGeometry(profile, 44), MAT.brass);
  // No castShadow: the shadow map is baked once (see init), so a moving
  // caster would leave a frozen shadow behind.
  plate.receiveShadow = true;
  g.add(plate);

  // Engraved inner ring
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.008, 6, 40), MAT.brassDark);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.03;
  g.add(ring);

  // Kumkum and haldi mounds, and a few petals
  const kumkum = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 8),
    new THREE.MeshStandardMaterial({ color: 0xC42B48, roughness: 0.95 }));
  kumkum.position.set(-0.14, 0.045, 0.06);
  kumkum.scale.y = 0.5;
  g.add(kumkum);
  const haldi = kumkum.clone();
  haldi.material = new THREE.MeshStandardMaterial({ color: 0xE0A82C, roughness: 0.95 });
  haldi.position.set(0.14, 0.045, 0.06);
  g.add(haldi);

  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.5;
    const p = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6),
      new THREE.MeshStandardMaterial({ color: i % 2 ? 0xE86A86 : 0xF2D98A, roughness: 0.8 }));
    p.position.set(Math.cos(a) * 0.17, 0.038, Math.sin(a) * 0.17 - 0.05);
    p.scale.set(1.5, 0.35, 0.9);
    p.rotation.y = a;
    g.add(p);
  }

  // Five wicks around the rim
  g.userData.wicks = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.042, 0.032, 12), MAT.brass);
    cup.position.set(Math.cos(a) * 0.30, 0.045, Math.sin(a) * 0.30);
    g.add(cup);

    const wick = makeWick(glowTex, 1.0);
    wick.position.set(Math.cos(a) * 0.30, 0.062, Math.sin(a) * 0.30);
    g.add(wick);
    g.userData.wicks.push(wick);
  }

  // The plate's own light — this is what makes the orbit read in 3D: the
  // pratima is genuinely lit by the moving flame.
  const light = new THREE.PointLight(0xFFAE55, 14, 12, 2);
  light.position.y = 0.30;
  g.add(light);
  g.userData.light = light;

  const bigGlow = makeGlow(glowTex, 1.05, 0xFF9E3C);
  bigGlow.position.y = 0.16;
  g.add(bigGlow);
  g.userData.glow = bigGlow;

  return g;
}

// ───────────────────────────────────────────────────────────────
// Pandal shell
// ───────────────────────────────────────────────────────────────
function makePandal(tex) {
  const g = new THREE.Group();

  const floor = new THREE.Mesh(new THREE.CircleGeometry(16, 56), MAT.terracotta);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  g.add(floor);

  // Raised platform the pratima stands on
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(3.5, 3.9, 0.62, 40), MAT.stone);
  plinth.position.y = 0.31;
  plinth.receiveShadow = true;
  plinth.castShadow = true;
  g.add(plinth);
  const trim = new THREE.Mesh(new THREE.TorusGeometry(3.52, 0.06, 8, 48), MAT.gold);
  trim.position.y = 0.60;
  trim.rotation.x = Math.PI / 2;
  g.add(trim);

  // Chalchitra: the painted arc standing behind her
  // The arc spans theta 0.72π–1.28π, which already centres it on -Z, i.e.
  // behind the pratima. Rotating it would swing it in front of the camera.
  const chal = new THREE.Mesh(
    new THREE.CylinderGeometry(4.6, 4.6, 7.4, 48, 1, true, Math.PI * 0.72, Math.PI * 0.56),
    MAT.chalchitra,
  );
  chal.position.set(0, 3.7, 0);
  g.add(chal);

  // Arched crest over the chalchitra
  const crest = new THREE.Mesh(new THREE.TorusGeometry(4.6, 0.16, 10, 52, Math.PI), MAT.gold);
  crest.position.set(0, 7.2, 0);
  crest.rotation.set(0, 0, 0);
  crest.scale.set(1, 0.42, 1);
  g.add(crest);

  // Pillars
  for (const side of [-1, 1]) {
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.48, 9, 20), MAT.stone);
    col.position.set(side * 6.6, 4.5, 0.5);
    col.castShadow = true;
    g.add(col);
    for (const y of [1.2, 4.4, 7.6]) {
      const b = new THREE.Mesh(new THREE.TorusGeometry(0.48, 0.07, 8, 22), MAT.gold);
      b.position.set(side * 6.6, y, 0.5);
      b.rotation.x = Math.PI / 2;
      g.add(b);
    }
    // Pandal cloth hanging full-height beside each pillar. Rippled and
    // vertical, so it reads as fabric rather than a flat card in the air.
    const curtain = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 9.4, 14, 4), MAT.drape);
    curtain.position.set(side * 5.5, 4.8, -1.4);
    curtain.rotation.set(0, side * -0.42, 0);
    const pos = curtain.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const u = pos.getX(i) / 2.8 + 0.5;
      pos.setZ(i, Math.sin(u * Math.PI * 4) * 0.28);
    }
    pos.needsUpdate = true;
    curtain.geometry.computeVertexNormals();
    g.add(curtain);
  }

  // Valance across the top of the pandal
  const valance = new THREE.Mesh(new THREE.BoxGeometry(14.5, 1.0, 0.36), MAT.drape);
  valance.position.set(0, 8.5, 0.2);
  g.add(valance);
  const valanceTrim = new THREE.Mesh(new THREE.BoxGeometry(14.5, 0.14, 0.42), MAT.gold);
  valanceTrim.position.set(0, 8.0, 0.2);
  g.add(valanceTrim);

  return g;
}

// ───────────────────────────────────────────────────────────────
// Falling marigold / hibiscus petals
// ───────────────────────────────────────────────────────────────
function makePetals(tex, count = 130) {
  const pos = new Float32Array(count * 3);
  const vel = new Float32Array(count);
  const phase = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 13;
    pos[i * 3 + 1] = Math.random() * 10;
    // Kept forward of the pratima so they read as falling petals rather
    // than stars scattered over the backdrop.
    pos[i * 3 + 2] = 1.5 + Math.random() * 5;
    vel[i] = 0.3 + Math.random() * 0.55;
    phase[i] = Math.random() * Math.PI * 2;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    map: tex, size: 0.34, transparent: true, depthWrite: false,
    sizeAttenuation: true, opacity: 0.85, color: 0xFF9BA8,
  });
  const points = new THREE.Points(geo, mat);
  points.userData = { vel, phase, count };
  return points;
}

// ───────────────────────────────────────────────────────────────
// Pushpanjali — flowers thrown to the deity with two open palms.
// Separate from the ambient petal fall: these have velocity, gravity and
// a lifetime, and they fly from the devotee toward the idol.
// ───────────────────────────────────────────────────────────────
function makeOffering(tex, count = 120) {
  const pos = new Float32Array(count * 3);
  const vel = new Float32Array(count * 3);
  const life = new Float32Array(count);       // 0 = inactive
  for (let i = 0; i < count; i++) pos[i * 3 + 1] = -100;   // parked off-scene

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const points = new THREE.Points(geo, new THREE.PointsMaterial({
    map: tex, size: 0.30, transparent: true, depthWrite: false,
    sizeAttenuation: true, opacity: 0.95, color: 0xFFC7D2,
  }));
  points.userData = { vel, life, count, next: 0 };
  return points;
}

// ───────────────────────────────────────────────────────────────
// Supplied-idol loading
// ───────────────────────────────────────────────────────────────

// Centres a loaded object on the plinth and scales it to IDOL.targetHeight,
// so any model works without hand-tuning numbers for it.
function fitToPlinth(obj) {
  obj.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(obj);
  const size = new THREE.Vector3();
  const centre = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(centre);

  if (size.y < 1e-6) return obj;              // degenerate: leave it alone
  const scale = IDOL.targetHeight / size.y;

  const holder = new THREE.Group();
  obj.position.set(-centre.x, -box.min.y, -centre.z);   // origin at its feet
  holder.add(obj);
  holder.scale.setScalar(scale);
  holder.position.set(IDOL.offset.x, IDOL.baseY + IDOL.offset.y, IDOL.offset.z);
  holder.rotation.set(IDOL.rotation.x, IDOL.rotation.y, IDOL.rotation.z);

  holder.updateMatrixWorld(true);
  holder.traverse((m) => {
    // The idol never moves: skip re-deriving its (many) node matrices
    // every frame.
    m.matrixAutoUpdate = false;
    if (!m.isMesh) return;
    m.castShadow = true;
    m.receiveShadow = true;
    // Supplied models are often authored for a bright studio; the pandal is
    // lit by lamps, so keep materials from blowing out under the key light.
    if (m.material && 'envMapIntensity' in m.material) m.material.envMapIntensity = 0.7;
  });

  return holder;
}

function loadIdolModel(url, onProgress) {
  return new Promise((resolve, reject) => {
    const loader = new GLTFLoader();
    // Most web-optimised GLBs ship Draco-compressed; without this they fail
    // to parse with a confusing error.
    const draco = new DRACOLoader();
    draco.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.162.0/examples/jsm/libs/draco/');
    loader.setDRACOLoader(draco);
    loader.load(
      url,
      (gltf) => resolve(gltf.scene),
      (e) => {
        // lengthComputable is false when the server omits Content-Length;
        // report indeterminate rather than a bogus 0%.
        if (onProgress) onProgress(e.lengthComputable && e.total ? e.loaded / e.total : -1);
      },
      reject,
    );
  });
}

// A cut-out photograph, stood up as a lit plane. Flat, but it is a real
// pratima — which beats stylised geometry when the goal is photoreal.
function loadIdolPhoto(url) {
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(url, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      const img = tex.image;
      const aspect = (img && img.width && img.height) ? img.width / img.height : 0.6;
      const h = IDOL.targetHeight;
      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(h * aspect, h),
        new THREE.MeshStandardMaterial({
          map: tex, transparent: true, alphaTest: 0.5,
          roughness: 0.85, metalness: 0.0, side: THREE.DoubleSide,
        }),
      );
      plane.position.set(IDOL.offset.x, IDOL.baseY + h / 2 + IDOL.offset.y, IDOL.offset.z);
      plane.castShadow = true;
      resolve(plane);
    }, undefined, reject);
  });
}

// ═══════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════
export const Scene3D = {
  ready: false,

  init(canvas, opts = {}) {
    this.canvas = canvas;
    this.onIdolProgress = opts.onIdolProgress || null;
    this.onIdolReady = opts.onIdolReady || null;
    const low = opts.tier === 'low';
    this.tier = low ? 'low' : 'high';

    // No preserveDrawingBuffer: it forces a buffer copy every frame on many
    // GPUs. snapshot() renders and reads back in the same task instead.
    const renderer = new THREE.WebGLRenderer({
      canvas, antialias: !low, alpha: false, powerPreference: 'high-performance',
    });
    const dpr = window.devicePixelRatio || 1;
    this.perf.maxPR = low ? Math.min(dpr, 1) : Math.min(dpr, 2);
    this.perf.minPR = low ? 0.6 : Math.min(0.75, this.perf.maxPR);
    this.perf.pr = this.perf.maxPR;
    renderer.setPixelRatio(this.perf.pr);

    // The key light, pandal and pratima never move, so the shadow map is
    // rendered once (and again when the pratima arrives) instead of every
    // frame. With a million-triangle idol that halves the per-frame work.
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = low ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x120A10);
    scene.fog = new THREE.FogExp2(0x160B10, 0.032);
    this.scene = scene;

    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 120);
    camera.position.set(0, 3.5, 11.6);           // POSES.start
    camera.lookAt(0, 3.0, 0);
    this.camera = camera;

    // ── Textures ──
    const glow = glowTexture();
    const tex = {
      alpona: alponaTexture(),
      saree: sareeTexture(),
      chalchitra: chalchitraTexture(),
      petal: petalTexture(),
      face: null,
    };
    this.glowTex = glow;
    buildMaterials(tex);

    // Image-based lighting, so metals have something to reflect.
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromEquirectangular(envTexture()).texture;
    scene.environmentIntensity = 0.85;
    pmrem.dispose();

    // ── Lighting ──
    scene.add(new THREE.HemisphereLight(0x5A3A52, 0x1A0E10, 0.55));

    const key = new THREE.SpotLight(0xFFD2A0, 95, 30, 0.62, 0.48, 1.6);
    key.position.set(2.6, 9.5, 7.5);
    key.target.position.set(0, 2.8, 0);
    key.castShadow = true;
    // Rendered once, so a sharper map costs nothing per frame.
    key.shadow.mapSize.set(low ? 1024 : 2048, low ? 1024 : 2048);
    key.shadow.bias = -0.0022;
    scene.add(key, key.target);
    this.key = key;

    const rim = new THREE.PointLight(0xFF5E4A, 30, 22, 2);
    rim.position.set(-4.5, 5.5, -3.2);
    scene.add(rim);
    this.rim = rim;

    // Cool fill is the subtlest light; every point light is paid for per
    // pixel, so weak GPUs go without it.
    if (!low) {
      const fill = new THREE.PointLight(0x6E86FF, 12, 26, 2);
      fill.position.set(-6, 3.2, 6.5);
      scene.add(fill);
    }

    // ── Contents ──
    this.pandal = makePandal(tex);
    scene.add(this.pandal);

    this.vahana = makeVahana();
    this.vahana.position.y = 0.62;
    scene.add(this.vahana);

    // Stand-in pratima, shown only until supplied art loads.
    this.durga = makeDurga(tex, glow);
    this.durga.position.y = IDOL.baseY;
    scene.add(this.durga);

    // Loaded after the pratima exists — a cached or synchronous load would
    // otherwise fire the callback before there is a face to apply it to.
    new THREE.TextureLoader().load('assets/tex-durga-face.png', (t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      const face = this.durga.userData.face;
      face.material.map = t;
      face.material.needsUpdate = true;
      face.visible = true;
    });

    this.prabhamandal = makePrabhamandal(glow);
    scene.add(this.prabhamandal);

    // Swap in real art the moment it is available.
    this.loadSuppliedIdol();

    this.lamps = [];
    for (const side of [-1, 1]) {
      const lamp = makeLampStand(glow);
      lamp.position.set(side * 3.05, 0.62, 1.9);
      scene.add(lamp);
      this.lamps.push(lamp);
    }

    // Floor lamp before the idol — lit on the eleventh parikrama
    this.floorLamp = makeLampStand(glow);
    this.floorLamp.scale.setScalar(0.46);
    this.floorLamp.position.set(0, 0.62, 3.9);
    scene.add(this.floorLamp);

    this.thali = makeThali(glow);
    this.thali.scale.setScalar(1.18);
    this.thali.visible = false;
    scene.add(this.thali);

    this.petals = makePetals(tex.petal, low ? 70 : 130);
    scene.add(this.petals);

    this.offering = makeOffering(tex.petal);
    scene.add(this.offering);

    // A brief bloom of light at the deity's feet when flowers are offered.
    this.offeringLight = new THREE.PointLight(0xFFD7A0, 0, 14, 2);
    this.offeringLight.position.set(0, 2.2, 2.0);
    scene.add(this.offeringLight);

    this.lampLights = [];
    for (const side of [-1, 1]) {
      const l = new THREE.PointLight(0xFFA246, 0, 14, 2);
      l.position.set(side * 3.05, 2.2, 2.1);
      scene.add(l);
      this.lampLights.push(l);
    }

    this.ready = true;
    this.resize();
    return this;
  },

  // Tries the real model, then a cut-out photograph, and only falls back to
  // the built-in primitives if neither is present.
  async loadSuppliedIdol() {
    const retire = (what) => {
      this.durga.visible = false;
      if (IDOL.modelIncludesVahana && this.vahana) this.vahana.visible = false;
      // Supplied idols carry their own crown and aura; the stand-in's ring
      // reads as a hoop floating over the head. Keep the backlight only.
      this.prabhamandal.userData.ring.visible = false;
      this.prabhamandal.position.set(0, 3.6, -1.1);
      // Re-bake the shadow with the real pratima in place.
      this.renderer.shadowMap.needsUpdate = true;
      this.idolReadyAt = performance.now();
      console.info(`%c🔱 Pratima: using ${what}`, 'color:#E8C96A');
    };

    // Probe first: letting the loaders 404 works, but fills the console with
    // red errors that look like a fault rather than "no art supplied yet".
    const exists = async (url) => {
      try {
        return (await fetch(url, { method: 'HEAD' })).ok;
      } catch (_) {
        return false;
      }
    };

    if (await exists(IDOL.model)) {
      try {
        this.idol = fitToPlinth(await loadIdolModel(IDOL.model, this.onIdolProgress));
        this.scene.add(this.idol);
        retire(IDOL.model);
        if (this.onIdolReady) this.onIdolReady('model');
        return 'model';
      } catch (err) {
        console.error(`Pratima: ${IDOL.model} failed to load —`, err);
      }
    }

    if (await exists(IDOL.photo)) {
      try {
        this.idol = await loadIdolPhoto(IDOL.photo);
        this.scene.add(this.idol);
        retire(IDOL.photo);
        if (this.onIdolReady) this.onIdolReady('photo');
        return 'photo';
      } catch (err) {
        console.error(`Pratima: ${IDOL.photo} failed to load —`, err);
      }
    }

    console.warn(
      `%cPratima: no ${IDOL.model} or ${IDOL.photo} found — showing the built-in
stand-in, which is primitive geometry and is not meant to pass for a real
idol. Drop a model or a cut-out photo into aarti/assets/ (see README).`,
      'color:#FFAA55',
    );
    this.idolReadyAt = performance.now();
    if (this.onIdolReady) this.onIdolReady('placeholder');
    return 'placeholder';
  },

  resize() {
    if (!this.ready) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setPixelRatio(this.perf.pr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  },

  // ── Adaptive resolution ──
  // Watches real frame times and trades pixel density for smoothness: a
  // phone that cannot hold the frame rate renders fewer pixels rather than
  // stutter. Never touches the model. Only steps down after the pratima has
  // settled (decoding her causes one-off hitches that are not the device's
  // steady state), and steps back up only with lots of headroom so it does
  // not oscillate.
  perf: { pr: 1, minPR: 0.6, maxPR: 1, acc: 0, n: 0, last: 0 },
  idolReadyAt: 0,
  adapt(now) {
    const p = this.perf;
    const dt = p.last ? now - p.last : 0;
    p.last = now;
    if (!this.idolReadyAt || now - this.idolReadyAt < 2500) return;
    if (dt <= 0 || dt > 250) return;               // tab switch, not load
    p.acc += dt;
    if (++p.n < 40) return;
    const avg = p.acc / p.n;
    p.acc = 0;
    p.n = 0;
    // Low tier is capped to ~30fps by the caller, so its budget is looser.
    const budget = this.tier === 'low' ? 42 : 24;
    let next = p.pr;
    if (avg > budget) next = Math.max(p.minPR, p.pr - 0.15);
    else if (avg < budget * 0.5) next = Math.min(p.maxPR, p.pr + 0.1);
    if (Math.abs(next - p.pr) > 0.01) {
      p.pr = next;
      this.resize();
    }
  },

  // Camera framing per phase: wide and still on the start screen, a slow
  // push toward her when the aarti begins, closer again at the finale.
  mode: 'start',
  POSES: {
    start:  { y: 3.5, z: 11.6, look: 3.0 },
    // Looks a little low so the scene sits high in frame: the thali's
    // lowest point must clear the subtitles along the bottom.
    aarti:  { y: 2.8, z: 9.4,  look: 2.3 },
    finale: { y: 2.9, z: 8.6,  look: 2.5 },
  },
  pose: { y: 3.5, z: 11.6, look: 3.0 },
  setMode(mode) { if (this.POSES[mode]) this.mode = mode; },

  // Renders a fresh frame and returns the canvas. Without
  // preserveDrawingBuffer the pixels are only valid until the current task
  // ends, so the caller must draw/read it synchronously.
  snapshot() {
    this.renderer.render(this.scene, this.camera);
    return this.canvas;
  },

  // ── Head-tracked parallax ──
  // Where the devotee's head is, as -1..1 across and up the frame plus a
  // 0..1 nearness. The camera answers, so the pandal behaves like an alcove
  // seen through the screen rather than a picture of one.
  viewer: { x: 0, y: 0, near: 0 },
  viewerTarget: { x: 0, y: 0, near: 0 },
  setViewer(x, y, near) {
    this.viewerTarget.x = Math.max(-1, Math.min(1, x));
    this.viewerTarget.y = Math.max(-1, Math.min(1, y));
    this.viewerTarget.near = Math.max(0, Math.min(1, near));
  },

  /**
   * Throw flowers at the deity's feet.
   * @param {number} spread lateral spread of the burst, in world units
   */
  pushpanjali(spread = 1.6) {
    if (!this.ready) return;
    const o = this.offering.userData;
    const pos = this.offering.geometry.attributes.position;
    const n = 46;

    for (let k = 0; k < n; k++) {
      const i = o.next % o.count;
      o.next++;

      // Launched from just in front of the devotee, aimed at the idol.
      const px = (Math.random() - 0.5) * spread * 2;
      const py = 1.4 + Math.random() * 1.2;
      const pz = 7.2 + Math.random() * 0.8;
      pos.setXYZ(i, px, py, pz);

      const aimX = (ORBIT.x - px) * 0.16;
      const aimY = 1.9 + Math.random() * 1.1;
      const aimZ = -(pz - 1.2) * 0.30;
      o.vel[i * 3] = aimX + (Math.random() - 0.5) * 0.5;
      o.vel[i * 3 + 1] = aimY * 0.5;
      o.vel[i * 3 + 2] = aimZ;
      o.life[i] = 1;
    }
    pos.needsUpdate = true;
    this.offeringPulse = 1;
  },

  offeringPulse: 0,

  /**
   * @param {number} t      milliseconds
   * @param {object} s      { glow, parikrama, total, orbitAngle, thaliVisible, finished }
   */
  frame(t, s) {
    if (!this.ready) return;
    const sec = t / 1000;
    // Motion below is tuned per 60fps frame; scale it by real elapsed time
    // so a capped or struggling device animates at the same speed.
    const k = this.lastT ? Math.min(4, (t - this.lastT) / (1000 / 60)) : 1;
    this.lastT = t;
    this.adapt(t);

    // ── Thali on its fixed circular orbit, always level ──
    // Screen-space angle has y growing downward, so negate it here to keep
    // the plate travelling the same way the devotee's hand is moving.
    this.thali.visible = s.thaliVisible;
    if (s.thaliVisible) {
      const a = s.orbitAngle;
      this.thali.position.set(
        ORBIT.x + Math.cos(a) * ORBIT.radius,
        ORBIT.y - Math.sin(a) * ORBIT.radius,
        ORBIT.z,
      );
      // Deliberately no tilt: only a slow spin about its own vertical axis.
      this.thali.rotation.set(0, sec * 0.35, 0);

      const flick = 0.85 + Math.sin(sec * 11) * 0.09 + Math.sin(sec * 27) * 0.06;
      this.thali.userData.light.intensity = 16 * flick;
      this.thali.userData.glow.scale.setScalar(1.05 * flick);
      for (let i = 0; i < this.thali.userData.wicks.length; i++) {
        const w = this.thali.userData.wicks[i];
        const f = 0.85 + Math.sin(sec * 9 + i * 1.7) * 0.15;
        w.userData.flame.scale.set(1, f, 1);
        w.userData.halo.scale.setScalar(0.40 * f);
      }
    }

    // ── Lamp wicks light one per parikrama ──
    const lit = s.finished ? TOTAL_WICKS : Math.min(TOTAL_WICKS, s.parikrama);
    for (let side = 0; side < 2; side++) {
      const wicks = this.lamps[side].userData.wicks;
      let sideLit = 0;
      for (let i = 0; i < wicks.length; i++) {
        const index = side === 0 ? i : i + 5;
        const on = index < lit;
        wicks[i].visible = on;
        if (on) {
          sideLit++;
          const f = 0.85 + Math.sin(sec * 8 + i * 2.1 + side) * 0.15;
          wicks[i].userData.flame.scale.set(1, f, 1);
        }
      }
      this.lampLights[side].intensity = sideLit * 5;
    }
    const floorLit = s.finished || s.parikrama >= TOTAL_WICKS;
    for (const w of this.floorLamp.userData.wicks) w.visible = floorLit;

    // ── Devotion warms and brightens the pandal ──
    const glow = s.glow;
    this.key.intensity = 66 + glow * 66;
    this.rim.intensity = 18 + glow * 34;
    this.scene.fog.density = 0.040 - glow * 0.016;
    const pm = this.prabhamandal.userData;
    pm.ring.material.emissiveIntensity = 0.9 + glow * 2.6 + this.pulseAmt;
    pm.halo.scale.setScalar(3.6 + glow * 1.4 + this.pulseAmt * 2);
    pm.halo.material.opacity = 0.35 + glow * 0.4;

    this.pulseAmt *= Math.pow(0.94, k);

    // ── Petals ──
    const P = this.petals;
    const pos = P.geometry.attributes.position;
    for (let i = 0; i < P.userData.count; i++) {
      let y = pos.getY(i) - P.userData.vel[i] * 0.016 * k;
      let x = pos.getX(i) + Math.sin(sec * 0.8 + P.userData.phase[i]) * 0.006 * k;
      if (y < -0.2) { y = 10.0 + Math.random() * 2; x = (Math.random() - 0.5) * 13; }
      pos.setY(i, y);
      pos.setX(i, x);
    }
    pos.needsUpdate = true;

    // ── Offered flowers: ballistic, then they settle and fade ──
    const O = this.offering.userData;
    const opos = this.offering.geometry.attributes.position;
    let anyAlive = false;
    for (let i = 0; i < O.count; i++) {
      if (O.life[i] <= 0) continue;
      anyAlive = true;
      O.vel[i * 3 + 1] -= 0.055 * k;                // gravity
      opos.setXYZ(i,
        opos.getX(i) + O.vel[i * 3] * 0.05 * k,
        opos.getY(i) + O.vel[i * 3 + 1] * 0.05 * k,
        opos.getZ(i) + O.vel[i * 3 + 2] * 0.05 * k);

      // Land on the plinth and stop.
      if (opos.getY(i) <= IDOL.baseY + 0.05) {
        opos.setY(i, IDOL.baseY + 0.05);
        O.vel[i * 3] *= 0.4;
        O.vel[i * 3 + 1] = 0;
        O.vel[i * 3 + 2] *= 0.4;
        O.life[i] -= 0.004 * k;                     // linger, then fade
      } else {
        O.life[i] -= 0.0015 * k;
      }
      if (O.life[i] <= 0) opos.setY(i, -100);
    }
    if (anyAlive) opos.needsUpdate = true;

    this.offeringPulse *= Math.pow(0.93, k);
    this.offeringLight.intensity = this.offeringPulse * 50;

    // ── Camera: phase pose + head-tracked parallax + slow idle drift ──
    const v = this.viewer;
    const ease = (r) => 1 - Math.pow(1 - r, k);
    v.x += (this.viewerTarget.x - v.x) * ease(0.055);
    v.y += (this.viewerTarget.y - v.y) * ease(0.055);
    v.near += (this.viewerTarget.near - v.near) * ease(0.045);

    // A slow dolly between poses — about three seconds — reads as walking
    // up to the pratima rather than a cut.
    const goal = this.POSES[this.mode];
    const pz = this.pose;
    const e = ease(0.018);
    pz.y += (goal.y - pz.y) * e;
    pz.z += (goal.z - pz.z) * e;
    pz.look += (goal.look - pz.look) * e;

    const driftX = Math.sin(sec * 0.13) * 0.14;
    const driftY = Math.sin(sec * 0.17) * 0.07;
    this.camera.position.set(
      v.x * 2.3 + driftX,
      pz.y + v.y * 1.15 + driftY,
      pz.z - v.near * 2.6,
    );
    // Looking at a fixed point while the eye moves is what sells the depth:
    // near geometry slides against far geometry exactly as it would in life.
    this.camera.lookAt(0, pz.look, 0);

    this.renderer.render(this.scene, this.camera);
  },

  pulseAmt: 0,
  pulse() { this.pulseAmt = 1.4; },
};

export default Scene3D;
