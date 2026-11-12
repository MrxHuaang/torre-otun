import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import { createApartment } from './apartment.js';
import { createMinimap } from './extras.js';
import { createIntro } from './intro.js';
import { createInk } from './ink.js';
import { FLOORS, SEPARACION, buildUnits, cop, planSVG } from './data.js';

gsap.registerPlugin(ScrollTrigger);

// El viaje siempre empieza arriba, aunque se recargue a mitad de camino.
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
window.scrollTo(0, 0);

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const INK = 0x111111;
const GOLD = 0x927f4e;   // ocre
const RED = 0xb3261e;
const BG = 0xf6f5f1;
const DARK = 0xffffff; // cara de papel

const FH = 3.2;     // altura de piso
const BASE = 8;     // altura del podio
const GAP = 2.6;    // separación entre pisos al "explotar"
const TOP = BASE + FLOORS * FH;

/* ------------------------------------------------------------------ */
/* Utilidades de geometría: todo es línea, al estilo plano art déco    */
/* ------------------------------------------------------------------ */

function pushBox(arr, cx, cy, cz, w, h, d) {
  const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - h / 2, y1 = cy + h / 2, z0 = cz - d / 2, z1 = cz + d / 2;
  const c = [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]];
  const e = [0, 1, 1, 2, 2, 3, 3, 0, 4, 5, 5, 6, 6, 7, 7, 4, 0, 4, 1, 5, 2, 6, 3, 7];
  for (const i of e) arr.push(...c[i]);
}
const pushLine = (arr, a, b) => arr.push(a[0], a[1], a[2], b[0], b[1], b[2]);

function lines(arr, color, opacity) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
  const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
  l.layers.set(1);
  return l;
}
function solid(w, h, d, color = DARK) {
  return new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshLambertMaterial({ color, transparent: true }),
  );
}
function circle(arr, r, y, seg = 96, from = 0, to = Math.PI * 2, plane = 'xz') {
  for (let i = 0; i < seg; i++) {
    const a = from + ((to - from) * i) / seg, b = from + ((to - from) * (i + 1)) / seg;
    if (plane === 'xz') pushLine(arr, [Math.cos(a) * r, y, Math.sin(a) * r], [Math.cos(b) * r, y, Math.sin(b) * r]);
    else pushLine(arr, [Math.cos(a) * r, y + Math.sin(a) * r, 0], [Math.cos(b) * r, y + Math.sin(b) * r, 0]);
  }
}

/* ------------------------------------------------------------------ */
/* Escena exterior                                                     */
/* ------------------------------------------------------------------ */

const canvas = $('#stage');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
// Teléfonos y tabletas: sin multimuestreo y con resolución contenida. El trazo se calcula por píxel real,
// así que sigue nítido; si aun así el equipo no da el ritmo, adapt() baja un escalón.
const MOBILE = window.matchMedia('(pointer: coarse)').matches;
const quality = { dpr: Math.min(window.devicePixelRatio || 1, MOBILE ? 1.5 : 2), acc: 0, n: 0 };
renderer.setPixelRatio(quality.dpr);
renderer.setClearColor(BG);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;   // la tinta cuantiza el tono: no hace falta sombra más cara
renderer.shadowMap.autoUpdate = false;
const ink = createInk(renderer, { paper: BG, ink: INK, ochre: 0x9c8b5e, msaa: !MOBILE });
// Estilo tinta por defecto. Agrega ?limpio a la URL para ver la maqueta sin el pase de tinta.
const INKMODE = !new URLSearchParams(location.search).has('limpio');
const apt = createApartment();
const minimap = createMinimap($('#minimap'));

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(BG, 150, 460);
scene.add(new THREE.AmbientLight(0xffffff, 1.2));
{
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(-60, 90, 70);
  scene.add(key);
}
const camera = new THREE.PerspectiveCamera(38, 1, 0.5, 1200);
const look = new THREE.Vector3();

const UNITS = buildUnits();
const tower = new THREE.Group();
scene.add(tower);

// Podio
const podiumFace = solid(30, BASE, 22);
podiumFace.position.y = BASE / 2;
tower.add(podiumFace);
{
  const a = [];
  pushBox(a, 0, BASE / 2, 0, 30, BASE, 22);
  for (let x = -15; x <= 15; x += 1.25) {
    pushLine(a, [x, 0, 11.05], [x, BASE, 11.05]);
    pushLine(a, [x, 0, -11.05], [x, BASE, -11.05]);
  }
  for (let z = -11; z <= 11; z += 1.1) {
    pushLine(a, [15.05, 0, z], [15.05, BASE, z]);
    pushLine(a, [-15.05, 0, z], [-15.05, BASE, z]);
  }
  tower.add(lines(a, INK, 0.5));
  // Portal de acceso escalonado
  const g = [];
  [[7, 6.4], [5.4, 5.6], [3.8, 4.8]].forEach(([w, h], i) => pushBox(g, 0, h / 2, 11.2 + i * 0.12, w, h, 0.01));
  tower.add(lines(g, GOLD, 0.95));
}

const schematicPodium = tower.children.slice();

// Pisos
const floors = [];
const mullionMat = new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0.22 });
const mullionGeo = (() => {
  const a = [];
  for (let x = -12; x <= 12.01; x += 1.5) {
    pushLine(a, [x, 0.3, 8.06], [x, FH, 8.06]);
    pushLine(a, [x, 0.3, -8.06], [x, FH, -8.06]);
  }
  for (let z = -8; z <= 8.01; z += 1.6) {
    pushLine(a, [12.06, 0.3, z], [12.06, FH, z]);
    pushLine(a, [-12.06, 0.3, z], [-12.06, FH, z]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(a, 3));
  return g;
})();
const unitGeo = new THREE.BoxGeometry(11.7, 2.8, 7.7);
const unitEdgeGeo = new THREE.EdgesGeometry(unitGeo);
const slabGeo = new THREE.BoxGeometry(24.8, 0.3, 16.8);
const slabEdgeGeo = new THREE.EdgesGeometry(slabGeo);
const slabMat = new THREE.MeshLambertMaterial({ color: 0xd8d8d8, transparent: true });
const slabs = [];
const slabEdgeMat = new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0.6 });
const unitMeshes = [];

for (let fi = 0; fi < FLOORS; fi++) {
  const g = new THREE.Group();
  const slab = new THREE.Mesh(slabGeo, slabMat);
  slab.position.y = 0.15;
  const slabEdge = new THREE.LineSegments(slabEdgeGeo, slabEdgeMat);
  slabEdge.position.y = 0.15;
  const mull = new THREE.LineSegments(mullionGeo, mullionMat);
  slabEdge.layers.set(1); mull.layers.set(1);
  slabs.push(slab);
  g.add(slab, slabEdge, mull);
  for (const u of UNITS.filter((u) => u.fi === fi)) {
    const mesh = new THREE.Mesh(unitGeo, new THREE.MeshLambertMaterial({ color: DARK, transparent: true }));
    mesh.position.set(u.x, 1.7, u.z);
    const edge = new THREE.LineSegments(unitEdgeGeo, new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0.8 }));
    edge.position.copy(mesh.position);
    edge.layers.set(1);
    mesh.userData.unit = u;
    u.mesh = mesh; u.edge = edge; u.fo = 1; u.eo = 0.8;
    unitMeshes.push(mesh);
    g.add(mesh, edge);
  }
  g.userData.sch = g.children.slice();
  tower.add(g);
  floors.push(g);
}

