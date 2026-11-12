// Recorrido interior pre-renderizado en Blender: una imagen por cuadro, el scroll decide cuál.
//
// Por qué va fluido:
//  - Las imágenes se descargan una vez y quedan comprimidas en memoria.
//  - Solo se decodifica una ventana alrededor del cuadro actual, lista antes de llegar.
//  - Se dibuja en la GPU, en el mismo lienzo WebGL de la torre: dos texturas mezcladas por un
//    sombreador. Nada de lienzos 2D apilados ni capas extra que el navegador tenga que componer.
import * as THREE from 'three';

const BEHIND = 14, AHEAD = 34, KEEP = 80;

export function createTour(renderer, base = '/tour/') {
  let frames = 0, marks = [], path = [], blobs = [], loaded = 0, center = 0;
  const bitmaps = new Map(), pending = new Set();
  let curA = -1, curB = -1, aspect = 16 / 9;

  const mkTex = () => {
    const t = new THREE.Texture();
    t.flipY = false;                       // los ImageBitmap se voltean al crearlos
    t.generateMipmaps = false;
    t.minFilter = t.magFilter = THREE.LinearFilter;
    t.colorSpace = THREE.NoColorSpace;     // los cuadros ya vienen en color de pantalla
    return t;
  };
  const texA = mkTex(), texB = mkTex();
  const material = new THREE.ShaderMaterial({
    depthTest: false, depthWrite: false,
    uniforms: { tA: { value: texA }, tB: { value: texB }, uMix: { value: 0 }, uScale: { value: new THREE.Vector2(1, 1) },
      uTint: { value: new THREE.Vector3(0.61, 0.545, 0.37) } },
    vertexShader: 'varying vec2 vUv; uniform vec2 uScale; void main(){ vUv = (uv - 0.5) * uScale + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    // El único color de los cuadros es el ocre: se reemplaza por el acabado elegido conservando la luz.
    fragmentShader: `uniform sampler2D tA, tB; uniform float uMix; uniform vec3 uTint; varying vec2 vUv;
      void main(){
        vec3 c = mix(texture2D(tA, vUv).rgb, texture2D(tB, vUv).rgb, uMix);
        float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b));
        float k = smoothstep(0.1, 0.24, (mx - mn) / max(mx, 0.001));
        float l = dot(c, vec3(0.299, 0.587, 0.114));
        gl_FragColor = vec4(mix(c, uTint * (l / 0.56), k), 1.0);
      }`,
  });
  const scene = new THREE.Scene();
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  scene.add(quad);
  const cam = new THREE.Camera();

  async function load() {
    const m = await (await fetch(base + 'tour.json')).json();
    frames = m.frames;
    marks = m.marks || [];
    path = m.path || [];
    blobs = new Array(frames);
    let next = 0;
    const worker = async () => {
      while (next < frames) {
        const i = next++;
        try {
          blobs[i] = await (await fetch(`${base}f_${String(i).padStart(3, '0')}.webp`)).blob();
          loaded++;
          if (Math.abs(i - center) <= AHEAD) decode(i);
        } catch { /* se salta el cuadro */ }
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
  }

  function decode(i) {
    if (i < 0 || i >= frames || bitmaps.has(i) || pending.has(i) || !blobs[i]) return;
    pending.add(i);
    createImageBitmap(blobs[i], { imageOrientation: 'flipY' }).then((b) => {
      pending.delete(i);
      bitmaps.set(i, b);
      aspect = b.width / b.height;
      if (bitmaps.size > KEEP) {
        let far = -1, dist = -1;
        for (const k of bitmaps.keys()) {
          const d = Math.abs(k - center);
          if (d > dist && k !== curA && k !== curB) { dist = d; far = k; }
        }
        if (far >= 0) { bitmaps.get(far).close(); bitmaps.delete(far); }
      }
    }).catch(() => pending.delete(i));
  }

  function resize(w, h) {
    const screen = w / h;                  // la imagen cubre la pantalla sin deformarse
    material.uniforms.uScale.value.set(Math.min(1, screen / aspect), Math.min(1, aspect / screen));
  }

  function nearest(i) {
    for (let d = 0; d < 60; d++) {
      if (bitmaps.has(i - d)) return i - d;
      if (bitmaps.has(i + d)) return i + d;
    }
    return -1;
  }

  // t: 0..1 de todo el recorrido. Dibuja y devuelve el rótulo del espacio actual.
  function render(t) {
    if (!frames) return null;
    const f = Math.min(Math.max(t, 0), 1) * (frames - 1);
    const i = Math.round(f);          // cuadro exacto, sin mezclar dos: la mezcla se veía como imagen doble
    center = i;
    for (let d = -BEHIND; d <= AHEAD; d++) decode(i + d);

    const a = bitmaps.has(i) ? i : nearest(i);
    if (a >= 0) {
      if (a !== curA) { texA.image = bitmaps.get(a); texA.needsUpdate = true; curA = a; curB = a; }
      material.uniforms.uMix.value = 0;
      renderer.setRenderTarget(null);
      renderer.render(scene, cam);
    }

    const at = Math.round(f);
    let k = 0;
    for (let j = 0; j < marks.length; j++) if (marks[j].frame <= at) k = j;
    const mk = marks[k] || { title: '', text: '' };
    return { title: mk.title, text: mk.text, key: k, progress: f / Math.max(1, frames - 1) };
  }

  return {
    load, resize, render,
    progress: () => (frames ? loaded / frames : 0),
    path: () => path,
    setTint(hex) { const c = new THREE.Color(hex).convertLinearToSRGB(); material.uniforms.uTint.value.set(c.r, c.g, c.b); },
  };
}
