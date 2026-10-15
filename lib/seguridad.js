// Controles de seguridad: configuración segura al arrancar y límite de intentos (contra fuerza bruta).
const SECRETO_EJEMPLO = 'cambia-este-secreto-en-produccion';
const CODIGOS_EJEMPLO = { PROFE_CODE: 'PROFE-2026', ADMIN_CODE: 'ADMIN-2026' };

// Lista de problemas de la configuración (vacía = todo bien).
function problemasDeConfiguracion(env = process.env) {
  const p = [];
  const secreto = env.SESSION_SECRET || '';
  if (!secreto || secreto === SECRETO_EJEMPLO || secreto.length < 16)
    p.push('SESSION_SECRET falta, es el valor de ejemplo o tiene menos de 16 caracteres.');
  for (const [nombre, ejemplo] of Object.entries(CODIGOS_EJEMPLO)) {
    const v = env[nombre] || '';
    if (!v || v === ejemplo || v.length < 8) p.push(`${nombre} falta, es el valor de ejemplo o tiene menos de 8 caracteres.`);
  }
  if (env.PROFE_CODE && env.PROFE_CODE === env.ADMIN_CODE) p.push('PROFE_CODE y ADMIN_CODE no pueden ser iguales.');
  return p;
}

// En producción un problema impide arrancar; en desarrollo solo se avisa.
function verificarArranque(env = process.env, log = console) {
  const problemas = problemasDeConfiguracion(env);
  if (!problemas.length) return;
  if (env.NODE_ENV === 'production') {
    throw new Error(`Configuración insegura, el servidor no arranca:\n - ${problemas.join('\n - ')}\nEjecutá "npm run generar-claves" y copiá los valores en tu .env.`);
  }
  log.warn(`⚠️  Configuración de desarrollo (no usar en producción):\n - ${problemas.join('\n - ')}`);
}

// Limitador en memoria: tras `max` fallos en la ventana, bloquea esa clave hasta que pase el tiempo.
function crearLimitador({ max = 5, ventanaMs = 15 * 60 * 1000 } = {}) {
  const mapa = new Map();
  const vigente = (e, ahora) => e && ahora - e.inicio <= ventanaMs;
  return {
    // Segundos que faltan para poder reintentar (0 = permitido).
    bloqueado(clave, ahora = Date.now()) {
      const e = mapa.get(clave);
      if (!vigente(e, ahora)) { mapa.delete(clave); return 0; }
      return e.n >= max ? Math.ceil((e.inicio + ventanaMs - ahora) / 1000) : 0;
    },
    fallo(clave, ahora = Date.now()) {
      if (mapa.size > 5000) for (const [k, e] of mapa) if (!vigente(e, ahora)) mapa.delete(k);
      const e = mapa.get(clave);
      if (vigente(e, ahora)) e.n++; else mapa.set(clave, { n: 1, inicio: ahora });
    },
    exito(clave) { mapa.delete(clave); }
  };
}

module.exports = { problemasDeConfiguracion, verificarArranque, crearLimitador };
