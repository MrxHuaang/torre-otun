// Interior realista del apartamento tipo A: materiales PBR, luz de sol con sombras,
// reflejos por mapa de entorno. Todo procedural, sin archivos externos.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const rnd = (() => { let s = 19; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();

function canvasTex(w, h, paint, repeat) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  paint(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  return t;
}

const woodTex = () => canvasTex(1024, 1024, (g) => {
  const ph = 128;
  for (let r = 0; r < 8; r++) {
    let x = -rnd() * 400;
    while (x < 1024) {
      const w = 380 + rnd() * 320;
      g.fillStyle = `hsl(${29 + rnd() * 5} ${30 + rnd() * 8}% ${60 + rnd() * 9}%)`;
      g.fillRect(x, r * ph, w, ph);
      for (let i = 0; i < 26; i++) {
        g.strokeStyle = `rgba(80,50,22,${0.03 + rnd() * 0.06})`;
        const y = r * ph + rnd() * ph;
        g.beginPath(); g.moveTo(x, y);
        g.bezierCurveTo(x + w * 0.3, y + (rnd() - 0.5) * 9, x + w * 0.6, y + (rnd() - 0.5) * 9, x + w, y + (rnd() - 0.5) * 6);
        g.stroke();
      }
      g.fillStyle = 'rgba(45,28,12,.38)'; g.fillRect(x + w - 1.5, r * ph, 1.5, ph);
      x += w;
    }
    g.fillStyle = 'rgba(45,28,12,.32)'; g.fillRect(0, r * ph, 1024, 1.5);
  }
}, [2.2, 3]);

const rugTex = () => canvasTex(512, 384, (g, w, h) => {
  g.fillStyle = '#e7dfd0'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 9000; i++) { g.fillStyle = `rgba(${rnd() > 0.5 ? '255,255,255' : '120,100,70'},${rnd() * 0.08})`; g.fillRect(rnd() * w, rnd() * h, 2, 2); }
  g.strokeStyle = '#a8876a'; g.lineWidth = 5; g.strokeRect(22, 22, w - 44, h - 44);
  g.lineWidth = 1.5; g.strokeRect(36, 36, w - 72, h - 72);
  g.strokeStyle = 'rgba(168,135,106,.5)';
  for (let x = 70; x < w - 60; x += 34) { g.beginPath(); g.moveTo(x, 50); g.lineTo(x, h - 50); g.stroke(); }
});

const artTex = (k) => canvasTex(360, 480, (g, w, h) => {
  g.fillStyle = '#f4efe4'; g.fillRect(0, 0, w, h);
  g.strokeStyle = '#1c1a17'; g.lineWidth = 2;
  const cx = w / 2, cy = h * (0.62 + k * 0.04);
  for (let i = 0; i <= 18; i++) {
    const a = Math.PI + (i / 18) * Math.PI;
    g.beginPath(); g.moveTo(cx + Math.cos(a) * 40, cy + Math.sin(a) * 40);
    g.lineTo(cx + Math.cos(a) * (i % 2 ? 150 : 210), cy + Math.sin(a) * (i % 2 ? 150 : 210)); g.stroke();
  }
  g.fillStyle = ['#b8863b', '#b5653f', '#3d5247'][k];
  g.beginPath(); g.arc(cx, cy, 40, Math.PI, 0); g.fill();
  g.fillRect(cx - 150, cy + 14, 300, 6);
});

const skyTex = () => canvasTex(8, 512, (g, w, h) => {
  const gr = g.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, '#7fa9d2'); gr.addColorStop(0.36, '#bcd5e8'); gr.addColorStop(0.5, '#fbe9cc');
  gr.addColorStop(0.56, '#e9dfcb'); gr.addColorStop(1, '#cfc7b6');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
});

