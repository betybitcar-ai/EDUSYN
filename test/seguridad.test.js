// Seguridad (configuración y límite de intentos) y avisos de traslado liceo/UTU.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cuadrilla-seg-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
const db = require('../db/database');
const lib = require('../lib/horariosLib');
const { problemasDeConfiguracion, verificarArranque, crearLimitador } = require('../lib/seguridad');

test('configuración: detecta claves de ejemplo, cortas o repetidas', () => {
  assert.equal(problemasDeConfiguracion({ SESSION_SECRET: 'x'.repeat(32), PROFE_CODE: 'PROFE-abc123', ADMIN_CODE: 'ADMIN-xyz789' }).length, 0);
  assert.equal(problemasDeConfiguracion({}).length, 3);
  const ej = problemasDeConfiguracion({ SESSION_SECRET: 'cambia-este-secreto-en-produccion', PROFE_CODE: 'PROFE-2026', ADMIN_CODE: 'ADMIN-2026' });
  assert.equal(ej.length, 3);
  assert.match(problemasDeConfiguracion({ SESSION_SECRET: 'x'.repeat(32), PROFE_CODE: 'IGUALIGUAL', ADMIN_CODE: 'IGUALIGUAL' }).join(), /no pueden ser iguales/);
});

test('arranque: en producción no arranca con claves de ejemplo; en desarrollo solo avisa', () => {
  assert.throws(() => verificarArranque({ NODE_ENV: 'production' }, { warn() {} }), /no arranca/);
  let avisos = 0;
  verificarArranque({ NODE_ENV: 'development' }, { warn: () => avisos++ });
  assert.equal(avisos, 1);
  assert.doesNotThrow(() => verificarArranque({ NODE_ENV: 'production', SESSION_SECRET: 'x'.repeat(32), PROFE_CODE: 'PROFE-abc123', ADMIN_CODE: 'ADMIN-xyz789' }));
});

test('límite de intentos: bloquea al llegar al máximo, se libera con el tiempo y con un acierto', () => {
  const l = crearLimitador({ max: 3, ventanaMs: 60000 });
  const t0 = 1_000_000;
  for (let i = 0; i < 2; i++) l.fallo('a', t0);
  assert.equal(l.bloqueado('a', t0), 0);
  l.fallo('a', t0);
  assert.ok(l.bloqueado('a', t0 + 1000) > 0, 'bloqueado');
  assert.equal(l.bloqueado('b', t0), 0, 'otra clave no se afecta');
  assert.equal(l.bloqueado('a', t0 + 61000), 0, 'pasó la ventana');
  l.fallo('c', t0); l.fallo('c', t0); l.exito('c'); l.fallo('c', t0);
  assert.equal(l.bloqueado('c', t0), 0, 'un acierto reinicia la cuenta');
});

const clase = (id, dia, ini, fin, materia, color) => ({ id, dia, hora_inicio: ini, hora_fin: fin, materia, color });

test('traslado: avisa solo entre liceo y UTU con poco margen', () => {
  const justo = lib.problemasTraslado([clase(1, 'Lunes', '13:00', '14:20', '7°A UTU', 'azul'), clase(2, 'Lunes', '14:40', '15:25', '7°5', 'amarillo')]);
  assert.equal(justo.length, 1);
  assert.match(justo[0].texto, /20 min/);
  assert.deepEqual(justo[0].ids, [1, 2]);
  // margen suficiente
  assert.equal(lib.problemasTraslado([clase(1, 'Lunes', '13:00', '14:00', 'A', 'azul'), clase(2, 'Lunes', '14:40', '15:25', 'B', 'amarillo')]).length, 0);
  // mismo lugar, coordinación o sin lugar: no cuenta
  assert.equal(lib.problemasTraslado([clase(1, 'Lunes', '13:00', '14:20', 'A', 'azul'), clase(2, 'Lunes', '14:20', '15:00', 'B', 'azul')]).length, 0);
  assert.equal(lib.problemasTraslado([clase(1, 'Lunes', '13:00', '14:20', 'A', 'azul'), clase(2, 'Lunes', '14:25', '15:00', 'B', 'verde')]).length, 0);
  assert.equal(lib.problemasTraslado([clase(1, 'Lunes', '13:00', '14:20', 'A', null), clase(2, 'Lunes', '14:25', '15:00', 'B', 'amarillo')]).length, 0);
  // días distintos
  assert.equal(lib.problemasTraslado([clase(1, 'Lunes', '13:00', '14:20', 'A', 'azul'), clase(2, 'Martes', '14:25', '15:00', 'B', 'amarillo')]).length, 0);
});

test('traslados(): recorre a todos los profesores (con o sin cuenta) y respeta el horario real de Silvio', () => {
  require('../lib/horarioSilvio').cargarHorarioSilvio({ forzar: true });
  const t = lib.traslados();
  assert.ok(t.length >= 1);
  assert.ok(t.every(x => x.profesor === 'Silvio Fagundez' && x.clave === 'n:Silvio Fagundez'));
  assert.ok(t.some(x => x.dia === 'Lunes'), 'Lunes: UTU 14:20 → liceo 14:40');
});
