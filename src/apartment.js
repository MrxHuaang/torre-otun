// Apartamento tipo A en 3D, para recorrerlo en vivo.
// El modelo sale de Blender (blender/apartamento.py, modo `glb`) y aquí se le da luz,
// sombra y los trazos propios de cada material (vetas, juntas, tejido), dibujados por sombreador:
// el trazo queda nítido a cualquier tamaño de pantalla y a 60 cuadros por segundo.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { Reflector } from 'three/addons/objects/Reflector.js';

// Color de cada material (mismos nombres que en Blender) y qué trazo lleva.
const MATS = {
  pared: [0xf1ece3], techo: [0xfaf8f4], papel: [0xf5f0e6], cortina: [0xf6f2ea],
  // piso claro: queda en papel con sus juntas y el ocre se reserva para los muebles
  piso: [0xe2d8c6, 'PLANKS'], roble: [0xa67f52, 'WOOD'], nogal: [0x6b4a33, 'WOOD'], ocre: [0xb8863b],
  piedra: [0xf2efe9, 'STONE'], porcelanato: [0xd6d1c8, 'TILE'], baldosa: [0xd9d3c7, 'TILE'], ceramica: [0xe9e3d8],
  mueble: [0x5c6963], fieltro: [0x7b776f], metal: [0x161616], vitro: [0x050505],
  laton: [0xc9a25a], acero: [0xc8c8c8], espejo: [0xd9dde0], barro: [0xb67d5c],
  lino: [0xd8cdbb, 'FABRIC'], cojin: [0xe9e2d6, 'FABRIC'], duvet: [0xf4f1ea, 'FABRIC'], toalla: [0xe8e2d6, 'FABRIC'],
  lana: [0xe4dccd, 'FABRIC'], lana2: [0xa98a68, 'FABRIC'], terracota: [0xb1603c, 'FABRIC'], boucle: [0xb1603c, 'FABRIC'],
  verde: [0x3b5045, 'FABRIC'], terciopelo: [0x35493f, 'FABRIC'], hoja: [0x3f6a3a],
  naranja: [0xd98b2b], limon: [0xd9b93a],
  libro0: [0x8a3b2c], libro1: [0x2f4a3f], libro2: [0xd9cdb8], libro3: [0x1f2a36],
  libro4: [0xb8863b], libro5: [0xe9e2d6], libro6: [0x6b4a36], libro7: [0x394f63],
};
const GLOW = { bombillo: 0xfff1d6, led: 0xfff1d6, spot: 0xfffaf0, pantalla: 0xfbf3e4 };   // encendidos: sin sombra
const GLASS = ['vidrio', 'esmerilado'];
// Versión del arte del apartamento. Se sube con cada exportación de Blender: como los archivos conservan
// el nombre, sin esto el navegador seguiría mostrando el modelo y las texturas anteriores desde su caché.
const ART = '?v=6';

