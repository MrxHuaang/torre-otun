// Pase de tinta: convierte cualquier escena 3D en una lámina a pluma, en tiempo real.
//  1) color de la escena              → tono (decide aguada y trama) y color plano
//  2) normales + textura de profundidad → contornos
//  3) cuadro final: papel, aguada, trama y contornos; trama y contornos van pegados a las superficies
//  4) las líneas vectoriales (capa 1) se dibujan encima, respetando profundidad
//
// Solo usa texturas de 8 bits y una textura de profundidad estándar, así corre igual en
// escritorio, móviles y Safari (antes dependía de texturas flotantes, que muchos equipos no tienen).
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const auxMaterial = new THREE.ShaderMaterial({
  vertexShader: /* glsl */ `
    varying vec3 vN;
    void main() {
      vec3 n = normal; vec4 p = vec4(position, 1.0);
      #ifdef USE_INSTANCING
        p = instanceMatrix * p; n = mat3(instanceMatrix) * n;
      #endif
      vN = normalize(normalMatrix * n);
      gl_Position = projectionMatrix * modelViewMatrix * p;
    }`,
  fragmentShader: /* glsl */ `
    varying vec3 vN;
    void main() { gl_FragColor = vec4(normalize(vN) * 0.5 + 0.5, 1.0); }`,
});

