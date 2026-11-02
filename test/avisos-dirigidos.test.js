// Avisos dirigidos: para todos, para cursos, para un turno o para un grupo de profesores.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cuadrilla-avisos-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.BACKUP_DIR = path.join(tmp, 'backups');

const db = require('../db/database');
const avisos = require('../lib/avisosLib');

const usuario = (nombre, rol) => {
  const id = Number(db.prepare('INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES (?, ?, ?, ?)').run(nombre, nombre.replace(/\W/g, '') + '@t.com', 'h', rol).lastInsertRowid);
  return { id, nombre, rol };
};
const clase = (u, dia, curso) => db.prepare(`INSERT INTO horarios (dia, hora_inicio, hora_fin, materia, estado, profesor_id, profesor_nombre, curso)
  VALUES (?, '08:00', '09:00', 'Matemática', 'ocupado', ?, ?, ?)`).run(dia, u.id, u.nombre, curso);
// Publica como lo hace la ruta: valida el destino y guarda.
const publicar = (cuerpo) => {
  const d = avisos.parsearDestino(cuerpo);
  if (d.error) return d;
  const id = Number(db.prepare('INSERT INTO avisos (tipo, titulo, contenido, autor_nombre, destino_tipo, destino) VALUES (?, ?, ?, ?, ?, ?)')
    .run('aviso', 'T', 'C', 'Admin', d.tipo, d.tipo === 'todos' ? null : JSON.stringify(d.valores)).lastInsertRowid);
  return { aviso: db.prepare('SELECT * FROM avisos WHERE id = ?').get(id) };
};

const admin = usuario('Admin', 'admin');
const alumno = usuario('Alba Alumna', 'alumno');
const saul = usuario('Saúl Pereira', 'profesor');        // turno 1 de la plantilla
const silvio = usuario('Silvio Fagundez', 'profesor');   // turno 2 de la plantilla
const otra = usuario('Otra Persona', 'profesor');        // no está en la plantilla: sin turno
clase(saul, 'Lunes', '7°3');
clase(silvio, 'Martes', '7º 3');                          // mismo curso escrito distinto
clase(silvio, 'Jueves', '3°MA');
clase(otra, 'Viernes', '8°1');

const ven = (aviso) => [admin, alumno, saul, silvio, otra].filter(u => avisos.visiblePara(aviso, u)).map(u => u.nombre);

test('sin destino es para todos (como antes)', () => {
  const { aviso } = publicar({});
  assert.equal(aviso.destino_tipo, 'todos');
  assert.deepEqual(ven(aviso), ['Admin', 'Alba Alumna', 'Saúl Pereira', 'Silvio Fagundez', 'Otra Persona']);
  assert.equal(avisos.presentar(aviso, true).para, null);
});

test('por curso: lo ven los profesores con clases en ese curso (7°3 = 7º 3); el alumno no', () => {
  const { aviso } = publicar({ destino_tipo: 'cursos', destino: ['7°3'] });
  assert.deepEqual(ven(aviso), ['Admin', 'Saúl Pereira', 'Silvio Fagundez']);
  assert.equal(avisos.contarDestinatarios(aviso), 2);
  assert.match(avisos.presentar(aviso, false).para, /^Curso 7°3$/);
  const varios = publicar({ destino_tipo: 'cursos', destino: ['3°MA', '8°1'] }).aviso;
  assert.deepEqual(ven(varios), ['Admin', 'Silvio Fagundez', 'Otra Persona']);
});

test('por turno: según la plantilla; quien no está en ella no lo recibe', () => {
  const t1 = publicar({ destino_tipo: 'turno', destino: ['1'] }).aviso;
  assert.deepEqual(ven(t1), ['Admin', 'Saúl Pereira']);
  assert.equal(avisos.presentar(t1, true).para, 'Turno 1');
  const ambos = publicar({ destino_tipo: 'turno', destino: ['1', '2'] }).aviso;
  assert.deepEqual(ven(ambos), ['Admin', 'Saúl Pereira', 'Silvio Fagundez']);
  assert.equal(avisos.presentar(ambos, true).para, 'Turnos 1 y 2');
});

test('por grupo de profesores: por nombre (tolera orden y tildes), de la plantilla o con cuenta', () => {
  const g = publicar({ destino_tipo: 'profesores', destino: ['pereira saúl', 'Otra Persona'] }).aviso;
  assert.deepEqual(JSON.parse(g.destino), ['Saúl Pereira', 'Otra Persona']);
  assert.deepEqual(ven(g), ['Admin', 'Saúl Pereira', 'Otra Persona']);
  // El admin ve los nombres; el profesor solo que es para un grupo.
  assert.equal(avisos.presentar(g, true).para, 'Profesores: Saúl Pereira, Otra Persona');
  assert.equal(avisos.presentar(g, false).para, 'Grupo de profesores');
  assert.equal(avisos.presentar(g, false).destino, undefined);
});

test('validaciones del destino', () => {
  assert.match(publicar({ destino_tipo: 'cursos', destino: [] }).error, /Elegí a quién/);
  assert.match(publicar({ destino_tipo: 'cursos' }).error, /Elegí a quién/);
  assert.match(publicar({ destino_tipo: 'cursos', destino: ['99°Z'] }).error, /no está en el horario/);
  assert.match(publicar({ destino_tipo: 'turno', destino: ['3'] }).error, /no existe/);
  assert.match(publicar({ destino_tipo: 'profesores', destino: ['Fulano Inexistente'] }).error, /no existe/);
  assert.match(publicar({ destino_tipo: 'todo-el-mundo' }).error, /Destino no válido/);
  assert.equal(publicar({ destino_tipo: 'todos', destino: ['basura'] }).aviso.destino, null);
});

test('opciones para el formulario: cursos sin repetir, turnos y profesores', () => {
  const o = avisos.opcionesDestino();
  assert.deepEqual(o.cursos, ['3°MA', '7°3', '8°1']);
  assert.deepEqual(o.turnos.map(t => t.valor), ['1', '2']);
  assert.ok(o.profesores.some(p => p.nombre === 'Mónica Prats' && p.turno === 1));
});

test('un aviso viejo (sin destino guardado) sigue siendo para todos', () => {
  const id = Number(db.prepare("INSERT INTO avisos (tipo, titulo, contenido, autor_nombre) VALUES ('aviso', 'Viejo', 'x', 'Admin')").run().lastInsertRowid);
  const viejo = db.prepare('SELECT * FROM avisos WHERE id = ?').get(id);
  assert.equal(viejo.destino_tipo, 'todos');
  assert.ok(avisos.visiblePara(viejo, alumno));
});
