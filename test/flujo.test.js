// Prueba de punta a punta: roles, publicación, conflictos e importación desde un "Figma" simulado.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

process.env.DB_PATH = path.join(os.tmpdir(), `cuadrilla-test-${Date.now()}.db`);
process.env.BACKUP_DIR = path.join(os.tmpdir(), `cuadrilla-test-backups-${Date.now()}`);
process.env.FIGMA_TOKEN = 'token-de-prueba';

const texto = (characters) => ({ type: 'TEXT', characters });
const tarjeta = (...lineas) => ({ type: 'FRAME', name: 'Clase', children: lineas.map(texto) });
const dia = (name, ...tarjetas) => ({ type: 'FRAME', name, children: tarjetas });
const archivoFigma = {
  name: 'Horario 2026',
  document: { type: 'DOCUMENT', children: [{ type: 'CANVAS', name: 'Página 1', children: [
    dia('Lunes',
      tarjeta('Matemáticas', '08:00 - 09:30', 'Aula 101', 'Prof. Ana Pérez'),
      tarjeta('Dramatización', '09:45 - 11:15', 'Aula 5', 'Marta Nueva')),
    dia('Martes',
      tarjeta('Historia', '08:00 - 09:30', 'Aula 202', 'Carlos Gómez'),
      tarjeta('Física', '08:30 - 10:00', 'Aula 101')),           // pisa el salón de Matemáticas? no, es otro día
    dia('Lunes - tarde',
      { type: 'TEXT', characters: 'Química\n14:00 - 15:30\nLaboratorio 1\nProf. Ana Pérez' })
  ] }] }
};

let servidor, base, figma, figmaPeticiones = [];

