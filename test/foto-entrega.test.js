// La foto del horario llega al admin ("Por profesor") y el profesor queda desbloqueado.
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');

process.env.DB_PATH = path.join(os.tmpdir(), `cuadrilla-foto-${Date.now()}.db`);
process.env.BACKUP_DIR = path.join(os.tmpdir(), `cuadrilla-foto-backups-${Date.now()}`);
delete process.env.GEMINI_API_KEY; delete process.env.GOOGLE_API_KEY;

// PNG de 1x1: suficiente para validar el formato.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
let servidor, base;
async function pedir(ruta, { method = 'GET', body, cookie } = {}) {
  const r = await fetch(base + ruta, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const ct = r.headers.get('content-type') || '';
  const data = ct.includes('json') ? await r.json().catch(() => ({})) : Buffer.from(await r.arrayBuffer());
  return { status: r.status, data, ct, cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
}
const registrar = (nombre, email, rol, codigo) => pedir('/api/auth/register', { method: 'POST', body: { nombre, email, password: 'secreto1', rol, codigo } });

test.before(async () => {
  const app = require('../server');
  servidor = app.listen(0);
  await new Promise(r => servidor.once('listening', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});
test.after(() => servidor.close());

test('sin IA: la foto se guarda, el admin la ve en Por profesor y el profesor queda desbloqueado', async () => {
  const admin = await registrar('Admin Foto', 'adminfoto@t.com', 'admin', process.env.ADMIN_CODE || 'ADMIN-2026');
  const ana = await registrar('Ana Foto', 'anafoto@t.com', 'profesor', process.env.PROFE_CODE || 'PROFE-2026');
  const luis = await registrar('Luis Foto', 'luisfoto@t.com', 'profesor', process.env.PROFE_CODE || 'PROFE-2026');
  const alumno = await registrar('Alu', 'alufoto@t.com', 'alumno');
  assert.equal(admin.status, 201); assert.equal(ana.status, 201);
  const A = admin.cookie, P = ana.cookie, L = luis.cookie;

  assert.equal((await pedir('/api/horarios/entrega', { cookie: P })).data.entregado, false);
  assert.equal((await pedir('/api/chatbot/foto', { method: 'POST', cookie: alumno.cookie, body: { imagen: PNG } })).status, 403);
  assert.equal((await pedir('/api/chatbot/foto', { method: 'POST', cookie: P, body: { imagen: 'data:text/html;base64,AAAA' } })).status, 400);

  const r = await pedir('/api/chatbot/foto', { method: 'POST', cookie: P, body: { imagen: PNG } });
  assert.equal(r.status, 200);
  assert.equal(r.data.estado, 'foto_recibida');
  assert.equal(r.data.con_ia, false);

  const e = (await pedir('/api/horarios/entrega', { cookie: P })).data;
  assert.equal(e.entregado, true, 'el profesor queda desbloqueado');
  assert.equal(e.con_foto, true);

  const resumen = (await pedir('/api/horarios/entrega', { cookie: A })).data.profesores.find(p => p.nombre === 'Ana Foto');
  assert.equal(resumen.entregado, true); assert.equal(resumen.con_foto, true); assert.equal(resumen.cantidad, 0);

  const msgs = (await pedir('/api/mensajes', { cookie: A })).data;
  assert.match(JSON.stringify(msgs), /foto de su horario/);

  const img = await pedir(`/api/horarios/entrega/foto/${resumen.id}`, { cookie: A });
  assert.equal(img.status, 200); assert.equal(img.ct, 'image/png');
  assert.equal((await pedir(`/api/horarios/entrega/foto/${resumen.id}`, { cookie: P })).status, 200);       // la propia
  assert.equal((await pedir(`/api/horarios/entrega/foto/${resumen.id}`, { cookie: L })).status, 403);       // la de otro, no

  // El admin sube la foto en nombre de un profesor.
  assert.equal((await pedir('/api/chatbot/foto', { method: 'POST', cookie: A, body: { imagen: PNG } })).status, 400);
  const porLuis = await pedir('/api/chatbot/foto', { method: 'POST', cookie: A, body: { imagen: PNG, profesor: 'Luis Foto' } });
  assert.equal(porLuis.status, 200);
  assert.equal((await pedir('/api/horarios/entrega', { cookie: L })).data.entregado, true);
});

test('con IA y lectura limpia: se pasa a clases solas; con líneas dudosas queda la foto y el texto para revisar', async () => {
  process.env.GEMINI_API_KEY = 'falsa';
  let respuesta = '';
  require.cache[require.resolve('@google/genai')] = { id: 'x', filename: 'x', loaded: true, exports: { GoogleGenAI: class { constructor() { this.models = { generateContent: async () => ({ text: respuesta }) }; } } } };
  const reg = await registrar('Rosa Foto', 'rosafoto@t.com', 'profesor', process.env.PROFE_CODE || 'PROFE-2026');
  const adm = await pedir('/api/auth/login', { method: 'POST', body: { email: 'adminfoto@t.com', password: 'secreto1' } });

  respuesta = 'Lunes 07:30-09:00 3°MA liceo\nMartes 09:05-10:35 3°DF utu';
  const ok = await pedir('/api/chatbot/foto', { method: 'POST', cookie: reg.cookie, body: { imagen: PNG } });
  assert.equal(ok.data.estado, 'entregado'); assert.equal(ok.data.total, 2); assert.equal(ok.data.con_ia, true);
  const e = (await pedir('/api/horarios/entrega', { cookie: adm.cookie })).data.profesores.find(p => p.nombre === 'Rosa Foto');
  assert.equal(e.cantidad, 2); assert.equal(e.con_foto, true);
  assert.equal((await pedir('/api/horarios/mios', { cookie: reg.cookie })).data.horarios.length, 2);

  const otra = await registrar('Sara Foto', 'sarafoto@t.com', 'profesor', process.env.PROFE_CODE || 'PROFE-2026');
  respuesta = 'Lunes 07:30-09:00 3°MA liceo ?\nMartes 09:05-10:35 3°DF utu';
  const dudosa = await pedir('/api/chatbot/foto', { method: 'POST', cookie: otra.cookie, body: { imagen: PNG } });
  assert.equal(dudosa.data.estado, 'foto_recibida');
  assert.match(dudosa.data.texto, /3°MA/);
  assert.equal((await pedir('/api/horarios/entrega', { cookie: otra.cookie })).data.entregado, true);
  delete process.env.GEMINI_API_KEY;
});
