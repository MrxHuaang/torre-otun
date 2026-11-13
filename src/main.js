// Arranque en dos tiempos, para que la página sea utilizable de inmediato:
//  1) La portada (liviana) se pinta y anima enseguida.
//  2) La escena 3D, que es lo pesado, se descarga y se construye después, cuando el navegador está libre.
// Si el equipo no puede dibujar en 3D, o algo falla al iniciar, la página queda legible y sin portada pegada.
import { createIntro } from './intro.js';
import { bridge } from './bridge.js';

function fallback(err) {
  if (err) console.warn('Sala 3D no disponible', err);
  document.querySelector('#gate')?.remove();
  document.body.classList.remove('locked');
  document.body.classList.add('ready', 'nogl');
  document.querySelectorAll('.block').forEach((el) => el.classList.add('in'));
}

// Comprobación barata: crear un contexto de prueba cuesta tiempo. Si el contexto real falla, app.js lanza y se cae al plan B.
if (!window.WebGL2RenderingContext) {
  fallback();
} else {
  const t0 = performance.now();
  createIntro({
    getProgress: () => Math.min(1, (performance.now() - t0) / 600),   // el emblema se dibuja por tiempo; Entrar espera a la escena
    isReady: () => bridge.ready(),
    onEnter: () => bridge.enter(),
    onWarm: () => bridge.warm(),
  });
  // La escena pesa 200 KB y arrastra modelos: se pide solo cuando el título de la portada ya está en pantalla,
  // para que no compita con el primer pintado. Después, cuando el navegador está libre.
  const idle = (f) => ('requestIdleCallback' in window ? requestIdleCallback(f, { timeout: 1500 }) : setTimeout(f, 400));
  const start = () => setTimeout(() => idle(() => import('./app.js').catch(fallback)), Math.max(0, 2200 - (performance.now() - t0)));
  setTimeout(() => { if (!bridge.ready()) fallback(); }, 25000);   // si la escena no llega, la página no se queda detrás de la portada
  if (document.readyState === 'complete') start();
  else addEventListener('load', start, { once: true });
}