export function createInterior(renderer) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(64, 1, 0.1, 1400);
  scene.fog = new THREE.Fog(0xeae2d2, 160, 950);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.5;

  const std = (color, roughness = 0.8, metalness = 0, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
  const M = {
    wall: std(0xf3eee5, 0.95), ceil: std(0xfbf9f4, 0.95),
    floor: std(0xffffff, 0.5, 0, { map: woodTex() }),
    oak: std(0xb48d62, 0.6), walnut: std(0x6d4c34, 0.55),
    stone: std(0xece9e2, 0.22), cabinet: std(0x34423c, 0.6),
    fabric: std(0xdcd2c2, 1), cushion: std(0xe9e1d4, 1), terra: std(0xb5653f, 1), green: std(0x3d5247, 1),
    metal: std(0x1e1e1e, 0.4, 0.8), brass: std(0xc9a45c, 0.28, 1),
    tile: std(0xcfc8bb, 0.7), plant: std(0x4f7048, 0.9), pot: std(0xc08a66, 0.9),
    rug: std(0xffffff, 1, 0, { map: rugTex() }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: 0.1, roughness: 0.03, envMapIntensity: 2 }),
    bulb: new THREE.MeshBasicMaterial({ color: 0xffe9c4 }),
  };

  function add(geo, mat, x, y, z, { cast = true, receive = true, ry = 0, rx = 0, rz = 0 } = {}) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.castShadow = cast; m.receiveShadow = receive;
    if (mat === M.glass) m.layers.set(2); // fuera del pase de contornos
    scene.add(m);
    return m;
  }
  const box = (w, h, d, mat, x, y, z, o = {}) =>
    add(o.r ? new RoundedBoxGeometry(w, h, d, 4, o.r) : new THREE.BoxGeometry(w, h, d), mat, x, y, z, o);
  const cyl = (rt, rb, h, mat, x, y, z, o = {}) => add(new THREE.CylinderGeometry(rt, rb, h, 32, 1, !!o.open), mat, x, y, z, o);
  const ball = (r, mat, x, y, z, o = {}) => add(new THREE.SphereGeometry(r, 24, 16), mat, x, y, z, o);

  /* --- Cascarón --- */
  box(10.2, 0.2, 7.4, M.floor, 5, -0.1, 3.5);
  box(10.6, 0.2, 7.8, M.ceil, 5, 2.9, 3.5);
  box(10.6, 3, 0.2, M.wall, 5, 1.4, -0.1);
  box(10.6, 3, 0.2, M.wall, 5, 1.4, 7.1);
  box(0.2, 3, 7.4, M.wall, -0.1, 1.4, 3.5);
  box(0.05, 2.1, 0.95, M.walnut, 0.03, 1.05, 5.8);
  cyl(0.015, 0.015, 0.14, M.brass, 0.08, 1.02, 5.45, { rx: Math.PI / 2 });
  for (const z of [0.045, 6.955]) box(10, 0.09, 0.02, M.ceil, 5, 0.045, z, { cast: false }); // guardaescobas

  /* --- Ventanal y balcón --- */
  box(0.2, 0.48, 7.4, M.wall, 10, 2.56, 3.5);
  const posts = [0.05, 1.5, 2.7, 4.3, 5.5, 6.95];
  posts.forEach((z) => box(0.06, 2.32, 0.06, M.metal, 10, 1.16, z));
  box(0.06, 0.05, 6.9, M.metal, 10, 2.3, 3.5);
  for (let i = 0; i < posts.length - 1; i++) {
    if (i === 2) continue; // puerta corrediza abierta
    const a = posts[i], b = posts[i + 1];
    box(0.015, 2.26, b - a - 0.06, M.glass, 10, 1.15, (a + b) / 2, { cast: false, receive: false });
  }
  box(0.015, 2.26, 1.5, M.glass, 10.05, 1.15, 5.0, { cast: false, receive: false }); // hoja corrida
  for (const z of [0.32, 6.68]) box(0.07, 2.3, 0.5, std(0xf6f1e6, 1, 0, { transparent: true, opacity: 0.92 }), 9.82, 1.15, z, { cast: false });
  box(1.9, 0.2, 7.4, M.tile, 11.05, -0.1, 3.5);
  box(1.9, 0.2, 7.8, M.ceil, 11.05, 2.9, 3.5);
  box(0.03, 1.0, 7.4, M.glass, 11.95, 0.52, 3.5, { cast: false, receive: false });
  box(0.05, 0.04, 7.4, M.metal, 11.95, 1.05, 3.5);
  box(0.36, 0.42, 1.7, M.cabinet, 11.6, 0.21, 6.0);
  for (let i = 0; i < 6; i++) ball(0.2 + rnd() * 0.1, M.plant, 11.6 + (rnd() - 0.5) * 0.1, 0.52 + rnd() * 0.16, 5.3 + i * 0.28);

  /* --- Cocina --- */
  box(3.6, 0.88, 0.62, M.cabinet, 2.2, 0.44, 0.41);
  for (let x = 0.4; x < 4; x += 0.6) box(0.012, 0.8, 0.012, M.metal, x, 0.44, 0.725, { cast: false });
  box(3.66, 0.04, 0.68, M.stone, 2.2, 0.9, 0.42);
  box(3.6, 0.62, 0.02, M.stone, 2.2, 1.23, 0.012, { cast: false });
  box(3.6, 0.7, 0.36, M.oak, 2.2, 2.0, 0.19);
  box(0.9, 2.4, 0.66, M.cabinet, 4.5, 1.2, 0.43);
  box(0.6, 0.012, 0.5, M.metal, 1.2, 0.925, 0.42, { cast: false });
  cyl(0.014, 0.014, 0.3, M.brass, 2.9, 1.07, 0.3);
  cyl(0.014, 0.014, 0.18, M.brass, 2.9, 1.21, 0.38, { rx: Math.PI / 2 });
  // Isla
  box(2.3, 0.88, 0.85, M.cabinet, 2.9, 0.44, 2.05);
  box(2.5, 0.05, 1.02, M.stone, 2.9, 0.905, 2.05, { r: 0.02 });
  for (const x of [2.2, 2.9, 3.6]) {
    cyl(0.18, 0.18, 0.04, M.oak, x, 0.66, 2.9);
    cyl(0.018, 0.018, 0.64, M.metal, x, 0.32, 2.9);
    cyl(0.16, 0.16, 0.015, M.metal, x, 0.008, 2.9);
  }
  cyl(0.2, 0.12, 0.09, M.pot, 2.4, 0.975, 2.0);
  [[2.34, 2.0, 0xd98b2b], [2.46, 1.96, 0xc94f2a], [2.4, 2.07, 0xe0a23a]].forEach(([x, z, c]) => ball(0.05, std(c, 0.6), x, 1.03, z));
  cyl(0.05, 0.07, 0.26, M.green, 3.5, 1.06, 2.1);
  // Lámparas colgantes
  for (const x of [2.4, 3.4]) {
    cyl(0.004, 0.004, 0.85, M.metal, x, 2.38, 2.05, { cast: false });
    cyl(0.04, 0.15, 0.2, std(0xc9a45c, 0.3, 1, { side: THREE.DoubleSide }), x, 1.88, 2.05, { open: true });
    ball(0.045, M.bulb, x, 1.82, 2.05, { cast: false, receive: false });
  }
  const k = new THREE.PointLight(0xffd7a0, 5, 6, 2); k.position.set(2.9, 1.7, 2.05); scene.add(k);

  /* --- Comedor --- */
  box(1.9, 0.05, 0.95, M.oak, 3.4, 0.745, 5.1, { r: 0.02 });
  [[2.56, 4.72], [4.24, 4.72], [2.56, 5.48], [4.24, 5.48]].forEach(([x, z]) => cyl(0.025, 0.02, 0.72, M.metal, x, 0.36, z));
  [[2.95, 4.36, 0], [3.85, 4.36, 0], [2.95, 5.84, Math.PI], [3.85, 5.84, Math.PI]].forEach(([x, z, ry]) => {
    const s = Math.cos(ry);
    box(0.44, 0.06, 0.44, M.terra, x, 0.46, z, { r: 0.025 });
    box(0.44, 0.4, 0.05, M.terra, x, 0.72, z - 0.2 * s, { r: 0.02 });
    for (const [dx, dz] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]]) cyl(0.014, 0.012, 0.44, M.metal, x + dx, 0.22, z + dz);
  });
  cyl(0.06, 0.09, 0.3, M.stone, 3.4, 0.92, 5.1);
  for (let i = 0; i < 5; i++) cyl(0.004, 0.004, 0.6, M.walnut, 3.4 + (rnd() - 0.5) * 0.1, 1.3, 5.1 + (rnd() - 0.5) * 0.1, { rz: (rnd() - 0.5) * 0.6, rx: (rnd() - 0.5) * 0.6 });
  cyl(0.004, 0.004, 0.75, M.metal, 3.4, 2.43, 5.1, { cast: false });
  ball(0.17, std(0xfff4dc, 0.3, 0, { emissive: 0xffe2b0, emissiveIntensity: 1.2 }), 3.4, 1.92, 5.1, { cast: false });
  const d = new THREE.PointLight(0xffe0b0, 4, 6, 2); d.position.set(3.4, 1.9, 5.1); scene.add(d);

  /* --- Sala --- */
  box(3.8, 0.014, 2.8, M.rug, 7.2, 0.008, 4.95, { cast: false });
  box(2.6, 0.36, 0.95, M.fabric, 7.2, 0.28, 6.1, { r: 0.08 });
  box(2.6, 0.55, 0.24, M.fabric, 7.2, 0.6, 6.48, { r: 0.09 });
  for (const x of [5.92, 8.48]) box(0.24, 0.5, 0.95, M.fabric, x, 0.46, 6.1, { r: 0.09 });
  for (const x of [6.66, 7.74]) box(1.04, 0.16, 0.68, M.cushion, x, 0.52, 6.0, { r: 0.07 });
  box(0.42, 0.4, 0.14, M.terra, 6.3, 0.76, 6.26, { r: 0.06, rx: -0.3, ry: 0.25 });
  box(0.42, 0.4, 0.14, M.green, 8.1, 0.76, 6.26, { r: 0.06, rx: -0.3, ry: -0.2 });
  for (const [x, z] of [[6.0, 5.72], [8.4, 5.72], [6.0, 6.48], [8.4, 6.48]]) cyl(0.02, 0.015, 0.1, M.metal, x, 0.05, z);
  // Mesa de centro
  cyl(0.52, 0.52, 0.04, M.stone, 7.2, 0.37, 4.6);
  cyl(0.1, 0.22, 0.34, M.metal, 7.2, 0.18, 4.6);
  box(0.3, 0.035, 0.22, M.green, 7.05, 0.408, 4.55, { ry: 0.3 });
  box(0.26, 0.03, 0.2, M.terra, 7.05, 0.44, 4.55, { ry: 0.1 });
  ball(0.06, M.brass, 7.4, 0.45, 4.72);
  // Sillón
  box(0.8, 0.34, 0.8, M.terra, 5.35, 0.3, 4.5, { r: 0.09, ry: 0.5 });
  box(0.2, 0.62, 0.8, M.terra, 5.05, 0.56, 4.33, { r: 0.09, ry: 0.5 });
  // Lámpara de pie
  cyl(0.012, 0.012, 1.5, M.brass, 9.0, 0.75, 6.5);
  cyl(0.15, 0.15, 0.02, M.brass, 9.0, 0.01, 6.5);
  cyl(0.14, 0.2, 0.28, std(0xfaf0dc, 1, 0, { emissive: 0xffe2b0, emissiveIntensity: 0.5, side: THREE.DoubleSide }), 9.0, 1.56, 6.5, { open: true, cast: false });
  // Aparador con cuadro
  box(2.8, 0.46, 0.42, M.oak, 7, 0.5, 0.31, { r: 0.02 });
  for (const x of [5.75, 8.25]) for (const z of [0.16, 0.46]) cyl(0.018, 0.012, 0.27, M.metal, x, 0.135, z);
  box(1.7, 1.05, 0.03, M.metal, 7, 1.62, 0.02, { cast: false });
  box(1.62, 0.97, 0.02, std(0xffffff, 0.9, 0, { map: artTex(0) }), 7, 1.62, 0.035, { cast: false });
  cyl(0.07, 0.1, 0.3, M.terra, 6.1, 0.88, 0.3);
  ball(0.09, M.brass, 7.9, 0.82, 0.3);
  box(0.3, 0.05, 0.22, M.green, 7.5, 0.755, 0.3);
  // Cuadros sobre el sofá
  [6.35, 7.2, 8.05].forEach((x, i) => {
    box(0.66, 0.9, 0.03, M.walnut, x, 1.72, 6.985, { cast: false });
    box(0.6, 0.84, 0.02, std(0xffffff, 0.9, 0, { map: artTex(i) }), x, 1.72, 6.97, { cast: false });
  });
  // Planta
  cyl(0.24, 0.18, 0.42, M.pot, 9.35, 0.21, 0.75);
  cyl(0.02, 0.03, 1.1, M.walnut, 9.35, 0.9, 0.75);
  for (let i = 0; i < 9; i++) {
    const a = rnd() * 6.28, r = 0.15 + rnd() * 0.3;
    const leaf = ball(0.24, M.plant, 9.35 + Math.cos(a) * r, 1.3 + rnd() * 0.6, 0.75 + Math.sin(a) * r);
    leaf.scale.set(1, 0.45, 0.7); leaf.rotation.set(rnd(), rnd() * 3, rnd());
  }

  /* --- Exterior: cielo, cordillera, ciudad --- */
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1200, 32, 24), new THREE.MeshBasicMaterial({ map: skyTex(), side: THREE.BackSide, fog: false }));
  scene.add(sky);
  const ridgeMesh = (x, base, amp, seed, color) => {
    const N = 180, pos = [], idx = [];
    for (let i = 0; i <= N; i++) {
      const z = -900 + (i / N) * 1800;
      const h = base + amp * (0.5 + 0.5 * Math.sin(z * 0.0052 + seed)) * (0.62 + 0.38 * Math.sin(z * 0.017 + seed * 3)) + amp * 0.1 * Math.sin(z * 0.06 + seed);
      pos.push(x, h, z, x, -200, z);
      if (i < N) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    scene.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide })));
  };
  ridgeMesh(760, 40, 260, 4, 0x8ea6b4);
  ridgeMesh(560, 0, 170, 2.4, 0x6f8f86);
  ridgeMesh(400, -30, 100, 1, 0x56755d);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(900, 48), new THREE.MeshBasicMaterial({ color: 0x8fa07e }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -48; scene.add(ground);
  const N = 520;
  const city = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), std(0xffffff, 1), N);
  const mtx = new THREE.Matrix4(), col = new THREE.Color();
  const tones = [0xf1ebe0, 0xe2d6c4, 0xc9bca8, 0xb87a5a, 0xd9d4cc, 0xa7aaa8];
  for (let i = 0; i < N; i++) {
    const x = 70 + rnd() * 330, z = -380 + rnd() * 760, h = 5 + rnd() * rnd() * 40;
    mtx.makeScale(7 + rnd() * 9, h, 7 + rnd() * 9).setPosition(x, -48 + h / 2, z);
    city.setMatrixAt(i, mtx);
    city.setColorAt(i, col.setHex(tones[Math.floor(rnd() * tones.length)]));
  }
  scene.add(city);

  /* --- Luz --- */
  scene.add(new THREE.HemisphereLight(0xe4eef8, 0xb89c7a, 0.9));
  const sun = new THREE.DirectionalLight(0xffe4bd, 4.4);
  sun.target.position.set(6, 0, 3.6);
  sun.position.copy(sun.target.position).add(new THREE.Vector3(1, 0.5, 0.36).normalize().multiplyScalar(34));
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 8, bottom: -8, near: 1, far: 70 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 5;
  scene.add(sun, sun.target);

  const walkPos = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.8, 1.6, 5.8), new THREE.Vector3(3.3, 1.6, 3.5), new THREE.Vector3(6.0, 1.58, 3.1),
    new THREE.Vector3(9.0, 1.62, 3.5), new THREE.Vector3(11.3, 1.68, 3.5),
  ]);
  const walkLook = new THREE.CatmullRomCurve3([
    new THREE.Vector3(6, 1.2, 4.2), new THREE.Vector3(3.0, 1.0, 1.2), new THREE.Vector3(8.6, 1.1, 5.4),
    new THREE.Vector3(40, 3, 3.5), new THREE.Vector3(400, 30, 3.5),
  ]);

  return { scene, camera, walkPos, walkLook };
}
