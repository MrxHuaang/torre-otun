<img src="docs/logo.svg" alt="Marca de Torre Otún: torre escalonada, sol naciente y río" width="96" align="right" />

# Torre Otún

Sala de ventas viva para un edificio que todavía no existe: recórrelo por fuera, ábrelo hasta el esqueleto, elige apartamento y camínalo por dentro. Todo dibujado a tinta, como lámina de arquitectura.

**[torre-otun.vercel.app](https://torre-otun.vercel.app)**

![Portada: emblema, título animado y pinceladas que fluyen](docs/portada.jpg)

| | |
|---|---|
| ![La torre con su barrio de casas, a tinta](docs/torre.jpg) | ![La torre se desarma y queda la estructura](docs/estructura.jpg) |

![Recorrido interior con minimapa del apartamento](docs/recorrido.jpg)

## Qué hace

- **Portada que responde.** El emblema se dibuja al ritmo real de la carga. Después el título aparece por franjas mientras cada letra sube, sobre pinceladas que fluyen en tres profundidades. Título, letras, luz y botón siguen al cursor.
- **Torre en 3D dibujada en vivo.** Un pase de tinta convierte la escena de three.js en grabado: contornos por profundidad y normales, aguada gris, trama solo en sombra fuerte y un único color plano.
- **Se puede tocar.** Arrastra la torre para girarla. Toca un piso y se encienden sus ventanas. Al pasar el cursor, cada piso dice cuántos apartamentos tiene libres.
- **Estructura a la vista.** La torre se desarma piso a piso de arriba hacia abajo y deja ver columnas, núcleo de muros, disipadores y pilotes, con anotaciones técnicas.
- **Disponibilidad y cotizador.** Modo exploración con cada apartamento pintado por estado, ficha con plano, precio y un cotizador de cuota inicial y plazo.
- **Recorrido interior continuo.** 760 cuadros pre-renderizados en Blender: entras por la puerta, cocina, sala, balcón, pasillo, baño, alcobas. El scroll decide el cuadro y un minimapa marca dónde vas.
- **Barrio con sentido.** Casas con techo a dos aguas, edificios bajos con locales, calles, árboles y personas a escala.
- **Barra de avance propia.** Los capítulos son paradas; se puede hacer clic o arrastrar.
- **Carga liviana.** Modelos comprimidos con meshopt (6.5 MB a 1.2 MB). El recorrido se descarga en segundo plano mientras ves la torre, y en móvil o con ahorro de datos usa una versión de 6 MB.
- Respeta `prefers-reduced-motion`.

## Cómo está hecho

**Exterior, en tiempo real.** La escena se dibuja dos veces por cuadro: una con luz y otra que guarda normales y profundidad. Un sombreador las combina en papel, tinta, trama y color plano, y las líneas vectoriales se pintan encima respetando la profundidad. Está en [`src/ink.js`](src/ink.js) y documentado en [`docs/estilo-tinta.md`](docs/estilo-tinta.md) para reutilizarlo en otros proyectos.

**Interior, pre-renderizado.** El apartamento se modela por script en Blender ([`blender/apartamento.py`](blender/apartamento.py)). Por cada cuadro salen cuatro tandas (luz, color propio del material, normales con profundidad y trazos de material como vetas y juntas) que [`blender/tinta.py`](blender/tinta.py) combina con numpy en una lámina a tinta. En el navegador ([`src/tour.js`](src/tour.js)) las imágenes se guardan comprimidas, se decodifica solo una ventana alrededor del cuadro actual y se dibujan en la GPU.

**Torre y barrio.** [`blender/torre.py`](blender/torre.py) genera el piso tipo, el podio, la corona y el barrio, y los exporta a glTF.

## Desarrollo

```bash
npm install
npm run dev
```

```bash
npm run build
```

Para regenerar el arte hace falta Blender 4 o superior:

```bash
blender --background --factory-startup --python blender/torre.py -- public/models
```

```bash
blender --background --factory-startup --python blender/apartamento.py -- ink CYCLES 0 1024 32 public/tour 0 760
```

Vite, three.js, GSAP y Lenis, sin framework. Tipografías [Cormorant Garamond](https://fonts.google.com/specimen/Cormorant+Garamond) y [Jost](https://fonts.google.com/specimen/Jost).

Proyecto ficticio. Cifras, tiempos y precios son ilustrativos.

---

Diseño y desarrollo por [Juan Ordóñez](https://juanordonezvercelapp.vercel.app).
