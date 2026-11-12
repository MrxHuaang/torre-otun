// Arranque. Comprueba que el equipo puede dibujar en 3D antes de cargar la sala;
// si no puede (o algo falla al iniciar), la página queda legible y sin portada pegada.
function fallback(err) {
  if (err) console.warn('Sala 3D no disponible', err);
  document.querySelector('#gate')?.remove();
  document.body.classList.remove('locked');
  document.body.classList.add('ready', 'nogl');
  document.querySelectorAll('.block').forEach((el) => el.classList.add('in'));
}

function canDraw() {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

if (canDraw()) import('./app.js').catch(fallback);
else fallback();