// Corona escalonada
const crown = new THREE.Group();
{
  const a = [];
  const tiers = [[21, 3, 14, 1.5], [15.5, 3, 10.4, 4.5], [10, 3.6, 6.8, 7.8], [5, 3, 3.6, 11.1]];
  for (const [w, h, d, y] of tiers) {
    const m = solid(w, h, d);
    m.position.y = y;
    crown.add(m);
    pushBox(a, 0, y, 0, w, h, d);
    for (let x = -w / 2; x <= w / 2 + 0.01; x += w / 8) pushLine(a, [x, y - h / 2, d / 2 + 0.03], [x, y + h / 2, d / 2 + 0.03]);
  }
  crown.add(lines(a, INK, 0.75));
  const s = [];
  pushLine(s, [0, 12.6, 0], [0, 26, 0]);
  [-1, 1].forEach((k) => { pushLine(s, [k * 1.2, 12.6, 0], [0, 20, 0]); pushLine(s, [0, 12.6, k * 1.2], [0, 20, 0]); });
  crown.add(lines(s, GOLD, 1));
}
tower.add(crown);
const schematicCrown = crown.children.slice();

// Modelos detallados (Blender → glTF). Mientras cargan se ve la maqueta esquemática;
// la maqueta también vuelve en el modo de exploración, donde cada apartamento se pinta por estado.
const detailMats = {
  conc: new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true }),
  glass: new THREE.MeshLambertMaterial({ color: 0x9aa4aa, transparent: true }),   // gris medio: aguada, sin trama
  frame: new THREE.MeshLambertMaterial({ color: 0x1c1c1c, transparent: true }),
  wood: new THREE.MeshLambertMaterial({ color: 0xb08a5e, transparent: true }),
  green: new THREE.MeshLambertMaterial({ color: 0x6f8a66, transparent: true }),
  rail: new THREE.MeshLambertMaterial({ color: 0xe6ecef, transparent: true }),
  roof: new THREE.MeshLambertMaterial({ color: 0xb4623f, side: THREE.DoubleSide }),   // tejas: cálido, la tinta lo pinta del acabado
  road: new THREE.MeshLambertMaterial({ color: 0xd6d6d6 }),
};
for (const [key, m] of Object.entries(detailMats)) m.userData.key = key;   // para recolorear el barrio en la versión realista
const detail = { ready: false, floors: [], solids: [] };
const schematicCity = [];   // cubos provisionales del barrio; se retiran al cargar el barrio detallado
let schMode = true;
{
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);   // los modelos van comprimidos con meshopt
  const loadModel = (name) => new Promise((res, rej) => loader.load(`/models/${name}.glb`, (g) => {
    g.scene.traverse((o) => {
      if (!o.isMesh) return;
      // En los pisos la carpintería fina se omite: a distancia de torre solo ensucia el dibujo.
      if (name === 'piso' && o.material.name === 'frame') o.visible = false;
      o.material = detailMats[o.material.name] || detailMats.conc;
    });
    res(g.scene);
  }, undefined, rej));
  Promise.all(['piso', 'podio', 'corona'].map(loadModel)).then(([piso, podio, corona]) => {
    floors.forEach((f) => { const d = piso.clone(); d.visible = false; f.add(d); detail.floors.push(d); });
    schematicPodium.forEach((o) => tower.remove(o));
    schematicCrown.forEach((o) => crown.remove(o));
    tower.add(podio);
    crown.add(corona);
    detail.solids.push(podio, corona);
    detail.ready = true;
  }).catch((err) => console.warn('Modelos detallados no disponibles', err));
  loadModel('entorno').then((barrio) => {
    schematicCity.forEach((o) => scene.remove(o));
    scene.add(barrio);
    apt.setCity(barrio);   // el mismo barrio se ve por las ventanas del apartamento
  }).catch((err) => console.warn('Barrio detallado no disponible', err));
}

// Estructura (solo visible en rayos X)
const structMat = new THREE.LineBasicMaterial({ color: RED, transparent: true, opacity: 0 });
// El esqueleto solo se dibuja por encima de este plano: aparece a medida que la torre se desarma.
const structClip = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
structMat.clippingPlanes = [structClip];
renderer.localClippingEnabled = true;
{
  const a = [];
  const xs = [-12, -6, 0, 6, 12], zs = [-8, 0, 8];
  for (const x of xs) for (const z of zs) {
    pushBox(a, x, (TOP - 3) / 2, z, 0.7, TOP + 3, 0.7);      // columna
    pushBox(a, x, -10.5, z, 1, 15, 1);                        // pilote
    pushBox(a, x, -18.4, z, 2.2, 0.8, 2.2);                   // punta
  }
  pushBox(a, 0, -2.25, 0, 27.5, 1.5, 19.5);                   // losa de cimentación
  pushBox(a, 0, (TOP - 3) / 2, 0, 5, TOP + 3, 4);             // núcleo de muros
  for (let i = 0; i <= FLOORS; i++) {
    const y = BASE + i * FH;
    for (const z of zs) pushLine(a, [-12, y, z], [12, y, z]);
    for (const x of xs) pushLine(a, [x, y, -8], [x, y, 8]);
  }
  for (let i = 0; i < FLOORS; i += 2) {                       // disipadores en X
    const y0 = BASE + i * FH, y1 = y0 + FH * 2;
    for (const z of [8, -8]) for (const [xa, xb] of [[-12, -6], [6, 12]]) {
      pushLine(a, [xa, y0, z], [xb, y1, z]); pushLine(a, [xb, y0, z], [xa, y1, z]);
    }
    for (const x of [12, -12]) { pushLine(a, [x, y0, -8], [x, y1, 0]); pushLine(a, [x, y1, 0], [x, y0, 8]); }
  }
  for (const y of [-6, -12, -18.8]) {                         // estratos de suelo
    for (let x = -60; x < 60; x += 6) { pushLine(a, [x, y, 22], [x + 3, y, 22]); pushLine(a, [x, y, -22], [x + 3, y, -22]); }
    for (let z = -22; z < 22; z += 6) { pushLine(a, [-60, y, z], [-60, y, z + 3]); pushLine(a, [60, y, z], [60, y, z + 3]); }
  }
  const st = new THREE.LineSegments(
    new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(a, 3)), structMat);
  st.layers.set(1);
  tower.add(st);
}

// Suelo: trazado radial
{
  const a = [];
  for (const r of [24, 40, 62, 90, 124, 164, 210, 262]) circle(a, r, 0, 128);
  for (let i = 0; i < 24; i++) {
    const t = (i / 24) * Math.PI * 2;
    pushLine(a, [Math.cos(t) * 24, 0, Math.sin(t) * 24], [Math.cos(t) * 262, 0, Math.sin(t) * 262]);
  }
  scene.add(lines(a, INK, 0.16));
}

// Ciudad
{
  const rnd = (() => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
  const a = [];
  const boxes = [];
  for (let x = -196; x <= 196; x += 14) for (let z = -196; z <= 196; z += 14) {
    const d = Math.hypot(x, z);
    if (d < 84 || d > 200 || rnd() < 0.34) continue;
    const w = 6 + rnd() * 5, dp = 6 + rnd() * 5, h = 2.5 + rnd() * rnd() * (26 - d * 0.09);
    const px = x + (rnd() - 0.5) * 3, pz = z + (rnd() - 0.5) * 3;
    boxes.push([px, h / 2, pz, w, h, dp]);
    pushBox(a, px, h / 2, pz, w, h, dp);
  }
  const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff }), boxes.length);
  const m = new THREE.Matrix4();
  boxes.forEach(([x, y, z, w, h, d], i) => { m.makeScale(w, h, d).setPosition(x, y, z); inst.setMatrixAt(i, m); });
  const cityLines = lines(a, INK, 0.2);
  schematicCity.push(inst, cityLines);
  scene.add(inst, cityLines);
}

