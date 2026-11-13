// Puente entre la portada y la escena 3D. La portada se pinta primero y es liviana; la escena se carga
// después y se conecta aquí: avisa cuándo está lista y qué hacer al entrar.
export const bridge = {
  ready: () => false,     // la escena puede mostrarse (la define app.js)
  enter: () => {},        // qué hacer al pulsar Entrar
  warm: () => {},         // el visitante ya interactúa con la portada: preparar el primer cuadro
};
