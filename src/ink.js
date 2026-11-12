// Pase de tinta: convierte cualquier escena 3D en un grabado a pluma.
//  1) color de la escena  → tono (decide achurado) y color plano ocre
//  2) normales + profundidad → contornos
//  3) cuadro final: papel, achurado cruzado, contornos con pulso de mano
//  4) las líneas vectoriales (capa 1) se dibujan encima, respetando profundidad
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const auxMaterial = new THREE.ShaderMaterial({
  uniforms: { uFar: { value: 1000 } },
  vertexShader: /* glsl */ `
    varying vec3 vN; varying float vD;
    void main() {
      vec3 n = normal; vec4 p = vec4(position, 1.0);
      #ifdef USE_INSTANCING
        p = instanceMatrix * p; n = mat3(instanceMatrix) * n;
      #endif
      vec4 mv = modelViewMatrix * p;
      vN = normalize(normalMatrix * n); vD = -mv.z;
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */ `
    uniform float uFar; varying vec3 vN; varying float vD;
    void main() { gl_FragColor = vec4(normalize(vN) * 0.5 + 0.5, clamp(vD / uFar, 0.0, 1.0)); }`,
});

const inkMaterial = new THREE.ShaderMaterial({
  depthFunc: THREE.AlwaysDepth,
  uniforms: {
    tColor: { value: null }, tAux: { value: null },
    uRes: { value: new THREE.Vector2(1, 1) }, uDpr: { value: 1 }, uTime: { value: 0 },
    uFar: { value: 1000 }, uP22: { value: 0 }, uP32: { value: 0 },
    uFadeA: { value: 200 }, uFadeB: { value: 500 }, uExposure: { value: 1 },
    uPaper: { value: new THREE.Color() }, uInk: { value: new THREE.Color() }, uOchre: { value: new THREE.Color() },
  },
  vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tColor, tAux;
    uniform vec2 uRes;
    uniform float uDpr, uTime, uFar, uP22, uP32, uFadeA, uFadeB, uExposure;
    uniform vec3 uPaper, uInk, uOchre;
    varying vec2 vUv;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
    }
    // Trazos paralelos: 0 = tinta, 1 = papel. w = grosor (0..0.5). Los trazos se cortan como a mano.
    float hatch(vec2 p, float ang, float sp, float w) {
      vec2 d = vec2(cos(ang), sin(ang));
      float c = dot(p, d) / sp;
      float f = abs(fract(c) - 0.5);
      float aa = fwidth(c);
      float l = smoothstep(w - aa, w + aa, f);
      return l;
    }

    void main() {
      vec2 px = gl_FragCoord.xy / uDpr;
      vec2 wob = (vec2(noise(px * 0.03 + uTime), noise(px * 0.03 + 31.7 - uTime)) - 0.5) * 1.2;
      vec2 uv = vUv + wob * uDpr / uRes * 0.7;

      // --- Contornos: laplaciano de profundidad inversa + salto de normal
      vec2 o = uDpr * 1.15 / uRes;
      vec4 a0 = texture2D(tAux, uv);
      vec4 a1 = texture2D(tAux, uv + o), a2 = texture2D(tAux, uv - o);
      vec4 a3 = texture2D(tAux, uv + o * vec2(-1.0, 1.0)), a4 = texture2D(tAux, uv + o * vec2(1.0, -1.0));
      float i0 = 1.0 / max(a0.a, 1e-4);
      float lap = abs(1.0 / max(a1.a, 1e-4) + 1.0 / max(a2.a, 1e-4) - 2.0 * i0)
                + abs(1.0 / max(a3.a, 1e-4) + 1.0 / max(a4.a, 1e-4) - 2.0 * i0);
      float dd = lap / i0;
      float nd = length(a1.rgb - a2.rgb) + length(a3.rgb - a4.rgb);
      float edge = max(smoothstep(0.02, 0.07, dd), smoothstep(0.4, 0.9, nd));
      float dist = a0.a * uFar;
      edge *= 1.0 - smoothstep(uFadeA, uFadeB, dist);

      // --- Tono y color plano
      vec3 c = pow(clamp(texture2D(tColor, vUv).rgb * uExposure, 0.0, 1.0), vec3(1.0 / 2.2));
      float t = dot(c, vec3(0.299, 0.587, 0.114));
      float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b));
      float sat = (mx - mn) / max(mx, 1e-3);
      float warm = step(c.b * 1.1, c.r) * step(c.g * 0.85, c.r);
      float spot = smoothstep(0.2, 0.32, sat) * warm * smoothstep(0.1, 0.28, t);
      vec3 base = mix(uPaper, uOchre, spot);
      float th = mix(t, t * 1.2 + 0.14, spot);

      // --- Achurado cruzado según oscuridad
      // Sombra en tres escalones limpios: aguada gris, trama ancha solo en lo oscuro, negro
      float wash = smoothstep(0.62, 0.54, th), hat = smoothstep(0.36, 0.22, th);
      float ink = mix(1.0, hatch(px + wob, 0.7, 8.0, 0.05 + 0.15 * hat), step(0.001, hat));
      ink *= smoothstep(0.05, 0.11, th);
      ink *= 1.0 - edge;
      base *= 1.0 - 0.13 * wash;

      float grain = (hash(px) - 0.5) * 0.035 + (noise(px * 0.012) - 0.5) * 0.03;
      gl_FragColor = vec4(mix(uInk, base, ink) + grain, 1.0);

      // Profundidad real, para que las líneas vectoriales se oculten bien detrás.
      float d = texture2D(tAux, vUv).a * uFar * 1.004;
      gl_FragDepth = d >= uFar * 0.999 ? 1.0 : ((uP22 * -d + uP32) / d) * 0.5 + 0.5;
    }`,
});