const inkMaterial = new THREE.ShaderMaterial({
  depthFunc: THREE.AlwaysDepth,
  uniforms: {
    tColor: { value: null }, tNormal: { value: null }, tDepth: { value: null },
    uRes: { value: new THREE.Vector2(1, 1) }, uDpr: { value: 1 },
    uNear: { value: 0.5 }, uFar: { value: 1000 }, uP22: { value: 0 }, uP32: { value: 0 },
    uFadeA: { value: 200 }, uFadeB: { value: 500 }, uExposure: { value: 1 },
    uPaper: { value: new THREE.Color() }, uInk: { value: new THREE.Color() }, uOchre: { value: new THREE.Color() },
    uInvViewProj: { value: new THREE.Matrix4() }, uCamRot: { value: new THREE.Matrix3() }, uPix: { value: 0.001 },
  },
  vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tColor, tNormal, tDepth;
    uniform vec2 uRes;
    uniform float uDpr, uNear, uFar, uP22, uP32, uFadeA, uFadeB, uExposure;
    uniform vec3 uPaper, uInk, uOchre;
    uniform mat4 uInvViewProj;
    uniform mat3 uCamRot;
    uniform float uPix;
    varying vec2 vUv;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
    }
    // Trazos paralelos: 0 = tinta, 1 = papel. c = coordenada medida en trazos; w = medio grosor (0..0.5).
    float strokes(float c, float w) {
      float f = abs(fract(c) - 0.5), aa = fwidth(c);
      return mix(1.0, smoothstep(w - aa, w + aa, f), 1.0 - smoothstep(0.35, 0.7, aa));   // si no caben, se funden en vez de vibrar
    }
    // Trama anclada a las superficies, no a la pantalla: al mover la vista los trazos se quedan sobre el objeto.
    // El paso entre trazos se ajusta a la distancia en saltos de doble o mitad, fundiendo un nivel con el siguiente,
    // para que en pantalla siempre midan parecido.
    float hatchWorld(vec2 uv, float d, float w) {
      vec4 wp = uInvViewProj * vec4(uv * 2.0 - 1.0, texture2D(tDepth, uv).x * 2.0 - 1.0, 1.0);
      vec3 p = wp.xyz / wp.w;
      vec3 n = normalize(uCamRot * (texture2D(tNormal, uv).rgb * 2.0 - 1.0));
      float c = dot(p - n * dot(p, n), vec3(0.545, 0.709, 0.447));       // sobre el plano de la cara, en diagonal
      float level = log2(max(d * uPix * 8.0, 1e-4));                     // 8 px entre trazos
      float l0 = floor(level), f = level - l0;
      return mix(strokes(c / exp2(l0), w), strokes(c / exp2(l0 + 1.0), w), f);
    }
    // Distancia a la cámara a partir de la profundidad guardada (proyección en perspectiva).
    float dist(vec2 uv) {
      float z = texture2D(tDepth, uv).x * 2.0 - 1.0;
      return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
    }

    // Contorno en un punto: laplaciano de profundidad inversa (los planos dan 0) + salto de normal.
    float edgeAt(vec2 uv) {
      vec2 o = uDpr * 1.1 / uRes;
      float d0 = dist(uv), i0 = 1.0 / d0;
      float lap = abs(1.0 / dist(uv + o) + 1.0 / dist(uv - o) - 2.0 * i0)
                + abs(1.0 / dist(uv + o * vec2(-1.0, 1.0)) + 1.0 / dist(uv + o * vec2(1.0, -1.0)) - 2.0 * i0);
      vec3 n1 = texture2D(tNormal, uv + o).rgb, n2 = texture2D(tNormal, uv - o).rgb;
      vec3 n3 = texture2D(tNormal, uv + o * vec2(-1.0, 1.0)).rgb, n4 = texture2D(tNormal, uv + o * vec2(1.0, -1.0)).rgb;
      float nd = length(n1 - n2) + length(n3 - n4);
      return max(smoothstep(0.02, 0.07, lap / i0), smoothstep(0.4, 0.9, nd)) * (1.0 - smoothstep(uFadeA, uFadeB, d0));
    }

    void main() {
      vec2 px = gl_FragCoord.xy / uDpr;
      // El contorno va pegado a la geometría, sin temblor de pantalla: así no "nada" cuando la escena se mueve.
      // Se calcula en varios puntos dentro del píxel y se promedia: el borde queda suavizado y no parpadea.
      vec2 sub = 1.0 / uRes;
      #ifdef FINE_EDGES
        float edge = (edgeAt(vUv + sub * vec2(0.375, 0.125)) + edgeAt(vUv + sub * vec2(-0.125, 0.375))
                    + edgeAt(vUv + sub * vec2(-0.375, -0.125)) + edgeAt(vUv + sub * vec2(0.125, -0.375))) * 0.25;
      #else
        float edge = (edgeAt(vUv + sub * vec2(0.5, 0.22)) + edgeAt(vUv - sub * vec2(0.5, 0.22))) * 0.5;
      #endif

      // --- Tono y color plano
      vec3 c = pow(clamp(texture2D(tColor, vUv).rgb * uExposure, 0.0, 1.0), vec3(1.0 / 2.2));
      float t = dot(c, vec3(0.299, 0.587, 0.114));
      float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b));
      float sat = (mx - mn) / max(mx, 1e-3);
      float warm = step(c.b * 1.1, c.r) * step(c.g * 0.85, c.r);
      float spot = smoothstep(0.2, 0.32, sat) * warm * smoothstep(0.1, 0.28, t);
      vec3 base = mix(uPaper, uOchre, spot);
      float th = mix(t, t * 1.2 + 0.14, spot);

      // Sombra en tres escalones limpios: aguada gris, trama ancha solo en lo oscuro, negro
      float wash = smoothstep(0.62, 0.54, th), hat = smoothstep(0.36, 0.22, th);
      float ink = hat > 0.001 ? hatchWorld(vUv, dist(vUv), 0.05 + 0.15 * hat) : 1.0;
      ink *= smoothstep(0.05, 0.11, th);
      ink *= 1.0 - edge;
      base *= 1.0 - 0.13 * wash;

      float grain = (hash(px) - 0.5) * 0.03 + (noise(px * 0.012) - 0.5) * 0.03;
      gl_FragColor = vec4(mix(uInk, base, ink) + grain, 1.0);

      // Profundidad real (un pelo más lejos), para que las líneas vectoriales se oculten bien detrás.
      float d = dist(vUv) * 1.004;
      gl_FragDepth = d >= uFar * 0.999 ? 1.0 : ((uP22 * -d + uP32) / d) * 0.5 + 0.5;
    }`,
});

// msaa: multimuestreo del pase de color. fine: contorno con cuatro muestras por píxel (equipos de escritorio).
export function createInk(renderer, { paper, ink, ochre, msaa = true, fine = true }) {
  if (fine) inkMaterial.defines = { FINE_EDGES: '' };
  const rtColor = new THREE.WebGLRenderTarget(1, 1, { samples: msaa ? 4 : 0 });
  // En modo fino, normales y profundidad se dibujan al doble de resolución por lado. El contorno toma cuatro
  // muestras dentro de cada píxel de pantalla, cada una en un texel distinto: suavizado real. Sin esto el trazo
  // salta de píxel en píxel cuando la cámara se mueve despacio y parece que las líneas se arrastran.
  const AUX = fine ? 2 : 1;
  const rtAux = new THREE.WebGLRenderTarget(1, 1, { depthTexture: new THREE.DepthTexture(1, 1) });
  rtAux.depthTexture.minFilter = rtAux.depthTexture.magFilter = THREE.NearestFilter;
  const quad = new FullScreenQuad(inkMaterial);
  const u = inkMaterial.uniforms;
  u.uPaper.value.set(paper).convertLinearToSRGB();
  u.uInk.value.set(ink).convertLinearToSRGB();
  u.uOchre.value.set(ochre).convertLinearToSRGB();
  u.tColor.value = rtColor.texture;
  u.tNormal.value = rtAux.texture;
  u.tDepth.value = rtAux.depthTexture;
  const black = new THREE.Color(0, 0, 0);
  const prev = new THREE.Color();

  return {
    setSize(w, h, dpr) {
      rtColor.setSize(Math.round(w * dpr), Math.round(h * dpr));
      rtAux.setSize(Math.round(w * dpr) * AUX, Math.round(h * dpr) * AUX);
      u.uRes.value.set(Math.round(w * dpr), Math.round(h * dpr));
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
      u.uNear.value = camera.near;
      u.uFar.value = camera.far;
      u.uP22.value = camera.projectionMatrix.elements[10];
      u.uP32.value = camera.projectionMatrix.elements[14];
      u.uFadeA.value = fadeA; u.uFadeB.value = fadeB; u.uExposure.value = exposure;
      u.uInvViewProj.value.multiplyMatrices(camera.matrixWorld, camera.projectionMatrixInverse);
      u.uCamRot.value.setFromMatrix4(camera.matrixWorld);
      u.uPix.value = 2 / (camera.projectionMatrix.elements[5] * (u.uRes.value.y / u.uDpr.value));   // tamaño de un píxel a 1 m
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
