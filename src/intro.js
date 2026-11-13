// Portada. Nada queda quieto ni plano:
//  1) Carga: el emblema se dibuja trazo a trazo al ritmo real de la carga; abajo, una línea a mano.
//  2) Título: pinceladas que fluyen en tres profundidades; el nombre aparece por franjas verticales
//     mientras cada letra sube. Todo responde al cursor: el título se inclina, cada letra se mueve
//     según su profundidad, su contorno va al lado contrario y una luz sigue al puntero.
//  3) Entrar: una marea de papel con borde de tinta viva sube y cubre la pantalla.
import gsap from 'gsap';

const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
// Versión liviana para pantallas táctiles o pequeñas: menos trazos, sin filtro en la marea y sin seguir al cursor.
const lite = window.matchMedia('(pointer: coarse), (max-width: 900px)').matches;
const rnd = (() => { let s = 5; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();

function emblem() {
  // Marca: la torre escalonada, el sol saliendo detrás de la cordillera y el río Otún abajo.
  const rays = [];
  for (let i = 0; i <= 14; i++) {
    const a = Math.PI + (i / 14) * Math.PI;                 // solo el semicírculo superior
    const r0 = 30, r1 = 96;
    rays.push(`<path class="ray d" pathLength="1" d="M${(100 + Math.cos(a) * r0).toFixed(1)} ${(124 + Math.sin(a) * r0).toFixed(1)}L${(100 + Math.cos(a) * r1).toFixed(1)} ${(124 + Math.sin(a) * r1).toFixed(1)}"/>`);
  }
  return `
    <defs><clipPath id="gClip"><circle cx="100" cy="100" r="89"/></clipPath></defs>
    <g clip-path="url(#gClip)"><g class="rays">${rays.join('')}</g></g>
    <path class="mask" d="M80 124V112h6V66h4v-9h4v-9h4V30h4v18h4v9h4v9h4v46h6v12z"/>
    <path class="tw d" pathLength="1" d="M14 124H186"/>
    <path class="tw d" pathLength="1" d="M80 124V112H120V124"/>
    <path class="tw d" pathLength="1" d="M86 112V66H114V112"/>
    <path class="tw d" pathLength="1" d="M90 66V57H110V66"/>
    <path class="tw d" pathLength="1" d="M94 57V48H106V57"/>
    <path class="tw d" pathLength="1" d="M98 48V30H102V48"/>
    <path class="fl d" pathLength="1" d="M86 78H114"/>
    <path class="fl d" pathLength="1" d="M86 90H114"/>
    <path class="fl d" pathLength="1" d="M86 102H114"/>
    <path class="fl d" pathLength="1" d="M52 137H148"/>
    <path class="fl d" pathLength="1" d="M68 149H132"/>
    <path class="fl d" pathLength="1" d="M84 161H116"/>
    <circle class="ring d" pathLength="1" cx="100" cy="100" r="92" transform="rotate(-90 100 100)"/>`;
}

// Pinceladas en tres planos: lejos (finas, oscuras), medio y cerca (gruesas, más claras).
function brush() {
  const layers = [[], [], []];
  for (let i = 0; i < (lite ? 14 : 30); i++) {
    const depth = i % 3;
    const y = 20 + rnd() * 860, w = (6 + rnd() * 20) * (1 + depth * 0.9), a = (rnd() - 0.5) * 150, b = (rnd() - 0.5) * 150;
    const x0 = -300 + rnd() * 500, len = 900 + rnd() * 1100;
    const d = `M${x0.toFixed(0)} ${y.toFixed(0)}C${(x0 + len * 0.3).toFixed(0)} ${(y + a).toFixed(0)} ${(x0 + len * 0.62).toFixed(0)} ${(y + b).toFixed(0)} ${(x0 + len).toFixed(0)} ${(y + (a + b) / 3).toFixed(0)}`;
    layers[depth].push(`<path class="st" pathLength="1" d="${d}" stroke-width="${w.toFixed(0)}"/>`);
    if (!lite) layers[depth].push(`<path class="st hair" pathLength="1" d="${d}" stroke-width="${(w * 0.14).toFixed(1)}" transform="translate(${(rnd() * 70).toFixed(0)} ${(w * 0.75).toFixed(0)})"/>`);
  }
  // Cada plano es una lámina aparte: los trazos quedan fijos y la lámina se desliza (lo mueve la GPU,
  // sin repintar). Tres láminas a distinto ritmo dan la sensación de pinceladas que fluyen en profundidad.
  return layers.map((l, i) => `<div class="plane p${i}"><svg class="sheet" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice">${l.join('')}</svg></div>`).join('');
}

function tide() {
  const blobs = [];
  for (let i = 0; i < 30; i++) {
    const x = (i / 29) * 1700 - 50 + (rnd() - 0.5) * 40, r = 34 + rnd() * 74;
    blobs.push(`<circle class="bl" cx="${x.toFixed(0)}" cy="${(130 + (rnd() - 0.5) * 50).toFixed(0)}" r="${r.toFixed(0)}"/>`);
  }
  for (let i = 0; i < 9; i++) {
    blobs.push(`<circle class="bl drop" cx="${(rnd() * 1600).toFixed(0)}" cy="${(20 + rnd() * 50).toFixed(0)}" r="${(8 + rnd() * 18).toFixed(0)}"/>`);
  }
  // El filtro que funde las gotas es caro: en la versión liviana el borde va sin fundir.
  if (lite) return `<g><rect x="-100" y="130" width="1800" height="1200"/>${blobs.join('')}</g>`;
  return `<defs><filter id="goo" x="-5%" y="-20%" width="110%" height="140%">
      <feGaussianBlur in="SourceGraphic" stdDeviation="13"/>
      <feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 26 -11"/></filter></defs>
    <g filter="url(#goo)"><rect x="-100" y="130" width="1800" height="1200"/>${blobs.join('')}</g>`;
}

export function createIntro({ getProgress, onEnter, isReady = () => true, onWarm = () => {} }) {
  const gate = document.querySelector('#gate');
  gate.classList.toggle('lite', lite);
  const $ = (sel) => gate.querySelector(sel);
  $('#gateEmblem').innerHTML = emblem();
  $('#gateBrush').innerHTML = brush();
  $('#gateTide').innerHTML = tide();
  const btn = $('#gateBtn'), rule = $('#gateRule'), title = $('.gate-title h2');

  // Cada letra: una pieza que anima GSAP (span) y dentro otra que sigue al cursor (i), con su contorno.
  let n = 0;
  for (const w of gate.querySelectorAll('.gate-title .w')) {
    w.innerHTML = [...w.textContent].map((ch) => {
      const depth = 10 + ((n++ * 37) % 5) * 7;                      // profundidad distinta por letra
      return `<span><i data-ch="${ch}" style="--d:${depth}">${ch}</i></span>`;
    }).join('');
  }
  const chars = gate.querySelectorAll('.gate-title .w span');

  gsap.set(gate.querySelectorAll('.d'), { strokeDasharray: 1, strokeDashoffset: 1 });
  gsap.set(rule, { strokeDasharray: 1, strokeDashoffset: 1 });
  const draw = gsap.timeline({ paused: true })
    .to('#gateEmblem .ring', { strokeDashoffset: 0, duration: 0.5, ease: 'none' }, 0)
    .to('#gateEmblem .ray', { strokeDashoffset: 0, duration: 0.25, ease: 'none', stagger: 0.012 }, 0.1)
    .to('#gateEmblem .tw', { strokeDashoffset: 0, duration: 0.2, ease: 'none', stagger: 0.07 }, 0.3)
    .to('#gateEmblem .fl', { strokeDashoffset: 0, duration: 0.12, ease: 'none', stagger: 0.04 }, 0.55);
  if (!reduce && !lite) gsap.to('#gateEmblem .rays', { scale: 1.06, svgOrigin: '100 124', duration: 3.2, ease: 'sine.inOut', yoyo: true, repeat: -1 });

  // Cursor: dos valores suavizados (-1..1) que el CSS usa en todas las capas
  const m = { x: 0, y: 0, tx: 0, ty: 0, bx: 0, by: 0, tbx: 0, tby: 0 };
  const onMove = (ev) => {
    m.tx = (ev.clientX / window.innerWidth) * 2 - 1;
    m.ty = (ev.clientY / window.innerHeight) * 2 - 1;
    // botón magnético: se acerca al puntero cuando está cerca
    const r = btn.getBoundingClientRect();
    const dx = ev.clientX - (r.left + r.width / 2), dy = ev.clientY - (r.top + r.height / 2);
    const near = Math.hypot(dx, dy) < 170;
    m.tbx = near ? dx * 0.28 : 0;
    m.tby = near ? dy * 0.28 : 0;
  };
  const follow = () => {
    m.x += (m.tx - m.x) * 0.07;
    m.y += (m.ty - m.y) * 0.07;
    m.bx += (m.tbx - m.bx) * 0.16;
    m.by += (m.tby - m.by) * 0.16;
    gate.style.setProperty('--mx', m.x.toFixed(4));
    gate.style.setProperty('--my', m.y.toFixed(4));
    gate.style.setProperty('--bx', `${m.bx.toFixed(2)}px`);
    gate.style.setProperty('--by', `${m.by.toFixed(2)}px`);
  };
  if (!reduce && !lite) {
    window.addEventListener('pointermove', onMove);
    gsap.ticker.add(follow);
  }

  let p = 0, done = false;
  const tick = () => {
    // El avance es por tiempo, no por cuadros: en un teléfono lento hay pocos cuadros por segundo y, contando
    // cuadros, el título tardaba varios segundos en aparecer.
    p = Math.min(1, getProgress());
    draw.progress(p);
    rule.style.strokeDashoffset = 1 - p;
    if (p >= 1 && !done) {
      done = true;
      gsap.ticker.remove(tick);
      reveal();
    }
  };
  gsap.ticker.add(tick);

  // El botón Entrar aparece cuando la escena está lista: no se puede entrar a una torre que aún no existe.
  function whenReady() {
    const check = () => {
      if (!isReady()) return;
      gsap.ticker.remove(check);
      btn.disabled = false;
      btn.focus({ preventScroll: true });
    };
    gsap.ticker.add(check);
    check();
  }
  // Con la primera señal de que alguien usa la página, se prepara el primer cuadro 3D (compilar sombreadores cuesta).
  for (const type of ['pointerdown', 'pointermove', 'touchstart', 'keydown']) gate.addEventListener(type, onWarm, { once: true, passive: true });

  function reveal() {
    const d = reduce ? 0.01 : 1;
    gsap.timeline()
      .to([rule, '.gate-word'], { opacity: 0, duration: 0.4 * d }, 0.2 * d)
      .to('#gateEmblem', { scale: 0.4, yPercent: -98, duration: 0.9 * d, ease: 'power3.inOut' }, 0.1 * d)
      .to(['#gateBrush', '.gate-light'], { opacity: 1, duration: 1.6 * d }, 0.3 * d)
      .to('.gate-title .pre', { opacity: 1, y: 0, duration: 0.7 * d, ease: 'power3.out' }, 0.45 * d)
      .fromTo(title, { '--s': '0px' }, { '--s': '18px', duration: 1.2 * d, ease: 'power2.inOut' }, 0.45 * d)
      .fromTo(chars, { yPercent: 46, opacity: 0 },
        { yPercent: 0, opacity: 1, duration: 0.9 * d, ease: 'power3.out', stagger: 0.045 * d }, 0.45 * d)
      .to('.gate-btn-wrap', { autoAlpha: 1, y: 0, duration: 0.6 * d, ease: 'back.out(1.8)', onStart: whenReady }, 1.5 * d);
  }

  btn.addEventListener('click', () => {
    btn.disabled = true;
    onWarm();
    const d = reduce ? 0.01 : 1;
    if (!reduce && !lite) {
      gate.querySelectorAll('.bl').forEach((c) => gsap.to(c, {
        attr: { cy: `+=${(Math.random() - 0.5) * 70}`, r: `+=${(Math.random() - 0.3) * 26}` },
        duration: 0.5 + Math.random() * 0.7, yoyo: true, repeat: 5, ease: 'sine.inOut',
      }));
    }
    gsap.timeline()
      .to('.gate-btn-wrap', { autoAlpha: 0, scale: 0.8, duration: 0.3 * d }, 0)
      .fromTo('#gateTide', { yPercent: 108 }, { yPercent: -16, duration: 1.7 * d, ease: 'power2.inOut' }, 0.05 * d)
      .to(chars, { yPercent: -60, opacity: 0, duration: 0.7 * d, ease: 'power2.in', stagger: 0.03 * d }, 0.25 * d)
      .to(['.gate-title .pre', '#gateEmblem'], { opacity: 0, duration: 0.5 * d }, 0.3 * d)
      .add(onEnter, 1.1 * d)
      .set(['.gate-half', '#gateBrush', '.gate-title', '.gate-light'], { display: 'none' }, 1.75 * d)
      .to('#gateTide', { opacity: 0, duration: 0.8 * d, ease: 'power2.out' }, 1.8 * d)
      .add(() => {
        window.removeEventListener('pointermove', onMove);
        gsap.ticker.remove(follow);
      })
      .set(gate, { display: 'none' });
  });
}
