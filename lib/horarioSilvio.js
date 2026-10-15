// Horario de Silvio Fagundez, transcrito de la planilla (foto). Para corregir algo, editá esta lista y
// ejecutá `npm run cargar-silvio`: reemplaza solo las clases cargadas desde acá (origen "carga-silvio").
// color: amarillo = clase de liceo · azul = UTU · verde = coordinación
const db = require('../db/database');
const { buscarProfesorPorNombre } = require('./horariosLib');

const NOMBRE = 'Silvio Fagundez';
const A = 'amarillo', Z = 'azul', V = 'verde';

const CLASES = [
  // Lunes
  ['Lunes', '07:30', '08:15', 'Coord. Agrario', V],
  ['Lunes', '09:05', '09:50', '7°3', A],
  ['Lunes', '10:40', '12:10', '7°4', A],
  ['Lunes', '13:00', '14:20', '7°A UTU', Z],
  ['Lunes', '14:40', '15:25', '7°5', A],
  ['Lunes', '16:15', '17:00', '7°7', A],
  ['Lunes', '17:00', '18:30', '7°6', A],
  // Martes
  ['Martes', '07:30', '09:00', '7°1', A],
  ['Martes', '09:05', '09:50', '9°1', A],
  ['Martes', '09:50', '11:25', '7°2', A],
  ['Martes', '11:25', '12:10', '7°4', A],
  ['Martes', '17:00', '18:30', '7°7', A],
  // Miércoles
  ['Miércoles', '08:15', '09:50', '9°1', A],
  ['Miércoles', '09:50', '11:25', '7°2', A],
  ['Miércoles', '13:05', '14:35', '7°B UTU', Z],
  ['Miércoles', '16:50', '18:15', 'S.O.II', Z],
  ['Miércoles', '18:30', '20:00', 'Coord. L3', V],
  // Jueves
  ['Jueves', '13:50', '14:30', 'S.O.II', Z],
  ['Jueves', '16:15', '17:00', '7°6', A],
  ['Jueves', '17:00', '18:30', '7°5', A],
  ['Jueves', '19:00', '20:20', 'CTT Proyecto', A],
  // Viernes
  ['Viernes', '09:05', '10:35', '7°3', A],
  ['Viernes', '10:40', '11:25', '7°1', A],
  ['Viernes', '11:25', '12:55', '9°2', A],
  ['Viernes', '17:30', '18:15', 'Coord.', V]
];

// Carga el horario una sola vez (marca en config). Con { forzar: true } lo vuelve a cargar desde cero.
function cargarHorarioSilvio({ forzar = false } = {}) {
  if (!forzar && db.getConfig('carga_silvio_v1') === '1') return 0;
  const prof = buscarProfesorPorNombre(NOMBRE);   // si todavía no tiene cuenta, se vincula sola al registrarse
  db.exec('BEGIN');
  try {
    db.prepare("DELETE FROM horarios WHERE origen = 'carga-silvio'").run();
    const ins = db.prepare(`INSERT INTO horarios (dia, hora_inicio, hora_fin, materia, salon, estado, profesor_id, profesor_nombre, origen, color)
                            VALUES (?, ?, ?, ?, NULL, 'ocupado', ?, ?, 'carga-silvio', ?)`);
    for (const [dia, ini, fin, materia, color] of CLASES) ins.run(dia, ini, fin, materia, prof ? prof.id : null, prof ? prof.nombre : NOMBRE, color);
    db.setConfig('carga_silvio_v1', '1');
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return CLASES.length;
}

module.exports = { NOMBRE, CLASES, cargarHorarioSilvio };