const DETAIL_GLSL = /* glsl */ `
  varying vec3 vWp;
  float h31(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float vn(vec3 x) {
    vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(h31(i), h31(i + vec3(1, 0, 0)), f.x), mix(h31(i + vec3(0, 1, 0)), h31(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(h31(i + vec3(0, 0, 1)), h31(i + vec3(1, 0, 1)), f.x), mix(h31(i + vec3(0, 1, 1)), h31(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  // Línea de ancho constante en pantalla donde el valor cruza 0.5: trazo fino y definido.
  float iso(float n, float px) { float w = fwidth(n) * px; return 1.0 - smoothstep(w * 0.55, w * 1.25, abs(n - 0.5)); }
  float inkDetail(vec3 p) {
    float fade = 1.0 - smoothstep(5.0, 13.0, distance(p, cameraPosition));
    float k = 0.0;
    #if defined(DETAIL_WOOD) || defined(DETAIL_PLANKS)
      k = iso(vn(vec3(p.x * 0.55, p.y * 6.0, p.z * 6.0)), 1.0) * 0.75;                 // vetas a lo largo de X
    #endif
    #ifdef DETAIL_PLANKS
      k *= 0.55;
      float near = 1.0 - smoothstep(3.5, 9.0, distance(p, cameraPosition));              // de lejos las juntas se funden
      float row = floor(p.z / 0.2);
      float dz = 0.1 - abs(fract(p.z / 0.2) - 0.5) * 0.2;                                // junta entre hileras
      k = max(k, (1.0 - smoothstep(fwidth(p.z) * 0.35, fwidth(p.z) * 0.95, dz)) * 0.8 * near);
      float xx = p.x + h31(vec3(row, 1.0, 2.0)) * 1.8;
      float dx = 0.9 - abs(fract(xx / 1.8) - 0.5) * 1.8;                                 // testa de cada tabla
      k = max(k, (1.0 - smoothstep(fwidth(p.x) * 0.35, fwidth(p.x) * 0.95, dx)) * 0.8 * near);
    #endif
    #ifdef DETAIL_STONE
      vec3 q = p * 1.3 + 1.6 * vec3(vn(p * 0.9), vn(p * 0.9 + 7.0), vn(p * 0.9 + 13.0));
      k = iso(vn(q) * 0.6 + vn(q * 2.1) * 0.4, 0.9) * 0.7;                               // vetas del mármol
    #endif
    #ifdef DETAIL_TILE
      vec3 n = abs(normalize(cross(dFdx(p), dFdy(p))));                                   // la junta solo se dibuja en el plano de la cara
      vec3 g = abs(fract(p / 0.6 + 0.5) - 0.5) * 0.6, w = fwidth(p);
      vec3 j = (1.0 - smoothstep(w * 0.6, w * 1.4, g)) * step(n, vec3(0.6));
      k = max(j.x, max(j.y, j.z)) * 0.8;
    #endif
    #ifdef DETAIL_FABRIC
      // pliegues: hebras finas y onduladas, solo por zonas
      k = iso(vn(vec3(p.x * 26.0, p.y * 3.0, p.z * 26.0)), 0.8) * smoothstep(0.5, 0.68, vn(p * 2.4)) * 0.6;
    #endif
    return 1.0 - k * fade * 0.97;
  }`;

