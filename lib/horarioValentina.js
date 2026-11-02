// Horario de Valentina Rodríguez, transcrito de la planilla (foto girada). Para corregir algo, editá esta lista y
// ejecutá `npm run cargar-valentina`: reemplaza solo las clases cargadas desde acá (origen "carga-valentina").
// color: amarillo = liceo ("figari") · azul = UTU · verde = coordinación
// Las horas de la mañana siguen el reloj del liceo (10:40-11:25, 11:25-12:10, 12:10-12:55), igual que en el resto de las cargas:
// la planilla impresa dice 10:45-11:30 y 11:30-12:15, que se pisaría 5 min con la clase de las 12:10.
// Las horas seguidas con el mismo grupo se unieron en un solo bloque. El martes no tiene clases.
// ⚠ REVISAR: "6° CVH" no indica lugar en la planilla (se puso como liceo) y las dos coordinaciones están escritas a mano.
const db = require('../db/database');
const { buscarProfesorPorNombre } = require('./horariosLib');

const NOMBRE = 'Valentina Rodríguez';
const A = 'amarillo', Z = 'azul', V = 'verde';

const CLASES = [
  // Lunes
  ['Lunes', '07:30', '09:00', '3°MA', A],            // figari
  ['Lunes', '09:05', '10:35', '3°DF', Z],            // utu
  ['Lunes', '10:40', '11:25', '3°MF', Z],            // utu
  // Martes: sin clases
  // Miércoles
  ['Miércoles', '08:15', '09:00', '6°CVH', A],
  ['Miércoles', '10:40', '11:25', 'Coord. Figari', V],   // ⚠ REVISAR (manuscrito)
  ['Miércoles', '11:25', '12:10', '6°CVH', A],
  ['Miércoles', '12:10', '12:55', '3°MA', A],        // figari
  ['Miércoles', '12:55', '13:40', '3°BA', A],        // figari
  // Jueves
  ['Jueves', '07:30', '09:00', '3°MC', Z],           // utu
  ['Jueves', '09:05', '10:35', '3°MF', Z],           // utu
  ['Jueves', '10:40', '11:25', 'Coord. UTU', V],     // ⚠ REVISAR (manuscrito)
  // Viernes
  ['Viernes', '07:30', '08:15', '3°MC', Z],          // utu
  ['Viernes', '10:40', '12:10', '6°CVH', A]
];

// Carga el horario una sola vez (marca en config). Con { forzar: true } lo vuelve a cargar desde cero.
function cargarHorarioValentina({ forzar = false } = {}) {
  if (!forzar && db.getConfig('carga_valentina_v1') === '1') return 0;
  const prof = buscarProfesorPorNombre(NOMBRE);   // si todavía no tiene cuenta, se vincula sola al registrarse
  db.exec('BEGIN');
  try {
    db.prepare("DELETE FROM horarios WHERE origen = 'carga-valentina'").run();
    const ins = db.prepare(`INSERT INTO horarios (dia, hora_inicio, hora_fin, materia, salon, estado, profesor_id, profesor_nombre, origen, color, curso)
                            VALUES (?, ?, ?, ?, NULL, 'ocupado', ?, ?, 'carga-valentina', ?, ?)`);
    for (const [dia, ini, fin, materia, color] of CLASES) ins.run(dia, ini, fin, materia, prof ? prof.id : null, prof ? prof.nombre : NOMBRE, color, /^\d°/.test(materia) ? materia : null);
    db.setConfig('carga_valentina_v1', '1');
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return CLASES.length;
}

module.exports = { NOMBRE, CLASES, cargarHorarioValentina };
