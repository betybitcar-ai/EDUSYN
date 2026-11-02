// Entrega obligatoria del horario semanal: el profesor lo pasa por el asistente y llega a "Por profesor" del admin.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cuadrilla-entrega-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.BACKUP_DIR = path.join(tmp, 'backups');

const db = require('../db/database');
const lib = require('../lib/horariosLib');
const entrega = require('../lib/entregaHorarioLib');
const { responder, detectarIntencion } = require('../lib/chatbot');

const usuario = (nombre, rol) => {
  const id = Number(db.prepare('INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES (?, ?, ?, ?)').run(nombre, nombre.replace(/\W/g, '') + '@t.com', 'h', rol).lastInsertRowid);
  return { id, nombre, rol };
};
const pedir = (u, mensaje) => responder({ usuario: u, mensaje, historial: [] });
db.setConfig('horario_publicado', '1');
const admin = usuario('Admin', 'admin');
const ana = usuario('Ana Pérez', 'profesor');
const luis = usuario('Luis Gómez', 'profesor');

const HORARIO = `Lunes 07:30-09:00 3°MA liceo
Lunes 09:05 a 10:35 3°DF utu
Miércoles 10:40-11:25 Coordinación
Jueves: 7.30-9 3°MC UTU`;

test('detecta cuando el profesor pasa o pide pasar su horario', () => {
  assert.equal(detectarIntencion(HORARIO), 'entregar_horario');
  assert.equal(detectarIntencion('quiero entregar mi horario'), 'entregar_horario');
  assert.equal(detectarIntencion('pasar horario semanal'), 'entregar_horario');
  assert.equal(detectarIntencion('mi horario'), 'mi_horario');
  assert.equal(detectarIntencion('no puedo dar clase el lunes de 8 a 9'), 'buscar_reemplazo');
  assert.equal(detectarIntencion('¿qué salones están libres el lunes a las 9?'), 'salones_libres');
});

test('interpreta días, horas, curso y lugar (en líneas o todo seguido)', () => {
  const { clases, errores } = entrega.parsearHorario(HORARIO);
  assert.deepEqual(errores, []);
  assert.equal(clases.length, 4);
  assert.deepEqual(clases[0], { dia: 'Lunes', hora_inicio: '07:30', hora_fin: '09:00', materia: '3°MA', curso: '3°MA', color: 'amarillo' });
  assert.equal(clases[1].color, 'azul');
  assert.equal(clases[2].color, 'verde');
  assert.equal(clases[2].curso, null);
  assert.deepEqual([clases[3].dia, clases[3].hora_inicio, clases[3].hora_fin, clases[3].curso], ['Jueves', '07:30', '09:00', '3°MC']);
  const seguido = entrega.parsearHorario('Lunes 8:00-9:00 7°1 liceo 9:05-10:00 7°2 liceo Martes 8:00-9:00 8°1 utu');
  assert.deepEqual(seguido.errores, []);
  assert.deepEqual(seguido.clases.map(c => `${c.dia} ${c.hora_inicio} ${c.curso}`), ['Lunes 08:00 7°1', 'Lunes 09:05 7°2', 'Martes 08:00 8°1']);
});

test('detecta errores: sin curso, hora al revés, sin día y clases que se pisan', () => {
  assert.match(entrega.parsearHorario('Lunes 08:00-09:00 liceo\nLunes 10:00-11:00 3°A').errores[0], /falta el curso/);
  assert.match(entrega.parsearHorario('Lunes 10:00-09:00 3°A').errores[0], /posterior/);
  assert.match(entrega.parsearHorario('08:00-09:00 3°A').errores[0], /falta indicar el día/);
  assert.match(entrega.parsearHorario('Lunes 08:00-09:30 3°A\nLunes 09:00-10:00 3°B').errores[0], /se pisa/);
});

test('sin entregar: el asistente pide el horario y bloquea intercambios y reemplazos', async () => {
  assert.equal(entrega.yaEntrego(ana.id), false);
  assert.match((await pedir(ana, 'cambiar horario')).respuesta, /entregar tu horario semanal/);
  assert.match((await pedir(ana, 'no puedo dar clase el lunes')).respuesta, /entregar tu horario semanal/);
  assert.match((await pedir(ana, 'hola')).respuesta, /obligatorio/);
  assert.match((await pedir(ana, 'entregar mi horario')).respuesta, /obligatorio[\s\S]*Lunes 07:30-09:00/);
});

test('un horario con errores no se guarda', async () => {
  const r = await pedir(ana, 'Lunes 08:00-09:00 liceo\nMartes 08:00-09:00 3°A utu');
  assert.match(r.respuesta, /No guardé nada/);
  assert.equal(entrega.yaEntrego(ana.id), false);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM horarios WHERE origen = 'carga-profesor'").get().n, 0);
});

