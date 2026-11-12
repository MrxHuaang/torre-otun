// Minimapa del apartamento para el recorrido interior.

/* ------------------------------------------------------------------ minimapa */
// Planta del apartamento tipo A, en metros (igual que el modelo de Blender).
const WALLS = [
  'M0 0H10V11.6H0Z', 'M10 0H12V7H10',
  'M0 7.1H0.3M1.3 7.1H10', 'M0 8.35H0.85M1.75 8.35H2.65M3.55 8.35H7',
  'M2.45 8.35V11.6', 'M5.95 8.35V11.6', 'M7 7.1V7.3M7 8.2V8.35',
];
const ROOMS = [
  ['Cocina', 2.6, 1.6], ['Comedor', 3.2, 5.4], ['Sala', 7.2, 4.6], ['Balcón', 11, 3.6],
  ['Baño', 1.2, 10.2], ['Alcoba 2', 4.2, 10.2], ['Principal', 8, 10.4], ['Vestier', 8.6, 7.75],
];

export function createMinimap(el) {
  const S = 20;                                    // píxeles por metro en el SVG
  const pt = (x, y) => `${(x * S).toFixed(1)} ${(y * S).toFixed(1)}`;
  const scale = (d) => d.replace(/([MHVZ])|(-?\d*\.?\d+)/g, (m, c, n) => (c ? c : (parseFloat(n) * S).toFixed(1)));
  el.innerHTML = `
    <svg viewBox="-6 -6 ${12 * S + 12} ${11.6 * S + 12}" role="img" aria-label="Plano del apartamento con tu posición">
      ${WALLS.map((d) => `<path class="w" d="${scale(d)}"/>`).join('')}
      ${ROOMS.map(([t, x, y]) => `<text x="${x * S}" y="${y * S}">${t}</text>`).join('')}
      <polyline class="trail" points=""/>
      <g class="me"><path d="M0 -9L6 5L0 2L-6 5Z"/></g>
    </svg>`;
  const trail = el.querySelector('.trail'), me = el.querySelector('.me');
  let path = [], lastK = -1;
  return {
    setPath(p) { path = p || []; },
    update(progress) {
      if (!path.length) return;
      const k = Math.min(path.length - 1, Math.round(progress * (path.length - 1)));
      if (k === lastK) return;
      lastK = k;
      const [x, y, yaw] = path[k];
      // En el SVG la Y crece hacia abajo; el giro del modelo es antihorario desde +X.
      me.setAttribute('transform', `translate(${pt(x, y).replace(' ', ',')}) rotate(${(yaw * 180) / Math.PI + 90})`);
      const pts = [];
      for (let i = 0; i <= k; i += 3) pts.push(pt(path[i][0], path[i][1]).replace(' ', ','));
      trail.setAttribute('points', pts.join(' '));
    },
  };
}