async function pedir(ruta, { method = 'GET', body, cookie } = {}) {
  const r = await fetch(base + ruta, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await r.json().catch(() => ({}));
  return { status: r.status, data, cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
}
const registrar = (nombre, email, rol, codigo) =>
  pedir('/api/auth/register', { method: 'POST', body: { nombre, email, password: 'secreto1', rol, codigo } });

test.before(async () => {
  figma = http.createServer((req, res) => {
    figmaPeticiones.push({ url: req.url, token: req.headers['x-figma-token'] });
    if (!req.url.startsWith('/v1/files/ABC123')) { res.writeHead(404); return res.end('{}'); }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    // /nodes devuelve { nodes: { "0:1": { document } } }; el archivo completo devuelve { document }
    res.end(JSON.stringify(req.url.includes('/nodes')
      ? { name: archivoFigma.name, nodes: { '0:1': { document: archivoFigma.document } } }
      : archivoFigma));
  });
  await new Promise(r => figma.listen(0, r));
  process.env.FIGMA_API_BASE = `http://127.0.0.1:${figma.address().port}`;

  const app = require('../server');
  servidor = app.listen(0);
  await new Promise(r => servidor.once('listening', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});
test.after(() => { servidor.close(); figma.close(); });

let admin, ana, alumno;

test('registro exige la clave para profesor y admin', async () => {
  assert.equal((await registrar('X', 'x@a.com', 'admin', 'mala')).status, 403);
  assert.equal((await registrar('X', 'x@a.com', 'profesor', undefined)).status, 403);
  admin = await registrar('Admin', 'admin@a.com', 'admin', 'ADMIN-2026');
  ana = await registrar('Ana Pérez', 'ana@a.com', 'profesor', 'PROFE-2026');
  alumno = await registrar('Alu', 'alu@a.com', 'alumno');
  for (const u of [admin, ana, alumno]) assert.equal(u.status, 201);
});

test('el admin crea clases, asigna profesor y detecta choques', async () => {
  const { data: { profesores } } = await pedir('/api/horarios/profesores', { cookie: admin.cookie });
  const conCuenta = profesores.filter(p => p.cuenta);
  assert.equal(conCuenta.length, 1);
  assert.ok(profesores.length > 10, 'el selector incluye a los profesores de la plantilla sin cuenta');
  const anaId = conCuenta[0].id;

  const nueva = await pedir('/api/horarios', { method: 'POST', cookie: admin.cookie,
    body: { curso: '7°1', dia: 'Miércoles', hora_inicio: '10:00', hora_fin: '11:30', materia: 'Arte', salon: 'Taller 1', profesor_id: anaId } });
  assert.equal(nueva.status, 201);
  assert.equal(nueva.data.horario.profesor_nombre, 'Ana Pérez');

  // Mismo profesor, horas que se pisan
  const choque = await pedir('/api/horarios', { method: 'POST', cookie: admin.cookie,
    body: { curso: '7°1', dia: 'Miércoles', hora_inicio: '11:00', hora_fin: '12:00', materia: 'Otra', salon: 'Aula 9', profesor_id: anaId } });
  assert.equal(choque.status, 409);
  // Horas inválidas
  const mala = await pedir('/api/horarios', { method: 'POST', cookie: admin.cookie,
    body: { curso: '7°1', dia: 'Lunes', hora_inicio: '12:00', hora_fin: '11:00', materia: 'X' } });
  assert.equal(mala.status, 400);
  // Un alumno no puede crear
  assert.equal((await pedir('/api/horarios', { method: 'POST', cookie: alumno.cookie,
    body: { dia: 'Lunes', hora_inicio: '08:00', hora_fin: '09:00', materia: 'X' } })).status, 403);
});

test('el alumno solo ve el horario cuando se publica', async () => {
  let r = await pedir('/api/horarios', { cookie: alumno.cookie });
  assert.equal(r.data.publicado, false);
  assert.equal(r.data.horarios.length, 0);

  assert.equal((await pedir('/api/horarios/publicar', { method: 'POST', cookie: alumno.cookie, body: { curso: '7°1', publicado: true } })).status, 403);
  assert.equal((await pedir('/api/horarios/publicar', { method: 'POST', cookie: admin.cookie, body: { curso: '7°1', publicado: true } })).status, 200);

  r = await pedir('/api/horarios', { cookie: alumno.cookie });
  assert.equal(r.data.publicado, true);
  assert.equal(r.data.horarios.length, 1);

  await pedir('/api/horarios/publicar', { method: 'POST', cookie: admin.cookie, body: { curso: '7°1', publicado: false } });
  r = await pedir('/api/horarios', { cookie: alumno.cookie });
  assert.equal(r.data.horarios.length, 0);
});

test('el profesor ve su propio horario en /mios sin esperar a que el admin publique', async () => {
  let borrador = await pedir('/api/horarios/mios', { cookie: ana.cookie });
  assert.deepEqual(borrador.data.horarios.map(h => h.materia), ['Arte'], 'en borrador el profesor ve sus clases igual');
  assert.deepEqual((await pedir('/api/horarios', { cookie: ana.cookie })).data.horarios.map(h => h.materia), ['Arte'], 'y solo las suyas');
  assert.ok((await pedir('/api/horarios', { cookie: admin.cookie })).data.horarios.length > 0, 'el admin sí ve el borrador');

  const pub = await pedir('/api/horarios/publicar', { method: 'POST', cookie: admin.cookie, body: { curso: '7°1', publicado: true } });
  assert.equal(pub.status, 200);
  assert.ok(pub.data.profesores_avisados >= 1);
  const aviso = await pedir('/api/mensajes', { cookie: ana.cookie });
  assert.match(JSON.stringify(aviso.data), /Se publicó el horario/);

  const r = await pedir('/api/horarios/mios', { cookie: ana.cookie });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.horarios.map(h => h.materia), ['Arte']);
  assert.equal((await pedir('/api/horarios/mios', { cookie: alumno.cookie })).status, 403);
});

test('el admin ve el horario de cualquier profesor', async () => {
  const { data: { profesores } } = await pedir('/api/horarios/profesores', { cookie: admin.cookie });
  const anaId = profesores.find(p => p.cuenta).id;
  const r = await pedir(`/api/horarios/profesor?id=${anaId}`, { cookie: admin.cookie });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.horarios.map(h => h.materia), ['Arte']);
  assert.equal((await pedir(`/api/horarios/profesor?id=${anaId}`, { cookie: ana.cookie })).status, 403);
  assert.equal((await pedir('/api/horarios/profesor?nombre=Nadie', { cookie: admin.cookie })).status, 400);
});

test('Figma: solo admin, valida el enlace y exige token', async () => {
  assert.equal((await pedir('/api/figma/config', { cookie: alumno.cookie })).status, 403);
  const malaUrl = await pedir('/api/figma/preview', { method: 'POST', cookie: admin.cookie, body: { url: 'https://ejemplo.com/x' } });
  assert.equal(malaUrl.status, 400);
});

test('Figma: vista previa interpreta días, tarjetas y profesores', async () => {
  const r = await pedir('/api/figma/preview', { method: 'POST', cookie: admin.cookie,
    body: { url: 'https://www.figma.com/design/ABC123/Horario?node-id=0-1' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(figmaPeticiones.at(-1).token, 'token-de-prueba');
  assert.match(figmaPeticiones.at(-1).url, /\/v1\/files\/ABC123\/nodes\?ids=0%3A1/);
});

test('Figma: importa, vincula al profesor registrado y respeta lo manual', async () => {
  // Sin node-id: se pide el archivo completo
  const r = await pedir('/api/figma/importar', { method: 'POST', cookie: admin.cookie,
    body: { url: 'https://www.figma.com/design/ABC123/Horario', modo: 'reemplazar' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.match(figmaPeticiones.at(-1).url, /^\/v1\/files\/ABC123$/);
  // Matemáticas, Dramatización, Historia, Física, Química -> Química (Ana, 14:00) no choca; todas entran
  assert.equal(r.data.importados, 5, JSON.stringify(r.data));

  const { data } = await pedir('/api/horarios', { cookie: admin.cookie });
  const porMateria = Object.fromEntries(data.horarios.map(h => [h.materia, h]));
  assert.equal(porMateria['Matemáticas'].profesor_nombre, 'Ana Pérez');
  assert.ok(porMateria['Matemáticas'].profesor_id, 'Matemáticas queda asignada a la cuenta de Ana');
  assert.equal(porMateria['Dramatización'].profesor_nombre, 'Marta Nueva', '"Dramatización" no se confunde con "Dra."');
  assert.equal(porMateria['Dramatización'].profesor_id, null);
  assert.equal(porMateria['Química'].salon, 'Laboratorio 1');
  assert.equal(porMateria['Química'].dia, 'Lunes');
  assert.ok(porMateria['Arte'], 'la clase creada a mano se conserva');

  // Reimportar en modo reemplazar no duplica
  await pedir('/api/figma/importar', { method: 'POST', cookie: admin.cookie, body: { url: 'https://www.figma.com/design/ABC123/Horario' } });
  const otra = await pedir('/api/horarios', { cookie: admin.cookie });
  assert.equal(otra.data.horarios.filter(h => h.materia === 'Matemáticas').length, 1);
});

test('una profesora que se registra después recibe sus clases importadas', async () => {
  const marta = await registrar('Marta Nueva', 'marta@a.com', 'profesor', 'PROFE-2026');
  const r = await pedir('/api/horarios/mios', { cookie: marta.cookie });
  assert.deepEqual(r.data.horarios.map(h => h.materia), ['Dramatización']);
});

test('Figma: errores del servicio llegan como mensaje claro', async () => {
  const r = await pedir('/api/figma/preview', { method: 'POST', cookie: admin.cookie,
    body: { url: 'https://www.figma.com/design/NOEXISTE/x' } });
  assert.equal(r.status, 502);
  assert.match(r.data.error, /No se encontró/);
});

test('backup: exclusivo del administrador', async () => {
  assert.equal((await pedir('/api/backup')).status, 401);
  assert.equal((await pedir('/api/backup', { cookie: alumno.cookie })).status, 403);
  assert.equal((await pedir('/api/backup', { cookie: ana.cookie })).status, 403);
  assert.equal((await pedir('/api/backup', { method: 'POST', cookie: ana.cookie })).status, 403);

  const creado = await pedir('/api/backup', { method: 'POST', cookie: admin.cookie });
  assert.equal(creado.status, 201, JSON.stringify(creado.data));
  const nombre = creado.data.backup.nombre;

  assert.equal((await pedir(`/api/backup/${nombre}/descargar`, { cookie: ana.cookie })).status, 403);
  const bajado = await fetch(`${base}/api/backup/${nombre}/descargar`, { headers: { cookie: admin.cookie } });
  assert.equal(bajado.status, 200);
  assert.equal(Buffer.from(await bajado.arrayBuffer()).subarray(0, 15).toString(), 'SQLite format 3');

  assert.equal((await pedir('/api/backup/..%2F..%2Fetc%2Fpasswd/descargar', { cookie: admin.cookie })).status, 400);
  assert.equal((await pedir(`/api/backup/${nombre}/restaurar`, { method: 'POST', cookie: admin.cookie, body: {} })).status, 400, 'pide confirmación');
  assert.equal((await pedir(`/api/backup/${nombre}/restaurar`, { method: 'POST', cookie: ana.cookie, body: { confirmar: true } })).status, 403);

  const restaurado = await pedir(`/api/backup/${nombre}/restaurar`, { method: 'POST', cookie: admin.cookie, body: { confirmar: true } });
  assert.equal(restaurado.status, 200, JSON.stringify(restaurado.data));
  assert.equal(restaurado.data.relogin, false);
  assert.equal((await pedir('/api/horarios', { cookie: admin.cookie })).status, 200, 'la sesión del admin sigue válida');

  assert.equal((await pedir(`/api/backup/${nombre}`, { method: 'DELETE', cookie: admin.cookie })).status, 200);
});

test('chatbot: solo profesores y admin; responde sin IA y valida el mensaje', async () => {
  assert.equal((await pedir('/api/chatbot', { method: 'POST', body: { mensaje: 'hola' } })).status, 401);
  assert.equal((await pedir('/api/chatbot', { method: 'POST', cookie: alumno.cookie, body: { mensaje: 'hola' } })).status, 403);
  assert.equal((await pedir('/api/chatbot', { method: 'POST', cookie: ana.cookie, body: {} })).status, 400);

  const tabla = await pedir('/api/chatbot', { method: 'POST', cookie: ana.cookie, body: { mensaje: 'ver tabla' } });
  assert.equal(tabla.status, 200);
  assert.match(tabla.data.respuesta, /\| Día \|/);
  const ia = await pedir('/api/chatbot', { method: 'POST', cookie: ana.cookie, body: { mensaje: 'explicame algo' } });
  assert.equal(ia.status, 200, 'sin GEMINI_API_KEY no se cae');

  const denegado = await pedir('/api/chatbot', { method: 'POST', cookie: ana.cookie, body: { mensaje: 'hacer backup' } });
  assert.match(denegado.data.respuesta, /solo los puede gestionar el administrador/);
  const ok = await pedir('/api/chatbot', { method: 'POST', cookie: admin.cookie, body: { mensaje: 'hacer backup' } });
  assert.match(ok.data.respuesta, /Backup creado/);
});

test('el admin asigna una clase a un profesor de la plantilla que todavía no tiene cuenta', async () => {
  const nueva = await pedir('/api/horarios', { method: 'POST', cookie: admin.cookie,
    body: { curso: '9°2', dia: 'Viernes', hora_inicio: '08:00', hora_fin: '09:00', materia: 'Química', profesor_nombre: 'Mauro Ipar' } });
  assert.equal(nueva.status, 201, JSON.stringify(nueva.data));
  assert.equal(nueva.data.horario.profesor_nombre, 'Mauro Ipar');
  assert.equal(nueva.data.horario.profesor_id, null);
  // mismo profesor, mismas horas: choque
  const choque = await pedir('/api/horarios', { method: 'POST', cookie: admin.cookie,
    body: { curso: '9°2', dia: 'Viernes', hora_inicio: '08:30', hora_fin: '09:30', materia: 'Otra', profesor_nombre: 'Mauro Ipar' } });
  assert.equal(choque.status, 409);
  // alguien fuera de la plantilla y sin cuenta no se acepta
  const raro = await pedir('/api/horarios', { method: 'POST', cookie: admin.cookie,
    body: { curso: '9°2', dia: 'Viernes', hora_inicio: '10:00', hora_fin: '11:00', materia: 'X', profesor_nombre: 'Persona Inventada' } });
  assert.equal(raro.status, 400);
  // cuando Mauro se registra, la clase le aparece
  const mauro = await registrar('Mauro Ipar', 'mauro@a.com', 'profesor', 'PROFE-2026');
  const mias = await pedir('/api/horarios/mios', { cookie: mauro.cookie });
  assert.deepEqual(mias.data.horarios.map(h => h.materia), ['Química']);
});

test('cada curso tiene su propio horario: se publican por separado y una clase no cambia de curso', async () => {
  const cls = (curso, materia, hora) => ({ curso, dia: 'Martes', hora_inicio: hora, hora_fin: hora.replace(/^(\d\d)/, (h) => String(Number(h) + 1).padStart(2, '0')), materia, salon: `Aula ${materia}` });
  const mf = await pedir('/api/horarios', { method: 'POST', cookie: admin.cookie, body: cls('3°MF', 'Física', '08:00') });
  const ma = await pedir('/api/horarios', { method: 'POST', cookie: admin.cookie, body: cls('3°MA', 'Álgebra', '10:00') });
  assert.equal(mf.status, 201); assert.equal(ma.status, 201);

  // Los dos cursos existen y arrancan en borrador
  const lista = await pedir('/api/horarios/cursos', { cookie: admin.cookie });
  const estadoDe = (c) => lista.data.cursos.find(x => x.curso === c);
  assert.equal(estadoDe('3°MF').publicado, false);
  assert.equal(estadoDe('3°MA').publicado, false);

  // Publicar es por curso: hay que decir cuál, y publicar uno no publica el otro
  assert.equal((await pedir('/api/horarios/publicar', { method: 'POST', cookie: admin.cookie, body: { publicado: true } })).status, 400);
  assert.equal((await pedir('/api/horarios/publicar', { method: 'POST', cookie: admin.cookie, body: { curso: '3°MF', publicado: true } })).status, 200);
  const vistoAlumno = (await pedir('/api/horarios', { cookie: alumno.cookie })).data.horarios.map(h => h.materia);
  assert.ok(vistoAlumno.includes('Física'), 'el curso publicado se ve');
  assert.ok(!vistoAlumno.includes('Álgebra'), 'el curso en borrador no se ve');

  // Volver un curso a borrador no toca a los demás
  await pedir('/api/horarios/publicar', { method: 'POST', cookie: admin.cookie, body: { curso: '3°MA', publicado: true } });
  await pedir('/api/horarios/publicar', { method: 'POST', cookie: admin.cookie, body: { curso: '3°MF', publicado: false } });
  const despues = (await pedir('/api/horarios', { cookie: alumno.cookie })).data.horarios.map(h => h.materia);
  assert.ok(despues.includes('Álgebra') && !despues.includes('Física'));

  // Una clase no se pasa a otro curso (se elimina y se crea en el otro horario)
  const mover = await pedir(`/api/horarios/${mf.data.horario.id}`, { method: 'PUT', cookie: admin.cookie, body: { curso: '3°MA' } });
  assert.equal(mover.status, 400);
  assert.match(mover.data.error, /3°MF/);
  const igual = await pedir(`/api/horarios/${mf.data.horario.id}`, { method: 'PUT', cookie: admin.cookie, body: { materia: 'Física 2' } });
  assert.equal(igual.status, 200);
  assert.equal(igual.data.horario.curso, '3°MF');

  // Cursos nuevos: se abren vacíos en borrador, no se repiten y no se pueden publicar sin clases
  assert.equal((await pedir('/api/horarios/cursos', { method: 'POST', cookie: admin.cookie, body: { curso: '3°ZZ' } })).status, 201);
  assert.equal((await pedir('/api/horarios/cursos', { method: 'POST', cookie: admin.cookie, body: { curso: '3°zz' } })).status, 409);
  assert.equal((await pedir('/api/horarios/publicar', { method: 'POST', cookie: admin.cookie, body: { curso: '3°ZZ', publicado: true } })).status, 400);
  assert.equal((await pedir('/api/horarios/cursos', { method: 'POST', cookie: alumno.cookie, body: { curso: '1°A' } })).status, 403);
  assert.equal((await pedir(`/api/horarios/cursos/${encodeURIComponent('3°MA')}`, { method: 'DELETE', cookie: admin.cookie })).status, 409, 'un curso con clases no se quita');
  assert.equal((await pedir(`/api/horarios/cursos/${encodeURIComponent('3°ZZ')}`, { method: 'DELETE', cookie: admin.cookie })).status, 200);
});
