const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
process.env.DB_PATH = path.join(os.tmpdir(), `cuadrilla-silvio-${Date.now()}.db`);
const db = require('../db/database');
const lib = require('../lib/horariosLib');
const { CLASES, cargarHorarioSilvio } = require('../lib/horarioSilvio');

test('las clases de Silvio son válidas y no se pisan entre sí', () => {
  const por = {};
  for (const [dia, ini, fin, materia] of CLASES) {
    const v = lib.validarBloque({ dia, hora_inicio: ini, hora_fin: fin, materia });
    assert.ok(v.bloque, `${dia} ${ini}: ${v.error}`);
    (por[dia] ||= []).push([lib.aMinutos(ini), lib.aMinutos(fin), materia]);
  }
  for (const [dia, l] of Object.entries(por)) {
    l.sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < l.length; i++) assert.ok(l[i][0] >= l[i - 1][1], `${dia}: ${l[i - 1][2]} pisa a ${l[i][2]}`);
  }
});

test('se cargan una vez, quedan para la cuenta existente y se pueden recargar sin duplicar', () => {
  const id = Number(db.prepare("INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES ('Silvio Fagundez', 's@t.com', 'h', 'profesor')").run().lastInsertRowid);
  assert.equal(cargarHorarioSilvio(), CLASES.length);
  assert.equal(cargarHorarioSilvio(), 0, 'la segunda vez no hace nada');
  const mias = db.prepare('SELECT * FROM horarios WHERE profesor_id = ?').all(id);
  assert.equal(mias.length, CLASES.length);
  assert.ok(mias.every(h => ['amarillo', 'azul', 'verde'].includes(h.color)));
  assert.equal(cargarHorarioSilvio({ forzar: true }), CLASES.length);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM horarios WHERE origen = 'carga-silvio'").get().n, CLASES.length);
});

test('sin cuenta todavía, se vinculan cuando se registra', () => {
  db.prepare('DELETE FROM horarios').run(); db.prepare('DELETE FROM usuarios').run();
  cargarHorarioSilvio({ forzar: true });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM horarios WHERE profesor_id IS NULL').get().n, CLASES.length);
  const id = Number(db.prepare("INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES ('Silvio Fagundez', 's2@t.com', 'h', 'profesor')").run().lastInsertRowid);
  lib.vincularBloquesPorNombre({ id, nombre: 'Silvio Fagundez', rol: 'profesor' });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM horarios WHERE profesor_id = ?').get(id).n, CLASES.length);
});

test('las cuentas de los 17 profesores se crean solas y el horario de Silvio queda en la suya', () => {
  const { crearCuentasProfesores } = require('../lib/cuentasProfesores');
  const { PLANTILLA } = require('../lib/profesoresPlantilla');
  db.prepare('DELETE FROM horarios').run(); db.prepare('DELETE FROM usuarios').run();
  const r = crearCuentasProfesores();
  assert.equal(r.length, PLANTILLA.length);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM usuarios WHERE rol = 'profesor'").get().n, 17);
  assert.equal(crearCuentasProfesores().filter(p => p.creada).length, 0, 'la segunda vez no duplica');
  cargarHorarioSilvio({ forzar: true });
  const silvio = db.prepare("SELECT id FROM usuarios WHERE email = 'silvio.fagundez@cuadrilla.com'").get();
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM horarios WHERE profesor_id = ?').get(silvio.id).n, CLASES.length);
  assert.ok(lib.profesoresParaSelector().every(p => p.cuenta && p.id), 'todos aparecen con cuenta en el selector del admin');
});

test('el horario de Saúl es válido, no se pisa y queda en su cuenta', () => {
  const { CLASES: C, cargarHorarioSaul } = require('../lib/horarioSaul');
  const por = {};
  for (const [dia, ini, fin, materia] of C) {
    const v = lib.validarBloque({ dia, hora_inicio: ini, hora_fin: fin, materia });
    assert.ok(v.bloque, `${dia} ${ini}: ${v.error}`);
    (por[dia] ||= []).push([lib.aMinutos(ini), lib.aMinutos(fin), materia]);
  }
  for (const [dia, l] of Object.entries(por)) {
    l.sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < l.length; i++) assert.ok(l[i][0] >= l[i - 1][1], `${dia}: ${l[i - 1][2]} pisa a ${l[i][2]}`);
  }
  const { crearCuentasProfesores } = require('../lib/cuentasProfesores');
  db.prepare('DELETE FROM horarios').run(); db.prepare('DELETE FROM usuarios').run();
  crearCuentasProfesores();
  assert.equal(cargarHorarioSaul({ forzar: true }), C.length);
  const saul = db.prepare("SELECT id FROM usuarios WHERE email = 'saul.pereira@cuadrilla.com'").get();
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM horarios WHERE profesor_id = ?').get(saul.id).n, C.length);
});