function material(name) {
  if (GLOW[name]) return new THREE.MeshBasicMaterial({ color: GLOW[name] });
  if (GLASS.includes(name)) return new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.06, depthWrite: false });
  const [color, kind] = MATS[name] || [0xe8e4dc];
  const m = new THREE.MeshLambertMaterial({ color });
  if (kind) {
    m.defines = { [`DETAIL_${kind}`]: '' };
    m.customProgramCacheKey = () => `detail-${kind}`;
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWp;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>\n${DETAIL_GLSL}`)
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= inkDetail(vWp);');
    };
  }
  return m;
}

export function createApartment() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(64, 1, 0.14, 1400);   // cercano a 14 cm: precisión de profundidad sin parpadeo en marcos
  const api = { scene, camera, ready: false, marks: [], plan: [], length: 60 };
  let path = [];

  // Luz: cielo suave, sol entrando por el ventanal (oriente) con sombra, y lámparas cálidas
  scene.add(new THREE.HemisphereLight(0xffffff, 0xd9d2c4, 1.15));
  const sun = new THREE.DirectionalLight(0xffffff, 2.5);
  sun.target.position.set(5.5, 0, -5.8);
  sun.position.copy(sun.target.position).add(new THREE.Vector3(1, 0.46, -0.34).normalize().multiplyScalar(36));
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 9, bottom: -9, near: 1, far: 80 });
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);
  for (const [x, y, z, power] of [[2.9, 1.7, -2.05, 5], [3.4, 1.75, -5.1, 4], [1.2, 2.3, -9.4, 6], [4.3, 2.3, -10, 4], [8, 2.3, -10, 5], [3.6, 2.4, -7.75, 5]]) {
    const l = new THREE.PointLight(0xffffff, power, 7, 2);
    l.position.set(x, y, z);
    scene.add(l);
  }

  // Cordillera al fondo: siluetas de papel que la tinta contornea
  {
    const mat = new THREE.MeshBasicMaterial({ color: 0xf6f5f1, side: THREE.DoubleSide });
    for (const [x, base, amp, seed] of [[900, 60, 300, 4], [680, 10, 190, 2.4], [480, -30, 110, 1]]) scene.add(ridgeMesh(x, base, amp, seed, mat));
  }
  function ridgeMesh(x, base, amp, seed, mat) {
    {
      const N = 160, pos = [], idx = [];
      for (let i = 0; i <= N; i++) {
        const z = -1000 + (i / N) * 2000;
        const h = base + amp * (0.5 + 0.5 * Math.sin(z * 0.0052 + seed)) * (0.62 + 0.38 * Math.sin(z * 0.017 + seed * 3)) + amp * 0.1 * Math.sin(z * 0.06 + seed);
        pos.push(x, h, z, x, -260, z);
        if (i < N) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      return new THREE.Mesh(g, mat);
    }
  }

  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const cache = {};
  // El apartamento no hace falta para ver la torre: se pide con start(), después de entrar,
  // para no competir con la carga inicial.
  let begin;
  api.start = () => begin();
  api.load = new Promise((res) => { begin = res; }).then(() => Promise.all([
    new Promise((res, rej) => loader.load('/models/apto.glb' + ART, res, undefined, rej)),
    fetch('/models/apto.json' + ART).then((r) => r.json()),
  ]).then(([gltf, data]) => {
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      const name = o.material.name;
      o.material = cache[name] || (cache[name] = material(name));
      if (GLASS.includes(name)) { o.layers.set(2); return; }        // fuera del pase de contornos
      o.castShadow = !GLOW[name];
      o.receiveShadow = !GLOW[name];
    });
    scene.add(gltf.scene);
    path = data.path;
    api.marks = data.marks;
    api.length = data.length;
    // Para el minimapa: planta en metros (x, y) y rumbo
    api.plan = path.map((p) => [p[0], -p[2], Math.atan2(-p[5], p[3])]);
    api.ready = true;
    return api;
  }));

  // El barrio de la torre, visto desde el piso 14
  let city = null;
  // Altura del piso que se recorre: el barrio (y su suelo) bajan o suben para que la vista sea la de ese piso.
  let floorY = 43.2;
  const grounded = [];
  api.setFloor = (fi) => {
    floorY = 8 + fi * 3.2;
    for (const [o, extra] of grounded) o.position.y = -floorY - extra;
  };
  const placeCity = (target) => {
    const c = city.clone();
    c.position.set(-5, -floorY - 0.2, 6);
    grounded.push([c, 0.2]);
    if (target !== scene) {
      // En la versión realista el barrio lleva colores de ciudad, no de lámina
      const tint = { conc: 0xe7e1d6, glass: 0x6f8798, frame: 0x3a3a3a, wood: 0x9a7650, green: 0x56794a, rail: 0xcfd6da, roof: 0xa8563a, road: 0x8d8f8e };
      const made = {};
      c.traverse((o) => {
        if (!o.isMesh) return;
        const key = o.material.userData.key || 'conc';
        o.material = made[key] || (made[key] = new THREE.MeshLambertMaterial({ color: tint[key] || tint.conc, side: o.material.side }));
      });
    }
    target.add(c);
  };
  api.setCity = (barrio) => {
    city = barrio;
    placeCity(scene);
    if (api.real.scene) placeCity(api.real.scene);
  };

  // Versión realista: mismo apartamento con muebles detallados y la luz horneada en Blender
  // (sol, cielo, rebotes y lámparas ya vienen pintados en tres texturas). No hay luces que calcular,
  // así que es incluso más liviana de dibujar que la tinta. Se descarga solo cuando se pide.
  api.real = { ready: false, scene: null, pending: null, mirrors: [] };
  api.loadReal = (renderer, light) => api.real.pending || (api.real.pending = (async () => {
    // 4K solo en equipos con memoria de sobra; el resto usa 2K, que pesa la cuarta parte
    const size = light || renderer.capabilities.maxTextureSize < 8192 || (navigator.deviceMemory || 8) < 8 ? '2k' : '4k';
    const tex = (name) => new THREE.TextureLoader().loadAsync(`/models/apto-${name}-${size}.webp${ART}`).then((t) => {
      t.flipY = false;                                   // convención de glTF
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      return t;
    });
    const [gltf, arq, tel, mob] = await Promise.all([
      new Promise((res, rej) => loader.load('/models/apto-real.glb' + ART, res, undefined, rej)), tex('arq'), tex('tel'), tex('mob'),
    ]);
    const rs = new THREE.Scene();
    const HAZE = 0xdfe7ec;
    rs.fog = new THREE.Fog(HAZE, 120, 950);                               // bruma de mañana: el barrio se funde con la distancia
    rs.add(new THREE.HemisphereLight(0xdfeaf5, 0x8f8a7c, 1.5));           // luces solo para el barrio, afuera
    const sunR = new THREE.DirectionalLight(0xffe6c4, 2.6);
    sunR.position.set(1, 0.46, -0.34);
    rs.add(sunR);
    // Cielo: degradado de la bruma del horizonte al azul alto, con el resplandor del sol naciente
    rs.add(new THREE.Mesh(new THREE.SphereGeometry(1200, 32, 16), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { uSun: { value: new THREE.Vector3(1, 0.46, -0.34).normalize() } },
      vertexShader: 'varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `
        uniform vec3 uSun; varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          float h = clamp(d.y, 0.0, 1.0);
          vec3 c = mix(vec3(0.875, 0.906, 0.925), vec3(0.47, 0.66, 0.86), pow(h, 0.55));
          float s = max(dot(d, uSun), 0.0);
          c += vec3(1.0, 0.86, 0.66) * (pow(s, 6.0) * 0.28 + pow(s, 90.0) * 0.6);
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
    })));
    // Suelo de la ciudad bajo el barrio, para que no flote sobre el vacío
    const ground = new THREE.Mesh(new THREE.CircleGeometry(1000, 48), new THREE.MeshLambertMaterial({ color: 0x9aa58f }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -floorY - 0.4;
    grounded.push([ground, 0.4]);
    rs.add(ground);
    // La textura horneada trae la luz; de cerca se le suma un grano fino propio de cada superficie
    // (revoque, veta, tejido), calculado por sombreador: la pared no se ve lavada al acercarse.
    const flat = (map, grain) => {
      const m = new THREE.MeshBasicMaterial({ map, fog: false });
      m.customProgramCacheKey = () => `fino-${grain.length}`;
      m.onBeforeCompile = (sh) => {
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vWp;')
          .replace('#include <project_vertex>', '#include <project_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', `#include <common>
            varying vec3 vWp;
            float fh(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
            float fn(vec3 x) {
              vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
              return mix(mix(mix(fh(i), fh(i + vec3(1, 0, 0)), f.x), mix(fh(i + vec3(0, 1, 0)), fh(i + vec3(1, 1, 0)), f.x), f.y),
                         mix(mix(fh(i + vec3(0, 0, 1)), fh(i + vec3(1, 0, 1)), f.x), mix(fh(i + vec3(0, 1, 1)), fh(i + vec3(1, 1, 1)), f.x), f.y), f.z);
            }`)
          .replace('#include <map_fragment>', `#include <map_fragment>
            {
              vec3 p = vWp;
              float dist = distance(p, cameraPosition), near = 1.0 - smoothstep(1.2, 5.0, dist), g = 0.0;
              ${grain}
              diffuseColor.rgb *= 1.0 + g;
            }`);
      };
      return m;
    };
    // Cada grupo tiene su superficie: revoque con manchas suaves, veta fina a lo largo, y trama de tejido.
    const GRAIN = {
      arq: 'g = (fn(p * 95.0) * 0.6 + fn(p * 340.0) * 0.4 - 0.5) * 0.035 * near + (fn(p * 1.4) - 0.5) * 0.035;',
      mob: 'g = ((fn(vec3(p.x * 12.0, p.y * 150.0, p.z * 150.0)) + fn(vec3(p.x * 150.0, p.y * 150.0, p.z * 12.0))) * 0.5 - 0.5) * 0.085 * near;',
      tel: 'float close = 1.0 - smoothstep(0.6, 2.4, dist); g = (sin(p.x * 760.0) * sin(p.y * 760.0) + sin(p.z * 760.0) * sin(p.y * 760.0)) * 0.03 * close + (fn(p * 240.0) - 0.5) * 0.09 * near;',
    };
    const baked = { arq: flat(arq, GRAIN.arq), tel: flat(tel, GRAIN.tel), mob: flat(mob, GRAIN.mob) };   // arquitectura, textiles, resto del mobiliario
    const glass = {
      vidrio: new THREE.MeshBasicMaterial({ color: 0xdfeaf0, transparent: true, opacity: 0.1, depthWrite: false, fog: false }),
      esmerilado: new THREE.MeshBasicMaterial({ color: 0xeef3f4, transparent: true, opacity: 0.45, depthWrite: false, fog: false }),
    };
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      let group = o;
      while (group.parent && !/^(arq|tel|mob|vidrio|luz)/.test(group.name)) group = group.parent;
      const key = group.name.match(/^(arq|tel|mob|vidrio|luz)/)?.[1], name = o.material.name;
      if (baked[key]) o.material = baked[key];
      else if (key === 'vidrio') { o.material = glass[name] || glass.vidrio; o.renderOrder = 2; }
      else o.material = new THREE.MeshBasicMaterial({ color: GLOW[name] || 0xfff1d6, fog: false });
    });
    // Los marcos tocan el muro: van un pelo por delante para que no parpadeen
    Object.assign(baked.mob, { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    rs.add(gltf.scene);
    // Cordillera en tres planos: cada uno más azul y más claro con la distancia
    for (const [x, base, amp, seed, color] of [[900, 60, 300, 4, 0xbccbd9], [680, 10, 190, 2.4, 0x9fb4c2], [480, -30, 110, 1, 0x7f9a93]]) {
      rs.add(ridgeMesh(x, base, amp, seed, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, fog: false })));
    }
    // Espejos de verdad: reflejan la escena (baño y alcoba principal). Solo se calculan estando cerca.
    const res = light ? 512 : 1024;
    const mirror = (geo, x, y, z, turn) => {
      const m = new Reflector(geo, { textureWidth: res, textureHeight: res, clipBias: 0.003, multisample: light ? 0 : 4 });
      m.position.set(x, y, z);
      m.rotation.y = turn;
      rs.add(m);
      api.real.mirrors.push(m);
    };
    mirror(new THREE.CircleGeometry(0.4, 56), 0.034, 1.62, -9.3, Math.PI / 2);          // redondo, sobre el lavamanos
    mirror(new THREE.PlaneGeometry(0.82, 1.62), 6.5, 1.05, -8.454, Math.PI);            // de cuerpo entero
    api.real.scene = rs;
    if (city) placeCity(rs);
    await renderer.compileAsync?.(rs, camera);
    api.real.ready = true;
  })().catch((err) => { api.real.pending = null; throw err; }));

  const a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3(), right = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);
  // t: 0..1 del recorrido. lookX/lookY (-1..1): la mirada sigue un poco al cursor.
  api.pose = (t, lookX = 0, lookY = 0) => {
    if (!path.length) return;
    const f = Math.min(Math.max(t, 0), 1) * (path.length - 1);
    const i = Math.min(Math.floor(f), path.length - 2), k = f - i;
    const p0 = path[i], p1 = path[i + 1];
    a.set(p0[0], p0[1], p0[2]).lerp(b.set(p1[0], p1[1], p1[2]), k);
    d.set(p0[3], p0[4], p0[5]).lerp(b.set(p1[3], p1[4], p1[5]), k).normalize();
    right.crossVectors(d, UP).normalize();
    d.addScaledVector(right, lookX * 0.32).addScaledVector(UP, -lookY * 0.18).normalize();
    camera.position.copy(a);
    camera.lookAt(b.copy(a).add(d));
    for (const m of api.real.mirrors) m.visible = m.position.distanceTo(a) < 4.6;
  };

  api.resize = (w, h) => {
    camera.aspect = w / h;
    camera.fov = h > w ? 82 : 64;
    camera.updateProjectionMatrix();
  };
  return api;
}
