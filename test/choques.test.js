// Detector de choques: lo que entregó el profesor contra las clases que le asignó el admin.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cuadrilla-choques-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.BACKUP_DIR = path.join(tmp, 'backups');

const db = require('../db/database');
const choques = require('../lib/choquesLib');
const entrega = require('../lib/entregaHorarioLib');

const usuario = (nombre, rol) => {
  const id = Number(db.prepare('INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES (?, ?, ?, ?)').run(nombre, nombre.replace(/\W/g, '') + '@t.com', 'h', rol).lastInsertRowid);
  return { id, nombre, rol };
};
// Clase de la grilla del admin (origen "manual") o entregada por el profesor (origen "carga-profesor").
const clase = (u, { dia, ini, fin, materia, curso, origen = 'manual' }) =>
  Number(db.prepare(`INSERT INTO horarios (dia, hora_inicio, hora_fin, materia, estado, profesor_id, profesor_nombre, origen, curso)
                     VALUES (?, ?, ?, ?, 'ocupado', ?, ?, ?, ?)`).run(dia, ini, fin, materia, u.id, u.nombre, origen, curso ?? null).lastInsertRowid);
const grilla = (u, o) => clase(u, { ...o, materia: o.materia || 'Matemática' });
const entregada = (u, o) => clase(u, { ...o, materia: o.curso || 'Coordinación', origen: 'carga-profesor' });

const admin = usuario('Admin', 'admin');

test('núcleo: lo que coincide no genera avisos (aunque el curso venga escrito distinto)', () => {
  const a = [{ id: 1, dia: 'Lunes', hora_inicio: '08:00', hora_fin: '09:00', materia: 'Matemática', curso: '7°3' }];
  const e = [{ id: 2, dia: 'Lunes', hora_inicio: '08:00', hora_fin: '09:00', materia: '7º 3', curso: '7º 3' }];
  assert.deepEqual(choques.compararProfesor(a, e), []);
});

test('núcleo: clase que falta, dos lugares a la vez y hora distinta', () => {
  const a = [
    { id: 1, dia: 'Lunes', hora_inicio: '08:00', hora_fin: '09:00', materia: 'Matemática', curso: '7°3' },     // coincide
    { id: 2, dia: 'Martes', hora_inicio: '10:00', hora_fin: '11:00', materia: 'Física', curso: '8°1' },        // no la entregó → falta
    { id: 3, dia: 'Miércoles', hora_inicio: '08:00', hora_fin: '09:00', materia: 'Química', curso: '9°2' },    // en otro lado → dos lugares
    { id: 4, dia: 'Jueves', hora_inicio: '08:00', hora_fin: '09:30', materia: 'Historia', curso: '7°1' }       // hora distinta
  ];
  const e = [
    { id: 11, dia: 'Lunes', hora_inicio: '08:00', hora_fin: '09:00', materia: '7°3', curso: '7°3' },
    { id: 13, dia: 'Miércoles', hora_inicio: '08:30', hora_fin: '09:30', materia: '3°MA', curso: '3°MA' },
    { id: 14, dia: 'Jueves', hora_inicio: '08:00', hora_fin: '09:00', materia: '7°1', curso: '7°1' }
  ];
  const r = choques.compararProfesor(a, e);
  assert.deepEqual(r.map(x => [x.tipo, x.dia]), [['falta', 'Martes'], ['doble_lugar', 'Miércoles'], ['hora_distinta', 'Jueves']]);
  assert.match(r[0].texto, /Física \(8°1\).*no figura/);
  assert.match(r[1].texto, /dos lugares a la vez.*Química \(9°2\).*3°MA/);
  assert.match(r[2].texto, /Historia \(7°1\).*08:00–09:00/);
  assert.deepEqual(r[1].ids, [3, 13]);
});

