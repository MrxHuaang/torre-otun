# Estilo tinta — guía para reutilizar

Convierte cualquier escena de three.js en un grabado a pluma: contornos negros con pulso de mano,
achurado cruzado en las sombras, papel con grano y un solo color plano (ocre). Todo ocurre en un pase
de post-proceso, así que funciona con cualquier modelo: no hay que redibujar nada.

Activo por defecto en esta demo. Para comparar sin el pase: `http://localhost:5173/?limpio`.

El recorrido interior usa el mismo estilo pero pre-renderizado en Blender: ver `blender/tinta.py`.

## Archivos

| Archivo | Qué es |
|---|---|
| `src/ink.js` | El pase completo. Único archivo necesario para llevarlo a otro proyecto. |
| `src/interior.js` | Escena de ejemplo (interior hecho con primitivas) usada para probar el pase. |

Dependencia: `three` (probado con 0.170). Nada más.

## Uso mínimo

```js
import { createInk } from './ink.js';

const ink = createInk(renderer, { paper: 0xf6f5f1, ink: 0x111111, ochre: 0x9c8b5e });
ink.setSize(window.innerWidth, window.innerHeight, devicePixelRatio);   // repetir en cada resize

function frame() {
  ink.render(scene, camera, { fadeA: 200, fadeB: 500, exposure: 1 });
}
```

`ink.render` reemplaza a `renderer.render`. Opciones:

| Opción | Efecto |
|---|---|
| `fadeA`, `fadeB` | Distancia (unidades de escena) entre la que los contornos se desvanecen. Evita que el fondo quede negro de líneas. |
| `exposure` | Multiplica el brillo antes de decidir el achurado. Más alto = más papel, menos trama. |
| `lines: true` | Dibuja encima los objetos de la capa 1 (trazos vectoriales) respetando profundidad. |
| `aux(on)` | Callback para ocultar mallas durante el pase de contornos (por ejemplo, las que están transparentes). |

## Cómo funciona

Cuatro pasadas por cuadro:

1. **Color.** La escena normal, con sus luces, a una textura. De aquí sale el *tono*.
2. **Normales + profundidad.** La escena con un material especial que guarda la normal en RGB y la distancia en alfa.
3. **Tinta.** Un cuadro a pantalla completa que combina ambas:
   - *Contornos*: donde la profundidad o la normal cambian de golpe entre píxeles vecinos.
     Se usa el laplaciano de la profundidad inversa para que los pisos vistos de canto no se llenen de líneas falsas.
   - *Achurado*: según lo oscuro del píxel. Claro → papel. Medio → trazos a 35°. Oscuro → se cruza un segundo juego. Muy oscuro → negro sólido.
   - *Color plano*: los píxeles saturados y cálidos (madera, terracota, latón) se pintan de ocre; el resto, papel.
   - *Pulso*: las coordenadas se desplazan con ruido que cambia ~6 veces por segundo, como línea "hervida" de animación a mano.
   - *Papel*: grano fino más manchas suaves.
4. **Trazos vectoriales.** Los objetos de la capa 1 (`LineSegments`, puntos) se dibujan encima. El paso 3 escribe la profundidad real, así que quedan ocultos detrás de lo que corresponde.

## Convención de capas

| Capa | Contenido | Entra en |
|---|---|---|
| 0 | Mallas sólidas | color, contornos |
| 1 | Líneas y puntos que deben verse tal cual | solo paso 4 |
| 2 | Vidrios y transparentes | color; **no** contornos (no tapan lo que hay detrás) |

```js
lineas.layers.set(1);
vidrio.layers.set(2);
```

## Requisitos de la escena

- **Necesita luz con dirección.** El achurado sale de las sombras: usar `MeshLambertMaterial` o `MeshStandardMaterial` con al menos una `DirectionalLight`. Con `MeshBasicMaterial` todo queda papel.
- Fondo claro (`renderer.setClearColor` igual al papel).
- Materiales que deban quedar ocre: color cálido y saturado. Los grises y fríos se vuelven trama.

## Ajustes finos (dentro de `ink.js`, shader de tinta)

| Línea | Qué cambia |
|---|---|
| `hatch(px + wob, 0.62, 5.5, …)` | Ángulo (rad) y separación (px) del primer juego de trazos. |
| `hatch(px + wob, -0.8, 5.5, …)` | Lo mismo para el cruzado. |
| `smoothstep(0.8, 0.3, th)` / `smoothstep(0.46, 0.12, th)` | Umbrales de tono donde empieza cada juego. |
| `smoothstep(0.02, 0.07, dd)` | Sensibilidad de contornos por profundidad. Bajar = más líneas. |
| `smoothstep(0.4, 0.9, nd)` | Sensibilidad por cambio de normal (aristas interiores). |
| `* 1.8` en `wob` | Cuánto tiembla la línea. |
| `performance.now() / 160` | Velocidad del hervor. Subir el divisor = más lento; fijarlo = línea quieta. |
| `smoothstep(0.2, 0.32, sat)` | Cuánta saturación hace falta para volverse ocre. |

## Paleta

| Rol | Color |
|---|---|
| Papel | `#f6f5f1` |
| Tinta | `#111111` |
| Ocre (color plano) | `#9c8b5e` |
| Rojo (acentos, pocos) | `#b3261e` |

En la interfaz: títulos en `Federo`, etiquetas en `Syne 800` con espaciado amplio, texto en `Jost 300`.
Cajas de texto como viñetas: borde negro de 2 px y sombra dura desplazada (`box-shadow: 5px 5px 0`).

## Límites conocidos

- El achurado está pegado a la pantalla: al mover la cámara los trazos "resbalan" sobre los objetos. Se nota poco en planos lentos; para corregirlo habría que anclar la trama a la superficie (coordenadas UV o triplanar).
- El detalle depende del modelo. Con primitivas se ve simple; con un modelo trabajado (Blender, glTF) el mismo pase luce como lámina.
- Cuesta dos renders de escena por cuadro. En escenas pesadas, bajar la resolución del pase de contornos.
- No alcanza la calidad de una ilustración hecha a mano cuadro por cuadro; llega a "grabado arquitectónico".
