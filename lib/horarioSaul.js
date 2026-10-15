// Horario de Saúl Pereira, transcrito de la planilla (foto). Para corregir algo, editá esta lista y
// ejecutá `npm run cargar-saul`: reemplaza solo las clases cargadas desde acá (origen "carga-saul").
// color: amarillo = clase de liceo · azul = UTU · verde = coordinación
// Las horas de la mañana siguen el reloj del liceo (10:40-11:25, 11:25-12:10, 12:10-12:55), igual que lo escrito a mano en la planilla.
// ⚠ REVISAR: las líneas marcadas así estaban escritas a mano y poco legibles en la foto.
const db = require('../db/database');
const { buscarProfesorPorNombre } = require('./horariosLib');

const NOMBRE = 'Saúl Pereira';
const A = 'amarillo', V = 'verde';

const CLASES = [
  // Lunes
  ['Lunes', '08:15', '09:50', '3°CVH 3', A],
  ['Lunes', '09:50', '11:25', '3°CAD', A],
  ['Lunes', '11:25', '12:55', '3°CT', A],
  ['Lunes', '15:05', '16:35', '2°C.Art.', A],
  ['Lunes', '17:40', '19:10', 'A confirmar (ilegible en la foto)', V],   // ⚠ REVISAR nombre
  // Martes
  ['Martes', '08:15', '09:00', '3°MF Mat', A],
  ['Martes', '09:05', '10:35', '3°MT Cálculo', A],
  ['Martes', '10:40', '12:10', '2°MA Mat', A],
  ['Martes', '13:45', '14:35', '3°BA', A],
  ['Martes', '15:50', '17:30', '3°HCP 1', A],
  // Miércoles
  ['Miércoles', '08:15', '09:50', '3°MF Mat', A],
  ['Miércoles', '10:40', '12:10', '2°MA Mat', A],
  ['Miércoles', '15:05', '16:35', '2°C.Art.', A],
  ['Miércoles', '17:30', '19:05', '3°HCP 1', A],
  // Jueves
  ['Jueves', '08:15', '09:50', '3°CVH 3', A],
  ['Jueves', '09:50', '11:25', '3°CAD', A],
  ['Jueves', '11:25', '12:55', '3°CT', A],
  ['Jueves', '15:25', '17:00', '2°MB', A],   // ⚠ REVISAR horas (manuscrito)
  ['Jueves', '17:00', '18:35', '3°MB', A],   // ⚠ REVISAR horas (manuscrito)
  // Viernes
  ['Viernes', '08:15', '09:50', '3°CAD', A],
  ['Viernes', '09:50', '11:25', '3°CT', A],
  ['Viernes', '11:25', '12:10', '3°CVH 3', A],
  ['Viernes', '13:05', '15:00', '2°MB Mat', A],   // ⚠ REVISAR horas (manuscrito)
  ['Viernes', '15:05', '17:00', '3°MB', A]        // ⚠ REVISAR horas (manuscrito)
];

// Carga el horario una sola vez (marca en config). Con { forzar: true } lo vuelve a cargar desde cero.
function cargarHorarioSaul({ forzar = false } = {}) {
  if (!forzar && db.getConfig('carga_saul_v1') === '1') return 0;
  const prof = buscarProfesorPorNombre(NOMBRE);   // si todavía no tiene cuenta, se vincula sola al registrarse
  db.exec('BEGIN');
  try {
    db.prepare("DELETE FROM horarios WHERE origen = 'carga-saul'").run();
    const ins = db.prepare(`INSERT INTO horarios (dia, hora_inicio, hora_fin, materia, salon, estado, profesor_id, profesor_nombre, origen, color)
                            VALUES (?, ?, ?, ?, NULL, 'ocupado', ?, ?, 'carga-saul', ?)`);
    for (const [dia, ini, fin, materia, color] of CLASES) ins.run(dia, ini, fin, materia, prof ? prof.id : null, prof ? prof.nombre : NOMBRE, color);
    db.setConfig('carga_saul_v1', '1');
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return CLASES.length;
}

module.exports = { NOMBRE, CLASES, cargarHorarioSaul };
