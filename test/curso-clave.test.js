// Curso obligatorio en cada clase, contraseña PROFE-2026 de los profesores y "mi horario" del asistente.
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');

process.env.DB_PATH = path.join(os.tmpdir(), `cuadrilla-curso-${Date.now()}.db`);
process.env.BACKUP_DIR = path.join(os.tmpdir(), `cuadrilla-curso-bk-${Date.now()}`);
delete process.env.PROFE_PASSWORD_INICIAL;

const db = require('../db/database');
const { crearCuentasProfesores } = require('../lib/cuentasProfesores');
const { cargarHorarioSilvio } = require('../lib/horarioSilvio');
const { responder } = require('../lib/chatbot');

let servidor, base;
async function pedir(ruta, { method = 'GET', body, cookie } = {}) {
  const r = await fetch(base + ruta, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})), cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
}

test.before(async () => {
  crearCuentasProfesores();
  cargarHorarioSilvio();
  const app = require('../server');
  servidor = app.listen(0);
  await new Promise(r => servidor.once('listening', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});
test.after(() => servidor.close());

test('los 18 profesores entran con PROFE-2026 y los que ya existían también', async () => {
  const r = await pedir('/api/auth/login', { method: 'POST', body: { email: 'silvio.fagundez@gmail.com', password: 'PROFE-2026' } });
  assert.equal(r.status, 200);
  assert.equal((await pedir('/api/auth/login', { method: 'POST', body: { email: 'silvio.fagundez@gmail.com', password: 'profe123' } })).status, 401);
  // cuenta preexistente con otra clave: se pasa a PROFE-2026 una sola vez
  db.prepare("UPDATE usuarios SET password_hash = 'x' WHERE email = 'mauro.ipar@gmail.com'").run();
  db.setConfig('clave_profes_inicial_v2', '0');
  crearCuentasProfesores();
  assert.equal((await pedir('/api/auth/login', { method: 'POST', body: { email: 'mauro.ipar@gmail.com', password: 'PROFE-2026' } })).status, 200);
});

test('migración: una cuenta vieja @cuadrilla.com pasa a @gmail.com con la contraseña inicial', async () => {
  db.prepare("UPDATE usuarios SET email = 'mauro.ipar@cuadrilla.com', password_hash = 'x' WHERE email = 'mauro.ipar@gmail.com'").run();
  db.setConfig('clave_profes_inicial_v2', '0');
  crearCuentasProfesores();
  assert.ok(!db.prepare("SELECT id FROM usuarios WHERE email = 'mauro.ipar@cuadrilla.com'").get());
  assert.equal((await pedir('/api/auth/login', { method: 'POST', body: { email: 'mauro.ipar@gmail.com', password: 'PROFE-2026' } })).status, 200);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM usuarios WHERE rol = 'profesor' AND email LIKE '%@gmail.com'").get().n >= 18, true);
});

test('el admin no puede crear una clase sin curso, y el curso se guarda y se edita', async () => {
  const a = await pedir('/api/auth/register', { method: 'POST', body: { nombre: 'Admin', email: 'admin@t.com', password: 'secreto1', rol: 'admin', codigo: 'ADMIN-2026' } });
  const cookie = a.cookie;
  const base_ = { dia: 'Jueves', hora_inicio: '08:00', hora_fin: '09:00', materia: 'Física', salon: 'Aula 1' };
  const sin = await pedir('/api/horarios', { method: 'POST', cookie, body: base_ });
  assert.equal(sin.status, 400);
  assert.match(sin.data.error, /curso/i);
  const ok = await pedir('/api/horarios', { method: 'POST', cookie, body: { ...base_, curso: ' 9°1 ' } });
  assert.equal(ok.status, 201);
  assert.equal(ok.data.horario.curso, '9°1');
  const ed = await pedir(`/api/horarios/${ok.data.horario.id}`, { method: 'PUT', cookie, body: { curso: '9°2' } });
  assert.equal(ed.data.horario.curso, '9°2');
  assert.equal((await pedir(`/api/horarios/${ok.data.horario.id}`, { method: 'PUT', cookie, body: { curso: '  ' } })).status, 400);
});

test('las clases cargadas de Silvio ya traen su curso', () => {
  const n = db.prepare("SELECT COUNT(*) AS n FROM horarios WHERE origen = 'carga-silvio' AND curso = '7°3'").get().n;
  assert.ok(n >= 1);
});

test('"mi horario" responde con la tabla en el chat y la ayuda ya no menciona a Silvio', async () => {
  db.setConfig('horario_publicado', '1');
  const silvio = db.prepare("SELECT id, nombre, email, rol FROM usuarios WHERE email = 'silvio.fagundez@gmail.com'").get();
  for (const q of ['mi horario', 'quiero ver mi horario personal']) {
    const r = await responder({ mensaje: q, usuario: silvio, historial: [] });
    assert.match(r.respuesta, /Tu horario semanal/, q);
    assert.match(r.respuesta, /\| Día \|/, q);
  }
  const ayuda = await responder({ mensaje: 'ayuda', usuario: silvio, historial: [] });
  assert.doesNotMatch(ayuda.respuesta, /d[oó]nde est[aá]/i);
});

test('cambiar contraseña: pide la actual, valida la nueva y el admin puede restablecerla', async () => {
  const login = (email, password) => pedir('/api/auth/login', { method: 'POST', body: { email, password } });
  const prof = await login('ana.mensinguer@gmail.com', 'PROFE-2026');
  assert.equal(prof.status, 200);
  const cambiar = (actual, nueva) => pedir('/api/auth/password', { method: 'POST', cookie: prof.cookie, body: { actual, nueva } });
  assert.equal((await pedir('/api/auth/password', { method: 'POST', body: { actual: 'a', nueva: 'bbbbbbbb' } })).status, 401, 'sin sesión no');
  assert.equal((await cambiar('PROFE-2026', 'corta')).status, 400);
  assert.equal((await cambiar('PROFE-2026', 'PROFE-2026')).status, 400);
  assert.equal((await cambiar('equivocada', 'NuevaClave-77')).status, 401);
  assert.equal((await cambiar('PROFE-2026', 'NuevaClave-77')).status, 200);
  assert.equal((await login('ana.mensinguer@gmail.com', 'PROFE-2026')).status, 401);
  assert.equal((await login('ana.mensinguer@gmail.com', 'NuevaClave-77')).status, 200);

  // restablecer: solo admin, y solo cuentas de profesores
  const adm = await login('admin@t.com', 'secreto1');
  const id = db.prepare("SELECT id FROM usuarios WHERE email = 'ana.mensinguer@gmail.com'").get().id;
  assert.equal((await pedir('/api/auth/restablecer', { method: 'POST', cookie: prof.cookie, body: { usuario_id: id } })).status, 403);
  assert.equal((await pedir('/api/auth/restablecer', { method: 'POST', cookie: adm.cookie, body: { usuario_id: adm.data.user.id } })).status, 404);
  const r = await pedir('/api/auth/restablecer', { method: 'POST', cookie: adm.cookie, body: { usuario_id: id } });
  assert.equal(r.status, 200);
  assert.equal((await login('ana.mensinguer@gmail.com', 'PROFE-2026')).status, 200);
});

test('Excel: el admin descarga todo, un curso o un profesor; el profesor solo el suyo', async () => {
  const bajar = async (ruta, cookie) => {
    const r = await fetch(base + ruta, { headers: cookie ? { cookie } : {} });
    return { status: r.status, tipo: r.headers.get('content-type'), disp: r.headers.get('content-disposition'), buf: Buffer.from(await r.arrayBuffer()) };
  };
  const login = (email, password) => pedir('/api/auth/login', { method: 'POST', body: { email, password } });
  const adm = (await login('admin@t.com', 'secreto1')).cookie;
  const esXlsx = (x) => x.status === 200 && /spreadsheetml/.test(x.tipo) && x.buf.subarray(0, 2).toString() === 'PK';

  assert.ok(esXlsx(await bajar('/api/exportar/excel?alcance=todo', adm)));
  const curso = await bajar('/api/exportar/excel?alcance=curso&curso=' + encodeURIComponent('7°3'), adm);
  assert.ok(esXlsx(curso));
  assert.match(curso.disp, /horario-curso-7-3\.xlsx/);
  assert.equal((await bajar('/api/exportar/excel?alcance=curso&curso=' + encodeURIComponent('9°9'), adm)).status, 404);
  const silvioId = db.prepare("SELECT id FROM usuarios WHERE email = 'silvio.fagundez@gmail.com'").get().id;
  assert.ok(esXlsx(await bajar(`/api/exportar/excel?alcance=profesor&id=${silvioId}`, adm)));

  assert.equal((await bajar('/api/exportar/excel?alcance=todo')).status, 401);
  const silvio = (await login('silvio.fagundez@gmail.com', 'PROFE-2026')).cookie;
  db.setConfig('horario_publicado', '0');
  assert.ok(esXlsx(await bajar('/api/exportar/excel?alcance=mio', silvio)), 'el profesor baja su horario sin esperar la publicación');
  db.setConfig('horario_publicado', '1');
  assert.ok(esXlsx(await bajar('/api/exportar/excel?alcance=mio', silvio)));
  assert.equal((await bajar('/api/exportar/excel?alcance=todo', silvio)).status, 403, 'un profesor no baja el horario completo');

  // Alumno: baja el horario general o el de un curso, pero solo cuando está publicado; nada de profesores individuales.
  const alu = (await pedir('/api/auth/register', { method: 'POST', body: { nombre: 'Alu Descarga', email: 'alu-descarga@t.com', password: 'secreto1', rol: 'alumno' } })).cookie;
  assert.ok(esXlsx(await bajar('/api/exportar/excel?alcance=todo', alu)));
  const cursoAlu = await bajar('/api/exportar/excel?alcance=curso&curso=' + encodeURIComponent('7°3'), alu);
  assert.ok(esXlsx(cursoAlu));
  assert.match(cursoAlu.disp, /horario-curso-7-3\.xlsx/);
  assert.equal((await bajar('/api/exportar/excel?alcance=mio', alu)).status, 403);
  assert.equal((await bajar(`/api/exportar/excel?alcance=profesor&id=${silvioId}`, alu)).status, 403);
  db.setConfig('horario_publicado', '0');
  assert.equal((await bajar('/api/exportar/excel?alcance=todo', alu)).status, 403, 'sin publicar el alumno no descarga');
  db.setConfig('horario_publicado', '1');
});