test('el profesor entrega: se guarda como horario personal, lo ve el admin y se avisa', async () => {
  const r = await pedir(ana, HORARIO);
  assert.match(r.respuesta, /Recibí tu horario semanal[\s\S]*\*\*4\*\* clases/);
  assert.match(r.respuesta, /Por profesor/);
  assert.equal(entrega.yaEntrego(ana.id), true);

  const guardadas = lib.clasesDeProfesor({ id: ana.id, nombre: ana.nombre });
  assert.equal(guardadas.length, 4);
  assert.ok(guardadas.every(h => h.origen === 'carga-profesor' && h.profesor_id === ana.id && h.estado === 'ocupado'));

  const aviso = db.prepare("SELECT contenido FROM mensajes WHERE destinatario_id = ?").get(admin.id);
  assert.match(aviso.contenido, /Ana Pérez entregó su horario semanal \(4 clases\)/);
  assert.equal(require('../lib/historialLib').listar({ accion: 'entrega' })[0].usuario_nombre, 'Ana Pérez');

  // Ahora sí puede pedir reemplazos
  assert.doesNotMatch((await pedir(ana, 'no puedo dar clase el lunes')).respuesta, /entregar tu horario semanal/);
});

test('corregir: lo que se manda reemplaza solo esos días, el resto queda', async () => {
  const r = await pedir(ana, 'Jueves 08:00-09:00 3°MC liceo\nJueves 09:05-10:00 3°MD liceo');
  assert.match(r.respuesta, /Actualicé tu horario semanal \(jueves\)/);
  assert.match(r.respuesta, /\*\*5\*\* clases/);
  const guardadas = entrega.entregadas(ana.id);
  assert.deepEqual(guardadas.map(h => h.dia), ['Lunes', 'Lunes', 'Miércoles', 'Jueves', 'Jueves']);
  assert.deepEqual(guardadas.filter(h => h.dia === 'Jueves').map(h => h.curso), ['3°MC', '3°MD']);
  assert.equal(entrega.estadoEntrega(ana.id).cantidad, 5);
});

test('ver mi horario entregado', async () => {
  assert.equal(detectarIntencion('ver mi horario entregado'), 'ver_entrega');
  const r = await pedir(ana, 'ver mi horario entregado');
  assert.match(r.respuesta, /Tu horario entregado.*5 clases/);
  assert.match(r.respuesta, /3°MD/);
  assert.match((await pedir(luis, 'ver mi horario entregado')).respuesta, /Todavía no entregaste|3°X/);
});

test('borrar un día no pide confirmación; borrar todo sí, y vuelve a quedar pendiente', async () => {
  assert.equal(detectarIntencion('borrar mi horario del lunes'), 'borrar_entrega');
  const d = await pedir(ana, 'borrar mi horario del lunes');
  assert.match(d.respuesta, /Borré las clases del \*\*Lunes\*\* \(2\)\. Te quedan 3/);
  assert.deepEqual(entrega.entregadas(ana.id).map(h => h.dia), ['Miércoles', 'Jueves', 'Jueves']);
  assert.match((await pedir(ana, 'borrar mi horario del sábado')).respuesta, /No tenés clases entregadas el Sábado/);

  const c = await pedir(ana, 'borrar mi horario');
  assert.match(c.respuesta, /confirmo borrar todo/);
  assert.equal(entrega.entregadas(ana.id).length, 3, 'sin confirmar no se borra nada');
  const ok = await pedir(ana, 'confirmo borrar todo');
  assert.match(ok.respuesta, /Borré tu horario entregado \(3 clases\)/);
  assert.equal(entrega.yaEntrego(ana.id), false, 'queda pendiente otra vez');
  assert.match(db.prepare("SELECT contenido FROM mensajes WHERE destinatario_id = ? ORDER BY id DESC").get(admin.id).contenido, /borró/);
  // vuelve a entregar para los tests siguientes
  await pedir(ana, HORARIO);
  assert.equal(entrega.yaEntrego(ana.id), true);
});