test('núcleo: coordinación (sin curso) que pisa una clase de la grilla cuenta como dos lugares', () => {
  const a = [{ id: 1, dia: 'Lunes', hora_inicio: '08:00', hora_fin: '09:00', materia: 'Matemática', curso: '7°3' }];
  const e = [{ id: 2, dia: 'Lunes', hora_inicio: '08:00', hora_fin: '09:00', materia: 'Coordinación', curso: null }];
  assert.equal(choques.compararProfesor(a, e)[0].tipo, 'doble_lugar');
});

test('con datos reales: solo se compara a quien ya entregó', () => {
  const ana = usuario('Ana Pérez', 'profesor');
  const luis = usuario('Luis Gómez', 'profesor');
  const sol = usuario('Sol Ríos', 'profesor');
  // Ana: entregó y tiene todo bien salvo una clase que falta y una que se pisa.
  grilla(ana, { dia: 'Lunes', ini: '08:00', fin: '09:00', curso: '7°3' });
  entregada(ana, { dia: 'Lunes', ini: '08:00', fin: '09:00', curso: '7°3' });
  grilla(ana, { dia: 'Martes', ini: '10:00', fin: '11:00', curso: '8°1' });
  grilla(ana, { dia: 'Jueves', ini: '08:00', fin: '09:00', curso: '9°2' });
  entregada(ana, { dia: 'Jueves', ini: '08:30', fin: '09:30', curso: '3°MA' });
  // Luis: tiene clases en la grilla pero no entregó nada → no hay con qué comparar.
  grilla(luis, { dia: 'Lunes', ini: '08:00', fin: '09:00', curso: '7°1' });
  // Sol: solo entregó (sin clases en la grilla) → tampoco hay nada que contrastar.
  entregada(sol, { dia: 'Viernes', ini: '08:00', fin: '09:00', curso: '7°2' });

  const r = choques.detectarChoques();
  assert.equal(r.revisados, 1);
  assert.equal(r.sin_entregar, 1);
  assert.deepEqual(r.choques.map(c => c.tipo).sort(), ['doble_lugar', 'falta']);
  assert.ok(r.choques.every(c => c.profesor === 'Ana Pérez' && c.clave === String(ana.id)));
  assert.equal(choques.choquesDe(luis.id).length, 0);
  assert.equal(choques.resumenTipos(r.choques), '1 en dos lugares a la vez, 1 clase que falta');
});

test('al entregar, el aviso al admin dice si no coincide con la grilla', () => {
  const eva = usuario('Eva Soto', 'profesor');
  grilla(eva, { dia: 'Lunes', ini: '08:00', fin: '09:00', curso: '7°3' });
  grilla(eva, { dia: 'Martes', ini: '08:00', fin: '09:00', curso: '8°1' });
  entrega.guardarEntrega(eva, [{ dia: 'Lunes', hora_inicio: '08:00', hora_fin: '09:00', materia: '7°3', curso: '7°3', color: 'amarillo' }]);
  const msg = db.prepare('SELECT contenido FROM mensajes WHERE destinatario_id = ? ORDER BY id DESC').get(admin.id).contenido;
  assert.match(msg, /Eva Soto entregó su horario semanal/);
  assert.match(msg, /No coincide con la grilla: 1 clase que falta/);

  // Si lo entregado cuadra, no hay alerta.
  const leo = usuario('Leo Paz', 'profesor');
  grilla(leo, { dia: 'Lunes', ini: '08:00', fin: '09:00', curso: '7°3' });
  entrega.guardarEntrega(leo, [{ dia: 'Lunes', hora_inicio: '08:00', hora_fin: '09:00', materia: '7°3', curso: '7°3', color: null }]);
  const msg2 = db.prepare('SELECT contenido FROM mensajes WHERE destinatario_id = ? ORDER BY id DESC').get(admin.id).contenido;
  assert.match(msg2, /Leo Paz entregó/);
  assert.doesNotMatch(msg2, /No coincide/);
});
