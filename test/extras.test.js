// Historial de cambios, vista/consulta por salón y reemplazos ordenados por carga y faltas.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cuadrilla-extra-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.BACKUP_DIR = path.join(tmp, 'backups');
process.env.LIMITE_FALTAS = '10';

const db = require('../db/database');
const lib = require('../lib/horariosLib');
const historial = require('../lib/historialLib');
const cambios = require('../lib/cambiosLib');
const { responder, detectarIntencion } = require('../lib/chatbot');

const usuario = (nombre, rol) => {
  const id = Number(db.prepare('INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES (?, ?, ?, ?)').run(nombre, nombre.replace(/\W/g, '') + '@t.com', 'h', rol).lastInsertRowid);
  if (rol === 'profesor') db.prepare('INSERT INTO entregas_horario (profesor_id, cantidad) VALUES (?, 0)').run(id);   // ya entregó su horario semanal (obligatorio)
  return { id, nombre, rol };
};
const clase = (dia, ini, fin, materia, salon, p) => Number(db.prepare(
  `INSERT INTO horarios (dia, hora_inicio, hora_fin, materia, salon, estado, profesor_id, profesor_nombre) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
).run(dia, ini, fin, materia, salon, p ? 'ocupado' : 'disponible', p ? p.id : null, p ? p.nombre : null).lastInsertRowid);
const falta = (p, n, admin) => { for (let i = 0; i < n; i++) db.prepare('INSERT INTO ausencias (profesor_id, profesor_nombre, motivo, registrado_por) VALUES (?, ?, ?, ?)').run(p.id, p.nombre, 'x', admin.id); };
const pedir = (u, mensaje) => responder({ usuario: u, mensaje, historial: [] });

db.setConfig('horario_publicado', '1');
const admin = usuario('Admin', 'admin');

/* ------------------------------- historial ------------------------------- */
test('historial: registra, filtra por texto/acción y devuelve lo más nuevo primero', () => {
  historial.registrar(admin, 'crear', 'Creó Matemática (Lunes 08:00–09:00)');
  historial.registrar(admin, 'borrar', 'Eliminó Física (Martes 10:00–11:00)');
  historial.registrar(null, 'publicar', 'Publicó el horario');
  const todo = historial.listar();
  assert.equal(todo[0].accion, 'publicar');
  assert.equal(todo[0].usuario_nombre, 'Sistema');
  assert.deepEqual(historial.listar({ accion: 'borrar' }).map(h => h.detalle), ['Eliminó Física (Martes 10:00–11:00)']);
  assert.equal(historial.listar({ texto: 'matemática' }).length, 1);
  assert.equal(historial.listar({ texto: 'admin' }).length, 2, 'busca también por persona');
  assert.equal(historial.listar({ texto: '100%' }).length, 0, 'los comodines se escapan');
  assert.equal(historial.listar({ accion: 'no-existe' }).length, 3, 'una acción inválida se ignora');
});

test('historial: describe qué cambió en una edición', () => {
  const antes = { materia: 'Arte', dia: 'Lunes', hora_inicio: '08:00', hora_fin: '09:00', salon: 'A1', profesor_nombre: 'Ana', color: null };
  assert.equal(historial.resumenEdicion(antes, { ...antes }), null, 'sin cambios no hay registro');
  const r = historial.resumenEdicion(antes, { ...antes, hora_inicio: '10:00', hora_fin: '11:00', salon: 'B2', profesor_nombre: 'Luis', color: 'azul' });
  assert.match(r, /horario Lunes 08:00–09:00 → Lunes 10:00–11:00/);
  assert.match(r, /salón A1 → B2/);
  assert.match(r, /profesor Ana → Luis/);
  assert.match(r, /lugar sin especificar → UTU/);
});

test('historial: aprobar y rechazar intercambios queda registrado con quién lo decidió', () => {
  const p1 = usuario('Uno Perez', 'profesor'), p2 = usuario('Dos Gomez', 'profesor');
  const h1 = clase('Martes', '08:00', '09:00', 'Bio', 'S1', p1), h2 = clase('Miercoles', '10:00', '11:00', 'Geo', 'S2', p2);
  const sol = (p, h, pareja) => Number(db.prepare("INSERT INTO solicitudes_cambio (profesor_id, profesor_nombre, horario_actual_id, motivo, estado, pareja_id) VALUES (?, ?, ?, 'x', 'emparejado', ?)").run(p.id, p.nombre, h, pareja).lastInsertRowid);
  const a = sol(p1, h1, null), b = sol(p2, h2, a);
  db.prepare('UPDATE solicitudes_cambio SET pareja_id = ? WHERE id = ?').run(b, a);
  cambios.aprobar(a, admin);
  const reg = historial.listar({ accion: 'intercambio' })[0];
  assert.equal(reg.usuario_nombre, 'Admin');
  assert.match(reg.detalle, /Aprobó el intercambio Uno Perez/);
});

/* --------------------------------- salones --------------------------------- */
const ana = usuario('Ana Salon', 'profesor');
clase('Lunes', '08:00', '09:30', 'Matemática', 'Aula 101', ana);
clase('Lunes', '10:00', '11:00', 'Arte', 'aula 101', null);      // mismo salón escrito distinto
clase('Lunes', '08:00', '09:00', 'Química', 'Laboratorio 1', null);

test('salones: lista sin repetir y calcula libres/ocupados a una hora', () => {
  assert.deepEqual(lib.listaSalones().filter(s => /aula 101|laboratorio/i.test(s)), ['Aula 101', 'Laboratorio 1']);
  assert.equal(lib.clasesDeSalon('AULA 101').length, 2);
  const a = lib.estadoSalones('Lunes', '08:30');
  assert.equal(a.find(s => s.salon === 'Aula 101').libre, false);
  assert.equal(a.find(s => s.salon === 'Aula 101').clase.profesor_nombre, 'Ana Salon');
  const b = lib.estadoSalones('Lunes', '09:30');   // la clase termina a las 9:30: ya está libre
  assert.equal(b.find(s => s.salon === 'Aula 101').libre, true);
  assert.equal(b.find(s => s.salon === 'Laboratorio 1').libre, true);
});

test('chatbot: salones libres y ocupados, o el estado de un salón puntual', async () => {
  assert.equal(detectarIntencion('¿qué salones están libres el lunes a las 9?'), 'salones_libres');
  assert.equal(detectarIntencion('qué clases libres hay'), 'disponibilidad', 'no se confunde con las clases libres');
  const r = await pedir(admin, '¿qué salones están libres el lunes a las 8:30?');
  assert.match(r.respuesta, /Libres \(\d+\)/);
  assert.match(r.respuesta, /Aula 101: Matemática \(Ana Salon\)/);
  assert.match((await pedir(admin, 'está libre el aula 101 el lunes a las 10:30?')).respuesta, /ocupado.*Arte/);
  assert.match((await pedir(admin, 'está libre el aula 101 el lunes a las 12?')).respuesta, /libre el Lunes a las 12:00/);
  assert.match((await pedir(admin, 'salones libres el lunes')).respuesta, /a qué hora/);
  db.setConfig('horario_publicado', '0');
  assert.match((await pedir(ana, 'salones libres el lunes a las 9')).respuesta, /Salones el Lunes a las 09:00/, 'el profesor no espera la publicación');
  db.setConfig('horario_publicado', '1');
});

/* ------------------------- reemplazos ordenados ------------------------- */
test('reemplazos: primero quien tiene menos horas; al final quienes están cerca del límite de faltas', async () => {
  const falta1 = usuario('Zoe Ausente', 'profesor');           // la que no viene
  const liviana = usuario('Carla Liviana', 'profesor');        // 1 h semanal
  const media = usuario('Bruno Medio', 'profesor');            // 6 h semanales
  const cargada = usuario('Alma Cargada', 'profesor');         // 12 h semanales
  const riesgo = usuario('Dario Riesgo', 'profesor');          // 0 h, pero 9 faltas de 10 (cerca del límite)
  const negra = usuario('Elsa Negra', 'profesor');             // 0 h y 10 faltas (lista negra)
  clase('Jueves', '08:00', '09:00', 'Reemplazar', 'R1', falta1);
  clase('Viernes', '08:00', '09:00', 'Poca', 'R2', liviana);
  for (const d of ['Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado']) clase(d, '14:00', '15:00', 'Media', 'R3', media);
  for (const d of ['Lunes', 'Martes', 'Miercoles', 'Viernes']) { clase(d, '16:00', '19:00', 'Mucha', 'R4', cargada); }
  falta(riesgo, 9, admin); falta(negra, 10, admin);
  // Los profesores de las pruebas anteriores quedan ocupados el jueves a las 8 para que la lista (máx. 6 nombres) sea solo de este caso
  for (const u of db.prepare("SELECT id, nombre FROM usuarios WHERE rol = 'profesor' AND nombre IN ('Uno Perez', 'Dos Gomez', 'Ana Salon')").all()) clase('Jueves', '08:00', '09:00', 'Ocupado', 'O' + u.id, u);

  const r = await pedir(falta1, 'no puedo dar clase el jueves');
  const orden = ['Carla Liviana', 'Bruno Medio', 'Alma Cargada', 'Dario Riesgo', 'Elsa Negra'].map(n => r.respuesta.indexOf(n));
  assert.ok(orden.every(i => i >= 0), JSON.stringify(orden) + '\n' + r.respuesta);
  assert.deepEqual([...orden].sort((a, b) => a - b), orden, 'orden esperado');
  assert.match(r.respuesta, /⭐ Carla Liviana \(1 h\)/);
  assert.match(r.respuesta, /Alma Cargada \(12 h\)/);
  assert.match(r.respuesta, /Dario Riesgo \(0 h, ⚠️ 9 faltas\)/);
  assert.match(r.respuesta, /Elsa Negra \(0 h, 🚫 lista negra\)/);
  // Dario tiene menos horas que Alma pero igual va después por las faltas, y no lleva ⭐
  assert.doesNotMatch(r.respuesta, /⭐ Dario/);
});
