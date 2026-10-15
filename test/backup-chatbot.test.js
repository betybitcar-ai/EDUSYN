// Pruebas de la lógica del backup y del asistente (sin servidor HTTP ni Gemini).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cuadrilla-bk-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.BACKUP_DIR = path.join(tmp, 'backups');

const db = require('../db/database');
const backup = require('../lib/backupLib');
const { responder, detectarIntencion } = require('../lib/chatbot');

const nuevoUsuario = (nombre, email, rol) => {
  const id = db.prepare('INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES (?, ?, ?, ?)').run(nombre, email, 'hash', rol).lastInsertRowid;
  return { id: Number(id), nombre, email, rol };
};
const clase = (dia, ini, fin, materia, salon, p) => db.prepare(
  `INSERT INTO horarios (dia, hora_inicio, hora_fin, materia, salon, estado, profesor_id, profesor_nombre) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
).run(dia, ini, fin, materia, salon, p ? 'ocupado' : 'disponible', p ? p.id : null, p ? p.nombre : null);

db.setConfig('horario_publicado', '1');   // los profesores solo ven el horario publicado
const admin = nuevoUsuario('Admin', 'admin@t.com', 'admin');
const ana = nuevoUsuario('Ana <b>Pérez</b>', 'ana@t.com', 'profesor');
const carlos = nuevoUsuario('Carlos Gómez', 'carlos@t.com', 'profesor');
clase('Jueves', '08:00', '09:30', 'Física', 'Aula 1', ana);
clase('Lunes', '08:00', '09:30', 'Matemáticas', 'Aula 2', ana);
clase('Lunes', '09:45', '11:15', 'Arte', 'Taller', null);
clase('Lunes', '08:00', '09:30', 'Historia', 'Aula 3', carlos);   // carlos NO está libre a las 8 del lunes

const pedir = (usuario, mensaje, extra = {}, deps = {}) => responder({ usuario, mensaje, historial: [], ...extra }, deps);

test('detecta intenciones, con o sin tildes', () => {
  assert.equal(detectarIntencion('Hacé un BACKUP por favor'), 'backup');
  assert.equal(detectarIntencion('copia de seguridad'), 'backup');
  assert.equal(detectarIntencion('necesito cambiar horario'), 'intercambio_horario');
  assert.equal(detectarIntencion('No puedo dar clase el lunes'), 'buscar_reemplazo');
  assert.equal(detectarIntencion('ver horarios'), 'tabla_markdown');
  assert.equal(detectarIntencion('qué clases libres hay'), 'disponibilidad');
  assert.equal(detectarIntencion('generá una imagen del horario'), 'generar_imagen');
  assert.equal(detectarIntencion('hola'), 'ayuda');
  assert.equal(detectarIntencion('¿cómo se calcula una derivada?'), 'ia');
});

test('tabla: ordena de lunes a sábado y no rompe con | en los datos', async () => {
  const r = await pedir(ana, 'ver tabla');
  assert.equal(r.tipo, 'texto');
  assert.ok(r.respuesta.indexOf('Matemáticas') < r.respuesta.indexOf('Física'), 'Lunes antes que Jueves');
});

test('disponibilidad lista solo las clases sin profesor', async () => {
  const r = await pedir(ana, 'disponibilidad');
  assert.match(r.respuesta, /Arte/);
  assert.doesNotMatch(r.respuesta, /Matemáticas/);
});

test('imagen: devuelve un SVG válido y escapa nombres', async () => {
  const r = await pedir(admin, 'generar imagen del horario');
  assert.equal(r.tipo, 'imagen');
  const svg = Buffer.from(r.imagen_url.split(',')[1], 'base64').toString();
  assert.match(svg, /^<svg /);
  assert.doesNotMatch(svg, /<b>/);
  assert.match(svg, /&lt;b&gt;/);
});

test('sin IA configurada responde con el menú en vez de fallar', async () => {
  const r = await pedir(ana, '¿cómo se calcula una derivada?');
  assert.match(r.respuesta, /GEMINI_API_KEY/);
});

test('con IA usa la función recibida y le pasa contexto e historial', async () => {
  let recibido;
  const r = await pedir(ana, 'explicame algo', { historial: [{ rol: 'yo', texto: 'hola' }] },
    { generarIA: async (p) => { recibido = p; return 'respuesta de IA'; } });
  assert.equal(r.respuesta, 'respuesta de IA');
  assert.match(recibido.system, /Matemáticas/);
  assert.equal(recibido.historial.length, 1);
});

test('si la IA falla, el usuario recibe un mensaje claro (no un error 500)', async () => {
  const r = await pedir(ana, 'explicame algo', {}, { generarIA: async () => { throw new Error('boom'); } });
  assert.equal(r.tipo, 'texto');
  assert.match(r.respuesta, /no puedo consultar a la IA/);
});

test('lista negra: solo admin', async () => {
  assert.match((await pedir(ana, 'lista negra')).respuesta, /exclusiva de la administración/);
  assert.match((await pedir(admin, 'lista negra')).respuesta, /Nadie alcanzó/);
});

test('reemplazo: lista solo profesores realmente libres y avisa al admin', async () => {
  const r = await pedir(ana, 'no puedo dar clase el lunes');
  assert.match(r.respuesta, /Matemáticas/);
  assert.match(r.respuesta, /nadie libre/, 'Carlos tiene Historia a la misma hora');
  const msg = db.prepare("SELECT * FROM mensajes WHERE tipo = 'relevo' AND destinatario_id = ?").all(admin.id);
  assert.equal(msg.length, 1);
  await pedir(ana, 'no puedo dar clase el lunes');   // repetir no duplica el aviso
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM mensajes WHERE tipo = 'relevo'").get().n, 1);
});

test('intercambio: registra, empareja con otro profesor y entrega mensajes', async () => {
  const a = await pedir(ana, 'necesito cambiar horario del jueves');
  assert.match(a.respuesta, /Registré tu pedido/);
  assert.match((await pedir(ana, 'cambiar horario del jueves')).respuesta, /Ya tenés una solicitud pendiente/);
  const b = await pedir(carlos, 'quiero cambiar horario');
  assert.match(b.respuesta, /coincidencia con \*\*Ana/);
  assert.match((await pedir(ana, 'mis mensajes')).respuesta, /Carlos Gómez/);
  assert.match((await pedir(carlos, 'mis mensajes')).respuesta, /Sistema Cuadrilla/);
});

test('backup por chat: el profesor no puede, el admin sí', async () => {
  const antes = backup.listarBackups().length;
  assert.match((await pedir(ana, 'hacer backup')).respuesta, /solo los puede gestionar el administrador/);
  assert.match((await pedir(ana, 'ver backups')).respuesta, /solo los puede gestionar/);
  assert.equal(backup.listarBackups().length, antes, 'no se creó nada');
  const r = await pedir(admin, 'hacer backup');
  assert.match(r.respuesta, /Backup creado/);
  assert.equal(backup.listarBackups().length, antes + 1);
  assert.match((await pedir(admin, 'ver backups')).respuesta, /Backups disponibles/);
});

test('backup: crear, listar, restaurar y proteger contra rutas maliciosas', () => {
  const b = backup.crearBackup('manual');
  assert.match(b.nombre, /^cuadrilla-\d{8}-\d{6}-manual\.db$/);
  assert.ok(backup.listarBackups().some(x => x.nombre === b.nombre));

  const clases = () => db.prepare('SELECT COUNT(*) AS n FROM horarios').get().n;
  const antes = clases();
  db.prepare('DELETE FROM horarios').run();
  db.prepare("INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES ('Nuevo', 'nuevo@t.com', 'h', 'alumno')").run();
  assert.equal(clases(), 0);

  const r = backup.restaurarBackup(b.nombre);
  assert.equal(clases(), antes, 'las clases vuelven');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM usuarios WHERE email = 'nuevo@t.com'").get().n, 0, 'lo posterior al backup desaparece');
  assert.match(r.respaldo_de_seguridad, /-seguridad\.db$/);
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1, 'las claves foráneas quedan activas');
  // los ids siguen funcionando después de restaurar
  assert.ok(clase('Viernes', '10:00', '11:00', 'Nueva', null, null).lastInsertRowid > antes);

  for (const malo of ['../../etc/passwd', 'cuadrilla-x.db', '..\\x.db', '', null, 'cuadrilla-20260101-000000-manual.db/../x'])
    assert.throws(() => backup.rutaBackup(malo), /no válido|no existe/);
  assert.throws(() => backup.rutaBackup('cuadrilla-20200101-000000-manual.db'), /no existe/);
});

test('backup: rechaza un archivo que no es una base de Cuadrilla', () => {
  const falso = 'cuadrilla-20200101-000000-manual.db';
  fs.writeFileSync(path.join(process.env.BACKUP_DIR, falso), 'esto no es sqlite');
  assert.throws(() => backup.restaurarBackup(falso), /dañado/);
  backup.eliminarBackup(falso);
});

test('backup: se pueden borrar y los automáticos se podan', () => {
  for (let i = 0; i < 4; i++) backup.crearBackup('auto');
  backup.podarAutomaticos(2);
  assert.equal(backup.listarBackups().filter(b => b.tipo === 'auto').length, 2);
  const b = backup.listarBackups()[0];
  backup.eliminarBackup(b.nombre);
  assert.ok(!backup.listarBackups().some(x => x.nombre === b.nombre));
});

test('chatbot: dice que a esa hora el profesor está en otro lugar (o libre)', async () => {
  // Carlos tiene Historia el lunes 08:00–09:30 en Aula 3
  const r = await pedir(admin, '¿dónde está Carlos el lunes a las 8:30?');
  assert.match(r.respuesta, /en otro lugar/);
  assert.match(r.respuesta, /Historia/);
  assert.match(r.respuesta, /Aula 3/);
  assert.match((await pedir(admin, '¿está libre Carlos el lunes a las 10?')).respuesta, /está libre/);
  // el profesor sin nombrar a nadie habla de sí mismo
  const yo = await pedir(ana, 'estoy libre el lunes a las 9?');
  assert.match(yo.respuesta, /estás en otro lugar/);
  assert.match(yo.respuesta, /Matemáticas/);
  // sin hora: lista el día
  assert.match((await pedir(admin, 'qué tiene Carlos el lunes')).respuesta, /Historia/);
});

test('chatbot: al buscar reemplazo muestra quién está en otro lugar a esa hora', async () => {
  const r = await pedir(admin, 'reemplazo para el lunes');
  assert.match(r.respuesta, /En otro lugar a esa hora: Carlos Gómez \(en Historia/);
});

test('chatbot: si el horario no está publicado el profesor no lo ve, el admin sí', async () => {
  db.setConfig('horario_publicado', '0');
  try {
    for (const q of ['ver tabla', 'mi horario', 'disponibilidad', 'generar imagen del horario'])
      assert.match((await pedir(ana, q)).respuesta, /todavía no fue publicado/, q);
    assert.match((await pedir(admin, 'ver tabla')).respuesta, /Matemáticas/);
    let ctxIA;
    await pedir(ana, 'explicame algo', {}, { generarIA: async (p) => { ctxIA = p.system; return 'ok'; } });
    assert.doesNotMatch(ctxIA, /Matemáticas/);
  } finally { db.setConfig('horario_publicado', '1'); }
});

const cambios = require('../lib/cambiosLib');
const lib = require('../lib/horariosLib');
const mensajesDe = (u) => db.prepare('SELECT contenido FROM mensajes WHERE destinatario_id = ? ORDER BY id').all(u.id).map(m => m.contenido);

test('intercambio: queda pendiente y el admin lo ve; si genera un choque no se puede aprobar', async () => {
  const lista = cambios.pendientes();
  assert.equal(lista.length, 1);
  assert.match(JSON.stringify(lista[0]), /Física/);
  assert.ok(mensajesDe(admin).some(m => /Intercambio por aprobar/.test(m)), 'se avisó al admin');
  // Ana pasaría a Historia (lunes 8:00), pero ya tiene Matemáticas a esa hora
  assert.throws(() => cambios.aprobar(lista[0].id), /No se puede aprobar/);
  cambios.rechazar(lista[0].id);
  assert.equal(cambios.pendientes().length, 0);
  assert.ok(mensajesDe(ana).some(m => /no aprobó/.test(m)));
});

test('intercambio aprobado: los dos profesores se cambian de clase y reciben aviso', async () => {
  const p1 = nuevoUsuario('Pedro Uno', 'p1@t.com', 'profesor'), p2 = nuevoUsuario('Paula Dos', 'p2@t.com', 'profesor');
  clase('Martes', '08:00', '09:30', 'Biología', 'Aula 7', p1);
  clase('Miércoles', '10:00', '11:30', 'Geografía', 'Aula 8', p2);
  await pedir(p1, 'cambiar horario');
  assert.match((await pedir(p2, 'cambiar horario')).respuesta, /coincidencia/);
  const [par] = cambios.pendientes();
  assert.ok(par);
  // Antes de aprobar nada cambia
  assert.equal(lib.clasesDeProfesor(p1)[0].materia, 'Biología');
  cambios.aprobar(par.id);
  assert.equal(lib.clasesDeProfesor(p1)[0].materia, 'Geografía');
  assert.equal(lib.clasesDeProfesor(p2)[0].materia, 'Biología');
  assert.ok(mensajesDe(p1).some(m => /aprobó el intercambio/.test(m)));
  assert.throws(() => cambios.aprobar(par.id), /ya no está pendiente/);
});

test('aviso al profesor cuando cambia una clase ya publicada (y nada si es borrador)', () => {
  const p = nuevoUsuario('Lola Avisos', 'lola@t.com', 'profesor');
  const ins = clase('Jueves', '14:00', '15:00', 'Dibujo', 'Aula 4', p);
  const antes = db.prepare('SELECT * FROM horarios WHERE id = ?').get(ins.lastInsertRowid);
  db.prepare("UPDATE horarios SET dia = 'Viernes', hora_inicio = '10:00', hora_fin = '11:00', salon = 'Aula 9' WHERE id = ?").run(antes.id);
  const despues = db.prepare('SELECT * FROM horarios WHERE id = ?').get(antes.id);

  db.setConfig('horario_publicado', '0');
  assert.equal(lib.avisarCambioClase(antes, despues), 0, 'borrador: sin aviso');
  db.setConfig('horario_publicado', '1');
  assert.equal(lib.avisarCambioClase(antes, antes), 0, 'sin cambios: sin aviso');
  assert.equal(lib.avisarCambioClase(antes, despues), 1);
  const msg = mensajesDe(p).at(-1);
  assert.match(msg, /Jueves 14:00–15:00 a Viernes 10:00–11:00/);
  assert.match(msg, /Aula 4 → Aula 9/);
  lib.avisarCambioClase(despues, null);
  assert.match(mensajesDe(p).at(-1), /Se eliminó tu clase Dibujo/);
});