// Cordillera
function ridge(radius, base, amp, seed, opacity, color = INK) {
  const a = [];
  const N = 220;
  const hAt = (i) => {
    const t = (i / N) * Math.PI * 2;
    return base + amp * (0.5 + 0.5 * Math.sin(t * 5 + seed)) * (0.6 + 0.4 * Math.sin(t * 13 + seed * 2)) + amp * 0.25 * Math.sin(t * 31 + seed);
  };
  for (let i = 0; i < N; i++) {
    const t0 = (i / N) * Math.PI * 2, t1 = ((i + 1) / N) * Math.PI * 2;
    pushLine(a, [Math.cos(t0) * radius, hAt(i), Math.sin(t0) * radius], [Math.cos(t1) * radius, hAt(i + 1), Math.sin(t1) * radius]);
  }
  const l = lines(a, color, opacity);
  l.material.fog = false;
  return l;
}
scene.add(ridge(330, 14, 46, 1.3, 0.32), ridge(390, 26, 70, 4.1, 0.2), ridge(450, 40, 96, 2.2, 0.12));

// Nubes: manchas de papel que la tinta contornea. Están lejos y giran despacio alrededor.
const clouds = new THREE.Group();
{
  const mat = new THREE.MeshBasicMaterial({ color: BG });
  const rndc = (() => { let s = 23; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
  for (let i = 0; i < 9; i++) {
    const g = new THREE.Group();
    const n = 5 + Math.floor(rndc() * 4), w = 26 + rndc() * 30;
    for (let k = 0; k < n; k++) {
      const c = new THREE.Mesh(new THREE.CircleGeometry(7 + rndc() * 9, 28), mat);
      c.position.set((k / (n - 1) - 0.5) * w, (rndc() - 0.3) * 7, 0);
      g.add(c);
    }
    const base = new THREE.Mesh(new THREE.PlaneGeometry(w * 1.1, 9), mat);
    base.position.y = -4;
    g.add(base);
    const a = (i / 9) * Math.PI * 2 + rndc() * 0.5, r = 250 + rndc() * 70;
    g.position.set(Math.cos(a) * r, 78 + rndc() * 62, Math.sin(a) * r);
    clouds.add(g);
  }
}
scene.add(clouds);

// Sol art déco, siempre detrás de la torre
const sun = new THREE.Group();
{
  const a = [];
  for (let i = 0; i <= 44; i++) {
    const t = (i / 44) * Math.PI;
    const r0 = 34, r1 = i % 2 ? 210 : 300;
    pushLine(a, [Math.cos(t) * r0, Math.sin(t) * r0, 0], [Math.cos(t) * r1, Math.sin(t) * r1, 0]);
  }
  for (const r of [34, 58, 86]) circle(a, r, 0, 64, 0, Math.PI, 'xy');
  const l = lines(a, GOLD, 0.42);
  l.material.fog = false;
  sun.add(l);
}
scene.add(sun);

// Polvo dorado
const dust = (() => {
  const N = 420, p = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { p[i * 3] = (Math.random() - 0.5) * 240; p[i * 3 + 1] = Math.random() * 110; p[i * 3 + 2] = (Math.random() - 0.5) * 240; }
  const g = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(p, 3));
  const pts = new THREE.Points(g, new THREE.PointsMaterial({ color: GOLD, size: 0.5, transparent: true, opacity: 0.7, depthWrite: false }));
  pts.layers.set(1);
  scene.add(pts);
  return pts;
})();


/* ------------------------------------------------------------------ */
/* Estado                                                              */
/* ------------------------------------------------------------------ */

const TL = 9.5;            // duración del viaje con scroll (1 unidad = 130vh, ver index.html)
const TOUR_SECONDS = 80;   // lo que tarda el recorrido interior completo

const state = {
  px: 70, py: 38, pz: 96, tx: 0, ty: 31, tz: 0,
  xray: 0, explode: 0, labels: 0, intro: 1, build: 0,
  shift: 0.2,   // la torre se corre a un lado para no quedar debajo del texto
};
const ex = { on: false, exiting: false, explode: 0, hover: null, selected: null, floor: null };
const walk = { on: false, busy: false, t: 0, playing: false, seeking: false, real: false, ended: false, key: -1, veil: 0, st: 0, lookX: 0, lookY: 0, dragX: 0, dragY: 0, shadows: false };
const mouse = { x: 0, y: 0, sx: 0, sy: 0 };
const view = { w: 1, h: 1 };

const controls = new OrbitControls(camera, canvas);
controls.enabled = false;
controls.enableDamping = true;
controls.enablePan = false;
controls.minDistance = 40;
controls.maxDistance = 190;
controls.minPolarAngle = 0.5;
controls.maxPolarAngle = 1.62;

// Etiquetas del lugar
const PLACES = [
  { t: 'Parque El Lago', d: '6 min', p: [-112, 2, 44] },
  { t: 'Av. Circunvalar', d: '2 min', p: [74, 2, 92] },
  { t: 'Aeropuerto Matecaña', d: '15 min', p: [150, 2, -92] },
  { t: 'Viaducto', d: '9 min', p: [-64, 2, -140] },
].map((pl) => {
  const el = document.createElement('p');
  el.innerHTML = `${pl.t}<small>${pl.d}</small>`;
  $('#labels').appendChild(el);
  return { el, v: new THREE.Vector3(...pl.p) };
});
const proj = new THREE.Vector3();

// Anotaciones técnicas. show(t) recibe el tiempo del viaje.
const ramp = (t, a, b, c, d) => Math.max(0, Math.min(1, (t - a) / (b - a), (d - t) / (d - c)));
const NOTES = [
  { t: 'Celosías en madera', p: [12.4, 34, 0], side: 'r', show: (t) => ramp(t, 0.15, 0.5, 1.1, 1.4) * (1 - state.intro) },
  { t: 'Terraza con pérgola', p: [-14, 10.5, 9], side: 'l', show: (t) => ramp(t, 0.15, 0.5, 1.1, 1.4) * (1 - state.intro) },
  { t: 'Núcleo de muros', p: [0, 40, 0], side: 'l', show: () => THREE.MathUtils.smoothstep(state.xray, 0.75, 0.95) },
  { t: 'Disipadores en X', p: [12, 24, 8], side: 'r', show: () => THREE.MathUtils.smoothstep(state.xray, 0.75, 0.95) },
  { t: 'Pilotes a 18 m', p: [-12, -12, 8], side: 'l', show: () => THREE.MathUtils.smoothstep(state.xray, 0.92, 1) },
  { t: 'Piso 14 · Tipo A', p: [-12.4, 73.2, 8], side: 'l', show: (t) => ramp(t, 8.2, 8.45, 8.75, 8.95) },
].map((n) => {
  const el = document.createElement('p');
  el.className = 'note ' + n.side;
  el.innerHTML = `<svg viewBox="0 0 60 40" aria-hidden="true"><path d="M56 6C40 4 20 10 6 32M6 32l2-11M6 32l11-3"/></svg><span>${n.t}</span>`;
  $('#labels').appendChild(el);
  return { ...n, el, v: new THREE.Vector3(...n.p) };
});
const spin = { target: 0 };

// El lienzo mide el alto máximo de la ventana (100lvh): en móvil, la barra del navegador
// aparece y desaparece sin obligar a rehacer las texturas en cada gesto.
function resize(force) {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h || (force !== true && w === view.w && h === view.h)) return;
  view.w = w; view.h = h;
  renderer.setPixelRatio(quality.dpr);
  renderer.setSize(w, h, false);
  ink.setSize(w, h, quality.dpr);
  apt.resize(w, h);
  camera.fov = h > w ? 62 : 38;   // en vertical se abre el campo para que la torre quepa
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// Calidad adaptativa: si el equipo no sostiene el ritmo, baja la resolución un escalón.
function adapt(dt) {
  if (document.hidden || state.intro > 0.02 || walk.busy) return;
  quality.acc += dt; quality.n++;
  if (quality.n < 45) return;
  const avg = quality.acc / quality.n;
  quality.acc = 0; quality.n = 0;
  if (avg > 0.022 && quality.dpr > 0.75) {
    quality.dpr = Math.max(0.75, quality.dpr - 0.25);
    resize(true);
  }
}

function refreshUnits() {
  const x = state.xray;
  for (const u of UNITS) {
    let face = DARK, fo = 1 - 0.96 * x, eo = 0.8 - 0.66 * x;
    if (ex.on) {
      if (u.status === 'disponible') { face = 0xcdb878; eo = 0.9; }
      else if (u.status === 'separado') { face = 0xffffff; eo = 0.6; }
      else { face = 0x7c7c7c; eo = 0.25; }
      if (ex.floor !== null && u.fi !== ex.floor) { fo = 0.05; eo *= 0.14; }
      if (u === ex.hover || u === ex.selected) { face = RED; fo = 0.96; eo = 1; }
    }
    u.fo += (fo - u.fo) * 0.16;
    u.eo += (eo - u.eo) * 0.16;
    const m = u.mesh.material;
    m.color.setHex(face);
    m.opacity = u.fo;
    m.depthWrite = u.fo > 0.5;
    u.edge.material.opacity = u.eo;
  }
  const fade = 1 - 0.95 * x;
  structMat.opacity = Math.min(1, x * 6);
  mullionMat.opacity = (ex.on ? 0.08 : 0.22) * (1 - x);
  slabMat.opacity = fade; slabMat.depthWrite = fade > 0.5;
  podiumFace.material.opacity = fade; podiumFace.material.depthWrite = fade > 0.5;
}

// En el pase de contornos se ocultan las mallas que están desvanecidas.
function auxVisibility(on) {
  const solidOk = !on || state.xray < 0.6;
  for (const u of UNITS) u.mesh.visible = schMode && (!on || u.fo > 0.35);
  for (const sl of slabs) sl.visible = schMode && solidOk;
  podiumFace.visible = !detail.ready && solidOk;
  for (const d of detail.floors) d.visible = !schMode;
}

const veil = $('#veil'), spinBadge = $('#spinBadge');
let viewShift = 0.2, spun = false, last = performance.now(), gateFrames = 0;

/* ------------------------------------------------------------------ */
/* Cuadro a cuadro                                                     */
/* ------------------------------------------------------------------ */

function render() {
  const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  // Con la portada encima no se ve la escena: se dibuja 1 de cada 30 cuadros, solo para dejar todo compilado.
  if (state.intro > 0.999 && ++gateFrames % 30) return;
  adapt(dt);
  mouse.sx += (mouse.x - mouse.sx) * 0.05;
  mouse.sy += (mouse.y - mouse.sy) * 0.05;
  veil.style.setProperty('--v', walk.veil);

  if (walk.on) return renderWalk(dt);

  const e = ex.on ? ex.explode : state.explode;
  // Capítulo de estructura: la torre se desarma de arriba hacia abajo y deja ver el esqueleto.
  const peel = THREE.MathUtils.clamp((state.xray - 0.05) / 0.65, 0, 1);
  const bt = Math.min(state.build, 1 - peel) * (FLOORS + 4);
  floors.forEach((f, i) => {
    const l = THREE.MathUtils.clamp(bt - i, 0, 1), k = 1 - Math.pow(1 - l, 3);
    f.visible = l > 0;
    f.scale.y = Math.max(0.001, k);
    f.position.y = BASE + i * FH + i * GAP * e + (1 - k) * 9;
  });
  {
    const l = THREE.MathUtils.clamp(bt - FLOORS - 1, 0, 1), k = 1 - Math.pow(1 - l, 3);
    crown.visible = l > 0;
    crown.scale.y = Math.max(0.001, k);
    crown.position.y = TOP + FLOORS * GAP * e + (1 - k) * 14;
  }
  {
    const low = THREE.MathUtils.smoothstep(state.xray, 0.7, 1);          // al final baja hasta los pilotes
    structClip.constant = -((BASE + Math.min(bt, FLOORS) * FH) * (1 - low) - 26 * low);
    const podio = detail.solids[0];
    if (podio) {
      const k = 1 - THREE.MathUtils.smoothstep(state.xray, 0.68, 0.9);
      podio.scale.y = Math.max(0.001, k);
      podio.visible = k > 0.01;
    }
  }
  const sch = ex.on || ex.exiting || !detail.ready;
  if (sch !== schMode) {
    schMode = sch;
    for (const f of floors) for (const o of f.userData.sch) o.visible = sch;
    for (const d of detail.floors) d.visible = !sch;
  }
  refreshUnits();

  tower.rotation.y += (spin.target - tower.rotation.y) * 0.1;
  const free = ex.on || ex.exiting;
  if (free) {
    controls.update();
  } else {
    const k = 1 + state.intro * 1.3;
    camera.position.set(state.px * k + mouse.sx * 8, state.py * k + state.intro * 40 - mouse.sy * 5, state.pz * k);
    look.set(state.tx, state.ty, state.tz);
    camera.lookAt(look);
  }
  const w = view.w, h = view.h, portrait = h > w;
  {
    // Encuadre: en el viaje la torre va a un lado; al explorar, vuelve al centro. En vertical sube y deja el texto abajo.
    viewShift += ((free || portrait ? 0 : state.shift) - viewShift) * 0.06;
    camera.setViewOffset(w, h, -viewShift * w, portrait && !free ? h * 0.2 : 0, w, h);
  }

  clouds.rotation.y += dt * 0.006;
  for (const c of clouds.children) c.quaternion.copy(camera.quaternion);

  // Sol detrás de la torre respecto a la cámara
  const a = Math.atan2(camera.position.x, camera.position.z);
  sun.position.set(-Math.sin(a) * 300, -6, -Math.cos(a) * 300);
  sun.rotation.y = a;

  const p = dust.geometry.attributes.position;
  for (let i = 0; i < p.count; i++) { let y = p.getY(i) + dt * 1.4; if (y > 110) y = 0; p.setY(i, y); }
  p.needsUpdate = true;
  dust.rotation.y += dt * 0.01;

  const place = (el, v) => { el.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px)`; };
  for (const pl of PLACES) {
    proj.copy(pl.v).project(camera);
    const vis = proj.z < 1 && !ex.on ? state.labels : 0;
    pl.el.style.opacity = vis;
    if (vis > 0.01) { place(pl.el, proj); pl.el.style.transform += ' translateY(-50%)'; }
  }

  if (INKMODE) ink.render(scene, camera, { fadeA: 210, fadeB: 470, lines: true, aux: auxVisibility });
  else { camera.layers.enableAll(); renderer.render(scene, camera); }

  {
    // Sello "arrastre para girar": junto a la base de la torre, solo mientras no la hayas girado.
    const show = !spun && !free && state.intro < 0.05 && state.xray < 0.05 && state.explode < 0.05 && state.labels < 0.05;
    spinBadge.classList.toggle('on', show);
    if (show) place(spinBadge, proj.set(-17, 9, 13).applyMatrix4(tower.matrixWorld).project(camera));
  }
  {
    // Anotaciones: cada una aparece en su capítulo y sigue a la torre aunque la gires.
    const t = tl.scrollTrigger ? tl.scrollTrigger.progress * TL : 0;
    for (const n of NOTES) {
      const op = free ? 0 : n.show(t);
      if (op > 0.01) place(n.el, proj.copy(n.v).applyMatrix4(tower.matrixWorld).project(camera));
      n.el.style.opacity = op > 0.01 && proj.z < 1 ? op : 0;
    }
  }
}
gsap.ticker.add(render);

/* ------------------------------------------------------------------ */
/* Scroll y línea de tiempo                                            */
/* ------------------------------------------------------------------ */

ScrollTrigger.config({ ignoreMobileResize: true });
const lenis = new Lenis({ lerp: 0.08 });
lenis.on('scroll', ScrollTrigger.update);
gsap.ticker.add((t) => lenis.raf(t * 1000));
gsap.ticker.lagSmoothing(0);
lenis.stop();

const thumb = $('#scrollThumb');
const tl = gsap.timeline({
  defaults: { ease: 'power2.inOut' },
  scrollTrigger: {
    trigger: '#journey', start: 'top top', end: 'bottom bottom', scrub: 1.2,
    onUpdate: (s) => { thumb.style.top = `${s.progress * 100}%`; },
  },
});
const cam = (px, py, pz, tx, ty, tz) => ({ px, py, pz, tx, ty, tz });

tl
  // I — Torre (0 a 1.5)
  .to(state, { ...cam(44, 30, 104, 0, 31, 0), duration: 1.4, ease: 'none' }, 0)
  // II — Lugar: vista aérea (1.5 a 3.5)
  .to(state, { ...cam(-70, 128, 74, 0, 4, 0), duration: 1.1 }, 1.4)
  .to(state, { labels: 1, duration: 0.4 }, 2.1)
  .to(state, { ...cam(-98, 112, 18, 0, 4, 0), duration: 0.8, ease: 'none' }, 2.5)
  .to(state, { labels: 0, duration: 0.3 }, 3.1)
  // III — Estructura: la torre se abre hasta los pilotes (3.5 a 6)
  .to(state, { shift: -0.2, duration: 1.0 }, 3.3)
  .to(state, { ...cam(46, 12, 54, 0, 24, 0), duration: 1.1 }, 3.3)
  .to(state, { xray: 1, duration: 1 }, 3.6)
  .to(state, { ...cam(40, 15, 58, 0, 22, 0), duration: 0.5, ease: 'none' }, 4.5)
  .to(state, { ...cam(38, -1, 46, 0, -9, 0), duration: 0.8 }, 5.0)
  // IV — Apartamentos: los pisos se separan (6 a 8)
  .to(state, { shift: 0.2, duration: 0.9 }, 5.85)
  .to(state, { ...cam(12, 40, 100, 0, 32, 0), duration: 0.9 }, 5.85)
  .to(state, { xray: 0, duration: 0.7 }, 5.85)
  .to(state, { explode: 1, duration: 0.9 }, 6.6)
  .to(state, { ...cam(-14, 58, 156, 0, 50, 0), duration: 0.75 }, 6.65)
  // V — Por dentro: la cámara se acerca al piso 14, el apartamento que se recorre (8 a 9.5)
  .to(state, { ...cam(-34, 80, 62, -4, 72, 2), duration: 0.8 }, 7.85)
  // VI — Cierre
  .to(state, { explode: 0, duration: 0.6 }, 8.85)
  .to(state, { ...cam(-48, 18, 96, 0, 36, 0), duration: 0.65 }, 8.85);

// Barra de avance propia: cada capítulo es una parada; se puede hacer clic o arrastrar.
const chapters = $$('.chapter');
const idx = $$('.scroller a');
const scroller = $('#scroller');
const scrollMax = () => document.documentElement.scrollHeight - window.innerHeight;
function layoutScroller() {
  const max = scrollMax();
  idx.forEach((a, i) => { a.style.top = `${Math.min(100, (chapters[i].offsetTop / max) * 100)}%`; });
}
layoutScroller();
window.addEventListener('resize', layoutScroller);
{
  let dragging = false;
  const seek = (ev, immediate) => {
    const r = $('.track', scroller).getBoundingClientRect();
    const k = Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height));
    lenis.scrollTo(k * scrollMax(), immediate ? { immediate: true } : { duration: 1.2 });
  };
  scroller.addEventListener('pointerdown', (ev) => {
    if (ev.target.closest('a') || ex.on) return;
    dragging = true;
    scroller.setPointerCapture(ev.pointerId);
    seek(ev, false);
  });
  scroller.addEventListener('pointermove', (ev) => { if (dragging) seek(ev, true); });
  scroller.addEventListener('pointerup', () => { dragging = false; });
}
chapters.forEach((sec, i) => {
  ScrollTrigger.create({
    trigger: sec, start: 'top 55%', end: 'bottom 55%',
    onToggle: (s) => { if (s.isActive) idx.forEach((a, j) => a.classList.toggle('on', j === i)); },
  });
});

// Revelado de textos
const io = new IntersectionObserver(
  (entries) => entries.forEach((en) => en.target.classList.toggle('in', en.isIntersecting)),
  { threshold: 0.3 },
);

$$('[data-scroll]').forEach((a) =>
  a.addEventListener('click', (ev) => {
    ev.preventDefault();
    if (!ex.on && !walk.on) lenis.scrollTo(a.getAttribute('href'), { duration: 2 });
  }));

/* ------------------------------------------------------------------ */
/* Portada                                                             */
/* ------------------------------------------------------------------ */

// El emblema se dibuja con la carga real; al entrar, la torre se arma.
{
  const t0 = performance.now();
  createIntro({
    getProgress: () => (performance.now() - t0 > 7000
      ? 1                                                        // si algo no carga, no se queda pegada
      : 0.15 + (detail.ready ? 0.45 : 0) + (apt.ready ? 0.4 : 0)),
    onEnter: () => {
      gsap.to(state, { intro: 0, duration: 3.4, ease: 'power3.out' });
      gsap.to(state, { build: 1, duration: 3.0, ease: 'power1.inOut', delay: 0.15 });
      gsap.delayedCall(1.2, () => {
        document.body.classList.remove('locked');
        document.body.classList.add('ready');
        lenis.start();
        $$('.block').forEach((el) => io.observe(el));
      });
    },
  });
}

/* ------------------------------------------------------------------ */
/* Recorrido interior: el apartamento en 3D, caminado en vivo          */
/* ------------------------------------------------------------------ */

const tourEl = $('#tour');
const hud = {
  title: $('#tourTitle'), text: $('#tourText'), count: $('#tourCount'),
  fill: $('#tourFill'), knob: $('#tourKnob'), track: $('#tourTrack'), play: $('#tourPlay'),
};
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

apt.load.then(() => {
  minimap.setPath(apt.plan);
  hud.track.insertAdjacentHTML('beforeend', apt.marks.slice(1).map((m) => `<b style="left:${m.t * 100}%"></b>`).join(''));
  renderer.compileAsync?.(apt.scene, apt.camera).catch(() => {});
}).catch((err) => console.warn('Apartamento no disponible', err));

function setPlaying(on) {
  walk.playing = on;
  hud.play.classList.toggle('paused', !on);
  hud.play.setAttribute('aria-label', on ? 'Pausar' : 'Reproducir');
}
const markAt = (t) => { let k = 0; apt.marks.forEach((m, i) => { if (m.t <= t + 1e-4) k = i; }); return k; };

function seekTour(t) {
  walk.seeking = true;
  gsap.to(walk, { t, duration: 0.9, ease: 'power2.inOut', overwrite: true, onComplete: () => { walk.seeking = false; } });
}
function stepTour(dir) {
  const k = markAt(walk.t), marks = apt.marks;
  if (dir > 0) seekTour(k + 1 < marks.length ? marks[k + 1].t : 1);
  else seekTour(walk.t - marks[k].t > 0.015 || k === 0 ? marks[k].t : marks[k - 1].t);
}

// Final del recorrido, con el mismo cuidado que la portada: el papel cubre la escena, el título sube
// letra por letra, la línea se dibuja y el botón de volver viaja de su esquina al centro.
const endEl = $('#tourEnd'), exitBtn = $('#tourExit');
{
  const title = $('#tourEndTitle');
  title.setAttribute('aria-label', title.textContent);
  title.innerHTML = title.textContent.split(' ')
    .map((w) => `<span class="wd" aria-hidden="true">${[...w].map((c) => `<span class="ch">${c}</span>`).join('')}</span>`).join(' ');
}
let endTl = null;
function setEnded(on) {
  if (on === walk.ended) return;
  walk.ended = on;
  endEl.setAttribute('aria-hidden', String(!on));
  if (!on) { endTl && endTl.timeScale(1.8).reverse(); return; }
  if (endTl) endTl.progress(0).kill();
  const d = reduceMotion ? 0.01 : 1;
  const from = exitBtn.getBoundingClientRect(), to = $('#tourEndSlot').getBoundingClientRect();
  const hudOut = ['.tour-plate', '.tour-ctl', '.tour-mode', '#minimap'];
  endTl = gsap.timeline({ defaults: { ease: 'power3.out' } })
    .to(hudOut, { autoAlpha: 0, y: 14, duration: 0.45 * d, ease: 'power2.in', stagger: 0.04 * d }, 0)
    .to('#tourWash', { opacity: 1, duration: 1.1 * d, ease: 'power2.out' }, 0.1 * d)
    .set(endEl, { visibility: 'visible' }, 0.1 * d)
    .to(exitBtn, {
      x: to.left + to.width / 2 - (from.left + from.width / 2), y: to.top + to.height / 2 - (from.top + from.height / 2),
      scale: 1.22, duration: 1.3 * d, ease: 'power3.inOut',
    }, 0.15 * d)
    .fromTo('.tour-end .eyebrow', { autoAlpha: 0, y: 14 }, { autoAlpha: 1, y: 0, duration: 0.7 * d }, 0.45 * d)
    .fromTo('.tour-end .ch', { yPercent: 115 }, { yPercent: 0, duration: 1.1 * d, stagger: 0.022 * d }, 0.5 * d)
    .fromTo('.tour-end-rule path', { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 1.2 * d, ease: 'power2.inOut' }, 0.8 * d)
    .fromTo('#tourAgain', { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: 0.6 * d }, 1.45 * d);
}
function resetEnded() {
  walk.ended = false;
  endEl.setAttribute('aria-hidden', 'true');
  if (endTl) { endTl.progress(0).kill(); endTl = null; }
  gsap.set(['.tour-plate', '.tour-ctl', '.tour-mode', '#minimap', exitBtn, '#tourWash', endEl, '#tourAgain', '.tour-end .eyebrow'], { clearProps: 'all' });
}
$('#tourAgain').addEventListener('click', () => { seekTour(0); gsap.delayedCall(0.9, () => walk.on && setPlaying(true)); });

function renderWalk(dt) {
  if (walk.playing && !walk.seeking) {
    walk.t = Math.min(1, walk.t + dt / TOUR_SECONDS);
    if (walk.t >= 1) setPlaying(false);
  }
  if (!walk.busy) setEnded(walk.t >= 1 ? true : walk.t < 0.995 ? false : walk.ended);
  // La mirada sigue al cursor (o al dedo, mientras arrastra) y vuelve sola al frente.
  if (!look2.active) { walk.dragX *= 0.94; walk.dragY *= 0.94; }
  const lx = THREE.MathUtils.clamp((finePointer ? mouse.x * 0.55 : 0) + walk.dragX, -1.8, 1.8);
  const ly = THREE.MathUtils.clamp((finePointer ? mouse.y * 0.5 : 0) + walk.dragY, -1.2, 1.2);
  walk.lookX += (lx - walk.lookX) * 0.07;
  walk.lookY += (ly - walk.lookY) * 0.07;
  // La cámara sigue al avance con un amortiguado corto: sin saltos al pausar, saltar o arrastrar la línea.
  walk.st += (walk.t - walk.st) * (1 - Math.exp(-dt * 7));
  apt.pose(walk.st, walk.lookX, walk.lookY);
  if (walk.real) {
    renderer.setRenderTarget(null);
    renderer.render(apt.real.scene, apt.camera);        // luz horneada: un solo pase, sin luces
  } else {
    ink.render(apt.scene, apt.camera, { fadeA: 60, fadeB: 420 });
  }

  const k = markAt(walk.t);
  if (k !== walk.key) {
    walk.key = k;
    hud.title.textContent = apt.marks[k].title;
    hud.text.textContent = apt.marks[k].text;
    hud.count.textContent = `${String(k + 1).padStart(2, '0')} / ${String(apt.marks.length).padStart(2, '0')}`;
  }
  hud.fill.style.transform = `scaleX(${walk.t})`;
  hud.knob.style.transform = `translateX(${walk.t * hud.track.clientWidth}px)`;
  minimap.update(walk.t);
}

async function startTour() {
  if (walk.on || walk.busy || document.body.classList.contains('locked')) return;
  walk.busy = true;
  if (ex.on) await new Promise((res) => exitExplore(res));
  lenis.stop();
  await Promise.all([gsap.to(walk, { veil: 1, duration: 0.45, ease: 'power2.in' }), apt.load.catch(() => null)]);
  if (!apt.ready) {
    notify('No se pudo cargar el apartamento. Revisa tu conexión e inténtalo de nuevo.');
    gsap.to(walk, { veil: 0, duration: 0.5 });
    lenis.start();
    walk.busy = false;
    return;
  }
  if (!walk.shadows) { walk.shadows = true; renderer.shadowMap.needsUpdate = true; }   // la sombra del sol se calcula una sola vez
  Object.assign(walk, { on: true, t: 0, st: 0, key: -1, lookX: 0, lookY: 0, dragX: 0, dragY: 0 });
  document.body.classList.add('inside');
  tourEl.setAttribute('aria-hidden', 'false');
  setPlaying(!reduceMotion);
  await gsap.to(walk, { veil: 0, duration: 0.6, delay: 0.1, ease: 'power2.out' });
  walk.busy = false;
}

async function endTour() {
  if (!walk.on || walk.busy) return;
  walk.busy = true;
  setPlaying(false);
  await gsap.to(walk, { veil: 1, duration: 0.4, ease: 'power2.in' });
  walk.on = false;
  resetEnded();
  document.body.classList.remove('inside');
  tourEl.setAttribute('aria-hidden', 'true');
  lenis.start();
  await gsap.to(walk, { veil: 0, duration: 0.55, ease: 'power2.out' });
  walk.busy = false;
}

// Tinta o realista: mismo recorrido, dos formas de verlo. La realista se descarga la primera vez que se pide.
const modeBtns = $$('.tour-mode button');
async function setStyle(real) {
  if (!walk.on || real === walk.real || walk.busy) return;
  const btn = modeBtns.find((b) => (b.dataset.style === 'real') === real);
  if (real && !apt.real.ready) {
    btn.classList.add('loading');
    try {
      await apt.loadReal(renderer, MOBILE);
    } catch (err) {
      console.warn('Versión realista no disponible', err);
      notify('No se pudo cargar la versión realista. Inténtalo de nuevo.');
      return;
    } finally {
      btn.classList.remove('loading');
    }
    if (!walk.on) return;
  }
  walk.busy = true;
  await gsap.to(walk, { veil: 1, duration: 0.3, ease: 'power2.in' });
  walk.real = real;
  document.body.classList.toggle('real', real);
  modeBtns.forEach((b) => { const on = b === btn; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
  await gsap.to(walk, { veil: 0, duration: 0.4, ease: 'power2.out' });
  walk.busy = false;
}
modeBtns.forEach((b) => b.addEventListener('click', () => setStyle(b.dataset.style === 'real')));

$$('.js-tour').forEach((b) => b.addEventListener('click', startTour));
$('#tourExit').addEventListener('click', endTour);
$('#tourPrev').addEventListener('click', () => stepTour(-1));
$('#tourNext').addEventListener('click', () => stepTour(1));
hud.play.addEventListener('click', () => {
  if (walk.t >= 1) walk.t = 0;          // al final, el botón vuelve a empezar
  setPlaying(!walk.playing);
});
{
  // Línea de avance: clic o arrastre para ir a cualquier punto
  let dragging = false;
  const seek = (ev) => {
    const r = hud.track.getBoundingClientRect();
    gsap.killTweensOf(walk, 't');
    walk.seeking = false;
    walk.t = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
  };
  hud.track.addEventListener('pointerdown', (ev) => { dragging = true; hud.track.setPointerCapture(ev.pointerId); seek(ev); });
  hud.track.addEventListener('pointermove', (ev) => { if (dragging) seek(ev); });
  hud.track.addEventListener('pointerup', () => { dragging = false; });
  hud.track.addEventListener('pointercancel', () => { dragging = false; });
}
// Arrastrar sobre la escena gira la mirada
const look2 = { active: false, x: 0, y: 0 };
canvas.addEventListener('pointerdown', (ev) => {
  if (!walk.on) return;
  Object.assign(look2, { active: true, x: ev.clientX, y: ev.clientY });
  canvas.setPointerCapture(ev.pointerId);
});
canvas.addEventListener('pointermove', (ev) => {
  if (!walk.on || !look2.active) return;
  walk.dragX -= ((ev.clientX - look2.x) / view.w) * 3.2;
  walk.dragY -= ((ev.clientY - look2.y) / view.h) * 2.2;
  look2.x = ev.clientX; look2.y = ev.clientY;
});
for (const type of ['pointerup', 'pointercancel']) canvas.addEventListener(type, () => { look2.active = false; });

/* ------------------------------------------------------------------ */
/* Modo exploración: disponibilidad y cotizador                        */
/* ------------------------------------------------------------------ */

const rail = $('#rail'), panel = $('#panel'), exploreEl = $('#explore');
const floorY = (fi) => BASE + fi * FH + fi * GAP * ex.explode + 1.6;

{
  const n = (s) => UNITS.filter((u) => u.status === s).length;
  $('#counts').innerHTML =
    `<div><b>${n('disponible')}</b><span>Disponibles</span></div><div><b>${n('separado')}</b><span>Separadas</span></div><div><b>${n('vendido')}</b><span>Vendidas</span></div>`;
}
// Riel de pisos
for (let fi = FLOORS - 1; fi >= 0; fi--) {
  const us = UNITS.filter((u) => u.fi === fi);
  const b = document.createElement('button');
  b.dataset.fi = fi;
  b.setAttribute('aria-label', `Piso ${us[0].piso}`);
  b.innerHTML = `<b>P${String(us[0].piso).padStart(2, '0')}</b><span class="dots">${us
    .map((u) => `<i class="${u.status === 'disponible' ? 'd' : u.status === 'separado' ? 's' : ''}"></i>`).join('')}</span>`;
  b.addEventListener('click', () => setFloor(ex.floor === fi ? null : fi));
  rail.appendChild(b);
}

function setFloor(fi) {
  ex.floor = fi;
  $$('button', rail).forEach((b) => b.classList.toggle('on', +b.dataset.fi === fi));
  const y = fi === null ? TOP / 2 + 8 : floorY(fi);
  gsap.to(controls.target, { y, duration: 1.1, ease: 'power3.inOut' });
  gsap.to(camera.position, { y: y + (fi === null ? 14 : 20), duration: 1.1, ease: 'power3.inOut' });
  if (ex.selected && fi !== null && ex.selected.fi !== fi) selectUnit(null);
}

function selectUnit(u) {
  ex.selected = u;
  exploreEl.classList.toggle('has-unit', !!u);
  if (!u) return;
  if (ex.floor !== u.fi) setFloor(u.fi);
  const disponible = u.status === 'disponible';
  const estado = { disponible: 'Disponible', separado: 'Separada', vendido: 'Vendida' }[u.status];
  panel.innerHTML = `
    <button class="x" aria-label="Cerrar ficha">Cerrar ✕</button>
    <h3>${u.codigo}</h3>
    <p class="sub"><span>${u.nombre} · Piso ${u.piso}</span><span class="chip ${u.status}">${estado}</span></p>
    <div class="specs">
      <div><b>${u.area} m²</b><span>Área</span></div>
      <div><b>${u.hab}</b><span>Alcobas</span></div>
      <div><b>${u.ban}</b><span>Baños</span></div>
    </div>
    ${planSVG(u.tipo)}
    <p class="vista">Vista: ${u.vista}</p>
    <div class="price"><span>Precio</span><b>${cop(u.precio)}</b></div>
    ${disponible ? `
    <div class="quote">
      <label><span>Cuota inicial <em id="qCiV"></em></span><input id="qCi" type="range" min="10" max="50" step="5" value="30" /></label>
      <label><span>Plazo durante obra <em id="qMV"></em></span><input id="qM" type="range" min="12" max="36" step="6" value="24" /></label>
      <dl>
        <dt>Separación hoy</dt><dd>${cop(SEPARACION)}</dd>
        <dt>Cuota mensual</dt><dd class="big" id="qCuota"></dd>
        <dt>Saldo contra entrega</dt><dd id="qSaldo"></dd>
      </dl>
    </div>
    <button class="btn" data-toast="Demo: aquí se paga la separación en línea.">Separar esta residencia</button>
    <button class="btn ghost" id="toInterior">Recorrer por dentro</button>`
    : `<p class="sold">Esta residencia ya no está disponible. Mira las marcadas en ocre.</p>`}`;
  panel.scrollTop = 0;
  $('.x', panel).addEventListener('click', () => selectUnit(null));
  if (disponible) {
    const ci = $('#qCi'), m = $('#qM');
    const calc = () => {
      const inicial = (u.precio * +ci.value) / 100;
      $('#qCiV').textContent = `${ci.value}% · ${cop(inicial)}`;
      $('#qMV').textContent = `${m.value} meses`;
      $('#qCuota').textContent = cop(Math.round((inicial - SEPARACION) / +m.value / 1000) * 1000);
      $('#qSaldo').textContent = cop(u.precio - inicial);
    };
    ci.addEventListener('input', calc); m.addEventListener('input', calc);
    calc();
    $('#toInterior').addEventListener('click', startTour);
  }
}

function enterExplore() {
  if (ex.on || walk.on) return;
  ex.on = true;
  ex.explode = state.explode;
  lenis.stop();
  document.body.classList.add('exploring');
  exploreEl.setAttribute('aria-hidden', 'false');
  controls.target.set(state.tx, state.ty, state.tz);
  controls.enabled = true;
  gsap.to(ex, { explode: 0.3, duration: 1.4, ease: 'power3.inOut' });
  gsap.to(controls.target, { x: 0, y: TOP / 2 + 8, z: 0, duration: 1.4, ease: 'power3.inOut' });
  gsap.to(camera.position, { x: 70, y: 54, z: 96, duration: 1.4, ease: 'power3.inOut' });
}

function exitExplore(after) {
  if (!ex.on) return;
  selectUnit(null);
  ex.floor = null; ex.hover = null;
  $$('button', rail).forEach((b) => b.classList.remove('on'));
  controls.enabled = false;
  ex.exiting = true;
  document.body.classList.remove('exploring');
  exploreEl.setAttribute('aria-hidden', 'true');
  gsap.to(ex, { explode: state.explode, duration: 1.1, ease: 'power3.inOut' });
  gsap.to(controls.target, { x: state.tx, y: state.ty, z: state.tz, duration: 1.1, ease: 'power3.inOut' });
  gsap.to(camera.position, {
    x: state.px, y: state.py, z: state.pz, duration: 1.1, ease: 'power3.inOut',
    onComplete: () => { ex.on = false; ex.exiting = false; lenis.start(); typeof after === 'function' && after(); },
  });
}

$('#exploreBtn').addEventListener('click', enterExplore);
$$('.js-explore').forEach((btn) => btn.addEventListener('click', () => {
  // hasta el punto del viaje donde los pisos ya están separados
  lenis.scrollTo('#residencias', { offset: window.innerHeight * 2, duration: 2, onComplete: enterExplore });
}));
$('#exitBtn').addEventListener('click', () => exitExplore());

window.addEventListener('keydown', (ev) => {
  if (walk.on) {
    if (ev.key === 'Escape') endTour();
    else if (ev.key === 'ArrowRight') stepTour(1);
    else if (ev.key === 'ArrowLeft') stepTour(-1);
    else if (ev.key === ' ' && !ev.target.closest('button')) { ev.preventDefault(); hud.play.click(); }
    return;
  }
  if (ev.key !== 'Escape' || !ex.on) return;
  if (ex.selected) selectUnit(null); else exitExplore();
});

// Selección con el puntero
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const aim = (ev) => {
  ndc.set((ev.clientX / view.w) * 2 - 1, -(ev.clientY / view.h) * 2 + 1);
  ray.setFromCamera(ndc, camera);
};
let down = null;
function pick(ev) {
  aim(ev);
  const hit = ray.intersectObjects(unitMeshes, false).find((h) => ex.floor === null || h.object.userData.unit.fi === ex.floor);
  return hit ? hit.object.userData.unit : null;
}
canvas.addEventListener('pointermove', (ev) => {
  if (!ex.on || ex.exiting || ev.pointerType === 'touch') return;
  ex.hover = pick(ev);
  canvas.classList.toggle('hot', !!ex.hover);
});
canvas.addEventListener('pointerdown', (ev) => { down = [ev.clientX, ev.clientY]; });
canvas.addEventListener('pointerup', (ev) => {
  if (!ex.on || ex.exiting || !down) return;
  if (Math.hypot(ev.clientX - down[0], ev.clientY - down[1]) > 6) return;
  const u = pick(ev);
  if (u) selectUnit(u);
});

window.addEventListener('pointermove', (ev) => {
  mouse.x = (ev.clientX / window.innerWidth) * 2 - 1;
  mouse.y = (ev.clientY / window.innerHeight) * 2 - 1;
});

/* ------------------------------------------------------------------ */
/* Aviso                                                               */
/* ------------------------------------------------------------------ */

const toast = $('#toast');
let toastT;
function notify(text) {
  toast.textContent = text;
  toast.classList.add('on');
  clearTimeout(toastT);
  toastT = setTimeout(() => toast.classList.remove('on'), 2800);
}
document.addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-toast]');
  if (b) notify(b.dataset.toast);
});

/* ------------------------------------------------------------------ */
/* Tocar la torre: girarla y encender pisos                            */
/* ------------------------------------------------------------------ */

const floorTip = $('#floorTip');
const litMat = new THREE.MeshLambertMaterial({ color: 0xd9a441, transparent: true });   // cálido: la tinta lo pinta de ocre
const lit = new Set();
const playable = () => !ex.on && !ex.exiting && !walk.on && !walk.busy && !document.body.classList.contains('locked');
let grab = null;

function floorAt(ev) {
  if (!detail.ready || schMode) return -1;
  aim(ev);
  for (const hit of ray.intersectObjects(detail.floors, true)) {
    let o = hit.object;
    while (o && !detail.floors.includes(o)) o = o.parent;
    const fi = detail.floors.indexOf(o);
    if (fi >= 0 && floors[fi].visible) return fi;
  }
  return -1;
}
function toggleFloor(fi) {
  const on = !lit.has(fi);
  on ? lit.add(fi) : lit.delete(fi);
  detail.floors[fi].traverse((o) => {
    if (o.isMesh && (o.material === detailMats.glass || o.material === litMat)) o.material = on ? litMat : detailMats.glass;
  });
}
canvas.addEventListener('pointerdown', (ev) => {
  if (!playable()) return;
  grab = { x: ev.clientX, y: ev.clientY, r: spin.target, moved: false, touch: ev.pointerType === 'touch' };
  if (!grab.touch) canvas.setPointerCapture(ev.pointerId);
  canvas.classList.add('grabbing');
});
canvas.addEventListener('pointermove', (ev) => {
  if (!playable()) { floorTip.classList.remove('on'); return; }
  if (grab) {
    const dx = ev.clientX - grab.x, dy = ev.clientY - grab.y;
    if (grab.touch && !grab.moved) {
      // Con el dedo, la torre solo gira si el gesto es claramente horizontal; si es vertical, es scroll y no se toca.
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { grab = null; canvas.classList.remove('grabbing'); return; }
      if (Math.abs(dx) < 14 || Math.abs(dx) < Math.abs(dy) * 1.6) return;
      grab.x = ev.clientX; grab.moved = true; spun = true;
      return;
    }
    if (Math.abs(dx) > 6) { grab.moved = true; spun = true; }
    spin.target = grab.r + dx * 0.008;
    floorTip.classList.remove('on');
    return;
  }
  if (ev.pointerType === 'touch') return;
  const fi = floorAt(ev);
  floorTip.classList.toggle('on', fi >= 0);
  if (fi >= 0) {
    const free = UNITS.filter((u) => u.fi === fi && u.status === 'disponible').length;
    floorTip.innerHTML = `<b>Piso ${fi + 3}</b>${free} disponible${free === 1 ? '' : 's'}. Clic para ${lit.has(fi) ? 'apagar' : 'encender'}.`;
    floorTip.style.transform = `translate(${ev.clientX + 18}px, ${ev.clientY + 14}px)`;
  }
});
for (const type of ['pointerup', 'pointercancel']) {
  canvas.addEventListener(type, (ev) => {
    canvas.classList.remove('grabbing');
    if (!grab) return;
    const wasClick = type === 'pointerup' && !grab.moved && Math.abs(ev.clientY - grab.y) < 8;
    grab = null;
    if (wasClick && playable()) {
      const fi = floorAt(ev);
      if (fi >= 0) toggleFloor(fi);
    }
  });
}
canvas.addEventListener('pointerleave', () => floorTip.classList.remove('on'));

if (import.meta.env.DEV) window.__demo = { state, tl, ex, walk, lenis, apt, quality, startTour, endTour };
