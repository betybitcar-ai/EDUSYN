// Historial de cambios: quién editó qué y cuándo (lo ve solo el administrador).
const db = require('../db/database');

const MAX_REGISTROS = 5000;   // se conservan los más recientes

const ACCIONES = {
  crear: 'Clase creada', editar: 'Clase editada', borrar: 'Clase eliminada', liberar: 'Clase liberada',
  tomar: 'Clase tomada', publicar: 'Publicación', intercambio: 'Intercambio', importar: 'Importación', backup: 'Backup'
};

function registrar(usuario, accion, detalle) {
  const u = usuario || {};
  db.prepare('INSERT INTO historial (usuario_id, usuario_nombre, accion, detalle) VALUES (?, ?, ?, ?)')
    .run(u.id ?? null, u.nombre || 'Sistema', accion, String(detalle).slice(0, 500));
  if (Math.random() < 0.01) {   // poda ocasional
    db.prepare('DELETE FROM historial WHERE id <= (SELECT id FROM historial ORDER BY id DESC LIMIT 1 OFFSET ?)').run(MAX_REGISTROS);
  }
}

// { texto?, accion?, limite? } -> registros más nuevos primero
function listar({ texto = '', accion = '', limite = 200 } = {}) {
  const cond = [], args = [];
  if (accion && ACCIONES[accion]) { cond.push('accion = ?'); args.push(accion); }
  const q = String(texto).trim().toLowerCase();
  if (q) { cond.push("(LOWER(detalle) LIKE ? ESCAPE '\\' OR LOWER(usuario_nombre) LIKE ? ESCAPE '\\')"); const like = `%${q.replace(/[\\%_]/g, c => '\\' + c)}%`; args.push(like, like); }
  const n = Math.min(Math.max(Number(limite) || 200, 1), 1000);
  return db.prepare(`SELECT * FROM historial ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''} ORDER BY id DESC LIMIT ?`).all(...args, n);
}

// Descripciones legibles de una clase y de lo que cambió entre dos versiones.
const cuando = (h) => `${h.dia} ${h.hora_inicio}–${h.hora_fin}${h.salon ? ', ' + h.salon : ''}`;
const lugar = (c) => ({ amarillo: 'liceo', azul: 'UTU', verde: 'coordinación' }[c] || 'sin especificar');
const quien = (h) => h.profesor_nombre || 'sin profesor';

function resumenClase(h) { return `${h.materia} (${cuando(h)}) — ${quien(h)}`; }

function resumenEdicion(antes, despues) {
  const c = [];
  if (antes.dia !== despues.dia || antes.hora_inicio !== despues.hora_inicio || antes.hora_fin !== despues.hora_fin)
    c.push(`horario ${antes.dia} ${antes.hora_inicio}–${antes.hora_fin} → ${despues.dia} ${despues.hora_inicio}–${despues.hora_fin}`);
  if ((antes.salon || '') !== (despues.salon || '')) c.push(`salón ${antes.salon || '—'} → ${despues.salon || '—'}`);
  if (antes.materia !== despues.materia) c.push(`materia ${antes.materia} → ${despues.materia}`);
  if ((antes.profesor_nombre || '') !== (despues.profesor_nombre || '')) c.push(`profesor ${quien(antes)} → ${quien(despues)}`);
  if ((antes.color || '') !== (despues.color || '')) c.push(`lugar ${lugar(antes.color)} → ${lugar(despues.color)}`);
  return c.length ? `${despues.materia}: ${c.join('; ')}` : null;
}

module.exports = { ACCIONES, registrar, listar, resumenClase, resumenEdicion };
