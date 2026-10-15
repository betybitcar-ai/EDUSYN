// Intercambios de clase entre dos profesores: el chatbot los empareja y el admin los aprueba o rechaza.
const db = require('../db/database');
const lib = require('./horariosLib');
const historial = require('./historialLib');

const falla = (msg, status = 400) => Object.assign(new Error(msg), { status });
const desc = (h) => `${h.materia} (${h.dia} ${h.hora_inicio}–${h.hora_fin}${h.salon ? ', ' + h.salon : ''})`;

function avisar(id, nombre, contenido) {
  if (!id) return;
  db.prepare(`INSERT INTO mensajes (remitente_id, remitente_nombre, destinatario_id, destinatario_nombre, contenido, tipo)
              VALUES (NULL, 'Sistema Cuadrilla', ?, ?, ?, 'intercambio')`).run(id, nombre, contenido);
}

// Pares emparejados esperando decisión: [{ id, a: {...}, b: {...} }]
function pendientes() {
  const filas = db.prepare(`SELECT s.id, s.pareja_id, s.profesor_id, s.profesor_nombre, h.id AS horario_id, h.dia, h.hora_inicio, h.hora_fin, h.materia, h.salon
                            FROM solicitudes_cambio s JOIN horarios h ON h.id = s.horario_actual_id
                            WHERE s.estado = 'emparejado' ORDER BY s.id`).all();
  const vistos = new Set(), pares = [];
  for (const f of filas) {
    const otra = filas.find(x => x.id === f.pareja_id);
    if (!otra || vistos.has(f.id)) continue;
    vistos.add(f.id); vistos.add(otra.id);
    const lado = (x) => ({ profesor: x.profesor_nombre, clase: desc(x) });
    pares.push({ id: f.id, a: lado(f), b: lado(otra) });
  }
  return pares;
}

function cargarPar(id) {
  const a = db.prepare("SELECT * FROM solicitudes_cambio WHERE id = ? AND estado = 'emparejado'").get(id);
  const b = a && db.prepare("SELECT * FROM solicitudes_cambio WHERE id = ? AND estado = 'emparejado'").get(a.pareja_id);
  if (!a || !b) throw falla('Ese intercambio ya no está pendiente.', 404);
  const ha = db.prepare('SELECT * FROM horarios WHERE id = ?').get(a.horario_actual_id);
  const hb = db.prepare('SELECT * FROM horarios WHERE id = ?').get(b.horario_actual_id);
  return { a, b, ha, hb };
}

function aprobar(id, usuario = null) {
  const { a, b, ha, hb } = cargarPar(id);
  if (!ha || !hb) throw falla('Una de las clases ya no existe.', 409);
  if (ha.profesor_id !== a.profesor_id || hb.profesor_id !== b.profesor_id)
    throw falla('Una de las clases cambió de profesor desde el pedido: rechazá este intercambio y que lo soliciten de nuevo.', 409);
  // Cada profesor pasa a la clase del otro: no puede pisarse con otra clase suya ni con el salón.
  const choqueA = lib.buscarConflicto({ ...hb, profesor_id: a.profesor_id, profesor_nombre: a.profesor_nombre }, [ha.id, hb.id]);
  if (choqueA) throw falla(`No se puede aprobar: ${choqueA}`, 409);
  const choqueB = lib.buscarConflicto({ ...ha, profesor_id: b.profesor_id, profesor_nombre: b.profesor_nombre }, [ha.id, hb.id]);
  if (choqueB) throw falla(`No se puede aprobar: ${choqueB}`, 409);

  db.exec('BEGIN');
  try {
    const upd = db.prepare("UPDATE horarios SET profesor_id = ?, profesor_nombre = ?, estado = 'ocupado' WHERE id = ?");
    upd.run(a.profesor_id, a.profesor_nombre, hb.id);
    upd.run(b.profesor_id, b.profesor_nombre, ha.id);
    db.prepare("UPDATE solicitudes_cambio SET estado = 'completado' WHERE id IN (?, ?)").run(a.id, b.id);
    avisar(a.profesor_id, a.profesor_nombre, `✅ La administración aprobó el intercambio: ahora tenés ${desc(hb)} (y ya no ${desc(ha)}).`);
    avisar(b.profesor_id, b.profesor_nombre, `✅ La administración aprobó el intercambio: ahora tenés ${desc(ha)} (y ya no ${desc(hb)}).`);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  historial.registrar(usuario, 'intercambio', `Aprobó el intercambio ${a.profesor_nombre} (${desc(ha)}) ↔ ${b.profesor_nombre} (${desc(hb)})`);
  return { mensaje: `Intercambio aprobado: ${a.profesor_nombre} ↔ ${b.profesor_nombre}.` };
}

function rechazar(id, usuario = null) {
  const { a, b, ha, hb } = cargarPar(id);
  db.prepare("UPDATE solicitudes_cambio SET estado = 'cancelado' WHERE id IN (?, ?)").run(a.id, b.id);
  avisar(a.profesor_id, a.profesor_nombre, `❌ La administración no aprobó el intercambio de ${ha ? desc(ha) : 'tu clase'}. Tu horario sigue igual.`);
  avisar(b.profesor_id, b.profesor_nombre, `❌ La administración no aprobó el intercambio de ${hb ? desc(hb) : 'tu clase'}. Tu horario sigue igual.`);
  historial.registrar(usuario, 'intercambio', `Rechazó el intercambio ${a.profesor_nombre} ↔ ${b.profesor_nombre}`);
  return { mensaje: 'Intercambio rechazado. Los profesores fueron avisados.' };
}

module.exports = { pendientes, aprobar, rechazar };
