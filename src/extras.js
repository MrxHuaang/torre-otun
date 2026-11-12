// Minimapa del apartamento para el recorrido interior: plano, posición, áreas y salto a cada espacio.

// Planta del apartamento tipo A, en metros (igual que el modelo de Blender).
const WALLS = [
  'M0 0H10V11.6H0Z', 'M10 0H12V7H10',
  'M0 7.1H0.3M1.3 7.1H10', 'M0 8.35H0.85M1.75 8.35H2.65M3.55 8.35H7',
  'M2.45 8.35V11.6', 'M5.95 8.35V11.6', 'M7 7.1V7.3M7 8.2V8.35',
];
// Espacio: rótulo, centro del rótulo (x, y), área en m², rectángulo que ocupa [x, y, ancho, alto] y su nombre en el recorrido.
const ROOMS = [
  ['Cocina', 2.6, 1.5, 18, [0, 0, 5, 3.2], 'Cocina'],
  ['Comedor', 2.6, 5.2, 20, [0, 3.2, 5, 3.9], 'Sala comedor'],
  ['Sala', 7.4, 3.6, 32, [5, 0, 5, 7.1], 'Sala'],
  ['Balcón', 11, 3.4, 14, [10, 0, 2, 7], 'Balcón'],
  ['Baño', 1.2, 10, 7.7, [0, 8.35, 2.45, 3.25], 'Baño'],
  ['Alcoba 2', 4.2, 10, 11, [2.45, 8.35, 3.5, 3.25], 'Alcoba 2'],
  ['Principal', 8, 10.2, 12.8, [5.95, 8.35, 4.05, 3.25], 'Alcoba principal'],
  ['Vestier', 8.6, 7.6, 3.3, [7, 7.1, 3, 1.25], 'Vestier'],
];
const m2 = (a) => `${String(a).replace('.', ',')} m²`;

// Área de cada espacio por su nombre en el recorrido (para el rótulo que acompaña la caminata).
export const AREAS = { Pasillo: m2(8.4), 'Hacia las alcobas': '', ...Object.fromEntries(ROOMS.map((r) => [r[5], m2(r[3])])) };

export function createMinimap(el) {
  const S = 20;                                    // píxeles por metro en el SVG
  const pt = (x, y) => `${(x * S).toFixed(1)},${(y * S).toFixed(1)}`;
  const scale = (d) => d.replace(/([MHVZ])|(-?\d*\.?\d+)/g, (m, c, n) => (c ? c : (parseFloat(n) * S).toFixed(1)));
  el.innerHTML = `
    <svg viewBox="-6 -6 ${12 * S + 12} ${11.6 * S + 12}" role="img" aria-label="Plano del apartamento con tu posición">
      ${ROOMS.map(([, , , , [x, y, w, h], stop]) => `<rect class="room" data-stop="${stop}" x="${x * S}" y="${y * S}" width="${w * S}" height="${h * S}"/>`).join('')}
      ${WALLS.map((d) => `<path class="w" d="${scale(d)}"/>`).join('')}
      ${ROOMS.map(([t, x, y, a]) => `<text x="${x * S}" y="${y * S}">${t}<tspan class="area" x="${x * S}" dy="10">${m2(a)}</tspan></text>`).join('')}
      <polyline class="trail" points=""/>
      <g class="me"><path d="M0 -9L6 5L0 2L-6 5Z"/></g>
    </svg>`;
  const trail = el.querySelector('.trail'), me = el.querySelector('.me');
  let path = [], lastK = -1;
  return {
    setPath(p) { path = p || []; },
    // Tocar un espacio del plano: avisa con su nombre en el recorrido.
    onPick(fn) {
      el.addEventListener('click', (ev) => {
        const room = ev.target.closest('.room');
        if (room) fn(room.dataset.stop);
      });
    },
    update(progress) {
      if (!path.length) return;
      const k = Math.min(path.length - 1, Math.round(progress * (path.length - 1)));
      if (k === lastK) return;
      lastK = k;
      const [x, y, yaw] = path[k];
      // En el SVG la Y crece hacia abajo; el giro del modelo es antihorario desde +X.
      me.setAttribute('transform', `translate(${pt(x, y)}) rotate(${(yaw * 180) / Math.PI + 90})`);
      const pts = [];
      for (let i = 0; i <= k; i += 3) pts.push(pt(path[i][0], path[i][1]));
      trail.setAttribute('points', pts.join(' '));
    },
  };
}
