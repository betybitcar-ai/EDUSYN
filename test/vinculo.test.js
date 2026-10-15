// Las cuentas de profesores ya creadas reciben sus clases aunque el nombre no sea idéntico.
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
process.env.DB_PATH = path.join(os.tmpdir(), `cuadrilla-vinculo-${Date.now()}.db`);
const db = require('../db/database');
const lib = require('../lib/horariosLib');

const turno2 = ['Silvio Fagundez', 'Robert Rodríguez', 'Mauro Ipar', 'Carolina Quevedo', 'Jose Larronda', 'Ana Li Rodríguez', 'María Bitancourt', 'Andrea Da Silva', 'Jonhy Vasconcellos'];
const turno1 = ['Mónica Prats', 'María Manassi', 'Antonella Del Rio', 'Bruno Cornelius', 'Saúl Pereira', 'Ana Mensinguer', 'Martin Tulipano', 'Marcos Kaiser'];
const cuentas = [...turno2, ...turno1];

cuentas.forEach((n, i) => db.prepare("INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES (?, ?, 'h', 'profesor')").run(n, `p${i}@t.com`));
const idDe = (n) => db.prepare('SELECT id FROM usuarios WHERE nombre = ?').get(n).id;
const clase = (nombre, hora) => Number(db.prepare(
  "INSERT INTO horarios (dia, hora_inicio, hora_fin, materia, estado, profesor_nombre) VALUES ('Lunes', ?, ?, 'X', 'disponible', ?)"
).run(hora, hora.replace(/^\d\d/, h => String(+h + 1).padStart(2, '0')), nombre).lastInsertRowid);

test('mismoNombre tolera tildes, mayúsculas, orden, palabras de más y erratas', () => {
  assert.ok(lib.mismoNombre('MARIA BITANCOURT', 'María Bitancourt'));
  assert.ok(lib.mismoNombre('Rodríguez Robert', 'Robert Rodríguez'));
  assert.ok(lib.mismoNombre('Ana Rodríguez', 'Ana Li Rodríguez'));
  assert.ok(lib.mismoNombre('Silvio Fagunde', 'Silvio Fagundez'));
  assert.ok(lib.mismoNombre('Prof. Mónica Prats', 'Monica Prats'));
  assert.ok(!lib.mismoNombre('Ana Rodríguez', 'Robert Rodríguez'));
  assert.ok(!lib.mismoNombre('Ana', 'Ana Mensinguer'), 'un solo nombre es ambiguo');
});

test('cada clase cargada con el nombre (con variantes) llega a la cuenta correcta', () => {
  const variantes = { 'Silvio Fagunde': 'Silvio Fagundez', 'jonhy vasconcellos': 'Jonhy Vasconcellos', 'Saul Pereira': 'Saúl Pereira',
    'Ana Rodríguez': 'Ana Li Rodríguez', 'Del Rio Antonella': 'Antonella Del Rio' };
  const ids = Object.entries(variantes).map(([v, real], i) => [clase(v, `${String(8 + i).padStart(2, '0')}:00`), real]);
  cuentas.forEach((n, i) => { if (!Object.values(variantes).includes(n)) ids.push([clase(n, `${String(8 + i % 10).padStart(2, '0')}:30`), n]); });

  assert.equal(lib.vincularBloquesPorNombre(), ids.length);
  for (const [id, real] of ids) {
    const h = db.prepare('SELECT * FROM horarios WHERE id = ?').get(id);
    assert.equal(h.profesor_id, idDe(real), `${h.id} → ${real}`);
    assert.equal(h.profesor_nombre, real);
    assert.equal(h.estado, 'ocupado');
  }
});

test('si el nombre es ambiguo no adivina', () => {
  db.prepare("INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES ('Ana Pérez', 'a1@t.com', 'h', 'profesor'), ('Ana Pérez Gómez', 'a2@t.com', 'h', 'profesor')").run();
  const id = clase('Ana Pérez', '18:00');
  lib.vincularBloquesPorNombre();
  // "Ana Pérez" coincide exacto con una cuenta → se asigna a esa
  assert.equal(db.prepare('SELECT profesor_id FROM horarios WHERE id = ?').get(id).profesor_id, idDe('Ana Pérez'));
  const raro = clase('Ana Pérez Gómez Luna', '19:00')   // encaja con dos cuentas distintas;
  lib.vincularBloquesPorNombre();
  assert.equal(db.prepare('SELECT profesor_id FROM horarios WHERE id = ?').get(raro).profesor_id, null);
});

test('el selector del admin ofrece a todos los de la plantilla (con o sin cuenta) sin duplicar', () => {
  const lista = lib.profesoresParaSelector();
  const { PLANTILLA } = require('../lib/profesoresPlantilla');
  for (const p of PLANTILLA) assert.equal(lista.filter(x => lib.mismoNombre(x.nombre, p.nombre)).length, 1, p.nombre);
  assert.equal(PLANTILLA.length, 17);
  const conCuenta = lista.filter(x => x.cuenta).length;
  assert.equal(conCuenta, db.prepare("SELECT COUNT(*) AS n FROM usuarios WHERE rol = 'profesor'").get().n);
  assert.ok(lista.find(x => x.nombre === 'Silvio Fagundez').turno === 2);
  assert.equal(lib.nombreDePlantilla('jonhy vasconcellos'), 'Jonhy Vasconcellos');
  assert.equal(lib.nombreDePlantilla('Nadie Conocido'), null);
});

test('choque entre clases a nombre de un profesor sin cuenta', () => {
  const c = lib.buscarConflicto({ dia: 'Lunes', hora_inicio: '07:30', hora_fin: '08:00', profesor_id: null, profesor_nombre: 'Silvio Fagundez' });
  assert.equal(c, null, 'sin clases cargadas no hay choque');
  db.prepare("INSERT INTO horarios (dia, hora_inicio, hora_fin, materia, estado, profesor_nombre) VALUES ('Lunes','07:30','08:15','Z','ocupado','Silvio Fagundez')").run();
  assert.match(lib.buscarConflicto({ dia: 'Lunes', hora_inicio: '07:30', hora_fin: '08:00', profesor_id: null, profesor_nombre: 'Silvio Fagundez' }), /Silvio Fagundez ya tiene/);
});