test('formatos sueltos: varios días juntos, "con", curso antes del día', async () => {
  const a = entrega.parsearHorario('los lunes y miércoles de 8 a 10 con 3°MA en el liceo');
  assert.deepEqual(a.errores, []);
  assert.deepEqual(a.clases.map(c => `${c.dia} ${c.hora_inicio}-${c.hora_fin} ${c.curso} ${c.color}`), ['Lunes 08:00-10:00 3°MA amarillo', 'Miércoles 08:00-10:00 3°MA amarillo']);
  const b = entrega.parsearHorario('3°MA lunes de 8 a 10 utu\n3°MB martes de 9 a 10:30 liceo');
  assert.deepEqual(b.clases.map(c => `${c.dia} ${c.curso} ${c.color}`), ['Lunes 3°MA azul', 'Martes 3°MB amarillo']);
  assert.equal(detectarIntencion('los lunes de 8 a 10 con 3°MA'), 'entregar_horario');
  assert.equal(detectarIntencion('no puedo dar clase el lunes de 8 a 10 con 3°MA'), 'buscar_reemplazo');
  assert.match(entrega.parsearHorario('martes de 8 a 9 liceo').errores[0], /falta el curso/);
});

test('el admin ve quién entregó y quién falta', () => {
  const r = entrega.resumenAdmin();
  assert.equal(r.pendientes, 1);
  assert.equal(r.profesores.find(p => p.nombre === 'Luis Gómez').entregado, false);
  assert.equal(r.profesores.find(p => p.nombre === 'Ana Pérez').entregado, true);
});

test('un horario ya cargado desde planilla cuenta como entregado', () => {
  db.prepare("INSERT INTO horarios (dia, hora_inicio, hora_fin, materia, estado, profesor_id, profesor_nombre, origen) VALUES ('Lunes','08:00','09:00','3°X','ocupado',?,?,'carga-silvio')").run(luis.id, luis.nombre);
  assert.equal(entrega.yaEntrego(luis.id), true);
});

test('el admin no entrega horario', async () => {
  assert.match((await pedir(admin, 'entregar mi horario')).respuesta, /lo entregan los profesores/);
});

test('admin: ¿quién falta entregar? y horario de un profesor', async () => {
  assert.equal(detectarIntencion('¿quién falta entregar el horario?'), 'entregas_admin');
  assert.equal(detectarIntencion('pendientes de entrega'), 'entregas_admin');
  assert.equal(detectarIntencion('quiero entregar mi horario'), 'entregar_horario');
  const r = await pedir(admin, '¿quién falta entregar el horario?');
  assert.match(r.respuesta, /1 de 2 entregaron|2 de 2 entregaron/);
  assert.match((await pedir(ana, '¿quién falta entregar?')).respuesta, /solo para la administración/);

  assert.equal(detectarIntencion('horario de Ana'), 'horario_de_profesor');
  assert.equal(detectarIntencion('qué clases tiene Ana Pérez'), 'horario_de_profesor');
  assert.equal(detectarIntencion('ver horario de la semana'), 'tabla_markdown');
  assert.equal(detectarIntencion('horario del lunes'), 'ia');
  assert.match((await pedir(admin, 'horario de Ana')).respuesta, /Hay varios que coinciden/);   // la plantilla tiene más de una Ana
  const h = await pedir(admin, 'horario de Ana Pérez');
  assert.match(h.respuesta, /\*\*Ana Pérez\*\* · ✅ entregó su horario · 4 clases/);
  assert.match(h.respuesta, /3°MA/);
  assert.match((await pedir(admin, 'horario de Pedro')).respuesta, /No encontré/);
  assert.match((await pedir(ana, 'horario de Luis')).respuesta, /solo la administración/);
});

test('el admin carga el horario de un profesor (por ejemplo leído de una foto)', async () => {
  const marta = usuario('Marta Silva', 'profesor');
  const msg = `Cargar horario de ${marta.nombre}:\nLunes 07:30-09:00 3°MA liceo\nMartes 09:05-10:35 3°DF utu`;
  assert.equal(detectarIntencion(msg), 'cargar_horario_profesor');
  // un profesor no puede cargar el horario de otro
  const noPuede = await pedir(ana, msg);
  assert.match(noPuede.respuesta, /solo para la administración/);
  assert.equal(entrega.estadoEntrega(marta.id).entregado, false);
  // líneas dudosas: no guarda nada
  const mal = await pedir(admin, `Cargar horario de ${marta.nombre}:\nLunes 07:30-09:00 liceo`);
  assert.match(mal.respuesta, /No guardé nada/);
  assert.equal(entrega.estadoEntrega(marta.id).entregado, false);
  // profesor inexistente
  assert.match((await pedir(admin, 'Cargar horario de Zacarías Nadie:\nLunes 07:30-09:00 3°MA liceo')).respuesta, /No encontré/);
  // caso feliz
  const ok = await pedir(admin, msg);
  assert.match(ok.respuesta, /Cargué el horario de \*\*Marta Silva\*\*/);
  assert.equal(entrega.estadoEntrega(marta.id).entregado, true);
  assert.equal(entrega.entregadas(marta.id).length, 2);
});
