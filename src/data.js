// Datos ilustrativos del proyecto ficticio "Torre Otún".

export const FLOORS = 14;       // pisos residenciales
export const FIRST_FLOOR = 3;   // el podio ocupa pisos 1 y 2

export const TYPES = {
  A: { nombre: 'Tipo A', area: 114, hab: 2, ban: 1, vista: 'Cordillera · oriente y norte',
       rooms: [[5,62,190,73,'Sala · comedor · cocina'],[5,5,42,44,'Baño'],[47,5,66,44,'Alcoba 2'],[113,5,82,44,'Alcoba principal'],[5,49,135,13,'Pasillo'],[140,49,55,13,'Vestier']] },
  B: { nombre: 'Tipo B', area: 68, hab: 2, ban: 2, vista: 'Ciudad · occidente',
       rooms: [[5,5,110,70,'Sala comedor'],[115,5,80,40,'Cocina'],[115,45,80,30,'Baños'],[5,75,95,60,'Alcoba 1'],[100,75,95,60,'Alcoba 2']] },
  C: { nombre: 'Tipo C', area: 78, hab: 2, ban: 2, vista: 'Valle · sur',
       rooms: [[5,5,100,70,'Sala comedor'],[105,5,90,40,'Cocina'],[105,45,45,30,'Baños'],[150,45,45,30,'Estudio'],[5,75,95,60,'Alcoba 1'],[100,75,95,60,'Alcoba 2']] },
  D: { nombre: 'Tipo D', area: 52, hab: 1, ban: 1, vista: 'Parque · norte',
       rooms: [[5,5,120,80,'Sala · cocina'],[125,5,70,45,'Baño'],[125,50,70,35,'Vestier'],[5,85,190,50,'Alcoba']] },
};

// Posición de cada tipo en la planta (x, z). z positivo = fachada principal.
export const LAYOUT = [
  { tipo: 'A', x: -6.05, z: 4.05, n: '01' },
  { tipo: 'B', x: 6.05, z: 4.05, n: '02' },
  { tipo: 'C', x: 6.05, z: -4.05, n: '03' },
  { tipo: 'D', x: -6.05, z: -4.05, n: '04' },
];

const PRECIO_M2 = 6_400_000;
export const SEPARACION = 5_000_000;

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildUnits() {
  const rnd = mulberry32(27);
  const units = [];
  for (let fi = 0; fi < FLOORS; fi++) {
    for (const slot of LAYOUT) {
      const t = TYPES[slot.tipo];
      const r = rnd();
      // Pisos bajos se venden primero.
      const sold = 0.42 - fi * 0.018;
      const status = r < sold ? 'vendido' : r < sold + 0.16 ? 'separado' : 'disponible';
      const precio = Math.round((t.area * PRECIO_M2 * (1 + fi * 0.009)) / 100_000) * 100_000;
      units.push({
        fi, piso: fi + FIRST_FLOOR, tipo: slot.tipo, x: slot.x, z: slot.z,
        codigo: `${fi + FIRST_FLOOR}${slot.n}`, status, precio, ...t,
      });
    }
  }
  return units;
}

export const cop = (n) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n);

export function planSVG(tipo) {
  const rooms = TYPES[tipo].rooms;
  const rects = rooms
    .map(([x, y, w, h, label]) =>
      `<rect x="${x}" y="${y}" width="${w}" height="${h}"/><text x="${x + w / 2}" y="${y + h / 2 + 3}">${label}</text>`)
    .join('');
  return `<svg viewBox="0 0 200 140" class="plan" role="img" aria-label="Plano ${TYPES[tipo].nombre}">
    <rect class="outer" x="2" y="2" width="196" height="136"/>${rects}
    <path class="balcony" d="M5 2h60"/></svg>`;
}