export function createInk(renderer, { paper, ink, ochre }) {
  const opts = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
  const rtColor = new THREE.WebGLRenderTarget(1, 1, { ...opts, type: THREE.HalfFloatType, samples: 4 });
  const rtAux = new THREE.WebGLRenderTarget(1, 1, { ...opts, type: THREE.HalfFloatType });
  const quad = new FullScreenQuad(inkMaterial);
  const u = inkMaterial.uniforms;
  u.uPaper.value.set(paper).convertLinearToSRGB();
  u.uInk.value.set(ink).convertLinearToSRGB();
  u.uOchre.value.set(ochre).convertLinearToSRGB();
  u.tColor.value = rtColor.texture;
  u.tAux.value = rtAux.texture;
  const black = new THREE.Color(0, 0, 0);
  const prev = new THREE.Color();

  return {
    setOchre(c) { u.uOchre.value.set(c).convertLinearToSRGB(); },
    setSize(w, h, dpr) {
      rtColor.setSize(w * dpr, h * dpr);
      rtAux.setSize(w * dpr, h * dpr);
      u.uRes.value.set(w * dpr, h * dpr);
      u.uDpr.value = dpr;
    },
    // lines: dibuja la capa 1 (trazos vectoriales) encima. aux(on): oculta/muestra mallas en el pase de contornos.
    render(scene, camera, { fadeA, fadeB, exposure = 1, lines = false, aux } = {}) {
      // 1) color
      camera.layers.set(0); camera.layers.enable(2);
      renderer.setRenderTarget(rtColor);
      renderer.render(scene, camera);
      // 2) normales + profundidad
      camera.layers.set(0);
      auxMaterial.uniforms.uFar.value = camera.far;
      renderer.getClearColor(prev);
      const pa = renderer.getClearAlpha();
      renderer.setClearColor(black, 1);
      scene.overrideMaterial = auxMaterial;
      aux && aux(true);
      renderer.setRenderTarget(rtAux);
      renderer.render(scene, camera);
      aux && aux(false);
      scene.overrideMaterial = null;
      renderer.setClearColor(prev, pa);
      // 3) tinta
      u.uTime.value = Math.floor(performance.now() / 260) * 1.37; // "hervor" de línea a ~4 fps
      u.uFar.value = camera.far;
      u.uP22.value = camera.projectionMatrix.elements[10];
      u.uP32.value = camera.projectionMatrix.elements[14];
      u.uFadeA.value = fadeA; u.uFadeB.value = fadeB; u.uExposure.value = exposure;
      renderer.setRenderTarget(null);
      quad.render(renderer);
      // 4) trazos vectoriales
      if (lines) {
        camera.layers.set(1);
        renderer.autoClear = false;
        renderer.render(scene, camera);
        renderer.autoClear = true;
      }
      camera.layers.set(0);
    },
  };
}
