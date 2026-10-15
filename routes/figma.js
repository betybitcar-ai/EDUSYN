const express = require('express');
const db = require('../db/database');
const { getConfig, setConfig } = db;
const { requireRole } = require('../middleware/auth');
const lib = require('../lib/horariosLib');
const { parsearFigma } = require('../lib/figmaParser');

const router = express.Router();
router.use(requireRole('admin'));

const API_BASE = () => (process.env.FIGMA_API_BASE || 'https://api.figma.com').replace(/\/$/, '');

// https://www.figma.com/design/<KEY>/<nombre>?node-id=1-2  (también /file/, /board/, /proto/)
function leerUrl(url) {
  let u;
  try { u = new URL(String(url)); } catch { return null; }
  if (!/(^|\.)figma\.com$/.test(u.hostname)) return null;
  const m = /^\/(?:file|design|board|proto)\/([A-Za-z0-9]+)/.exec(u.pathname);
  if (!m) return null;
  const nodeId = u.searchParams.get('node-id');
  return { key: m[1], nodeId: nodeId ? nodeId.replace('-', ':') : null };
}

async function pedirAFigma(url) {
  const ref = leerUrl(url);
  if (!ref) throw Object.assign(new Error('El enlace no parece ser de un archivo de Figma (figma.com/design/…).'), { status: 400 });
  const token = process.env.FIGMA_TOKEN;
  if (!token) throw Object.assign(new Error('Falta FIGMA_TOKEN en el archivo .env del servidor.'), { status: 503 });

  const ruta = ref.nodeId
    ? `/v1/files/${ref.key}/nodes?ids=${encodeURIComponent(ref.nodeId)}`
    : `/v1/files/${ref.key}`;
  let r;
  try {
    r = await fetch(API_BASE() + ruta, { headers: { 'X-Figma-Token': token }, signal: AbortSignal.timeout(20000) });
  } catch (e) {
    throw Object.assign(new Error('No se pudo conectar con Figma. Revisá la conexión del servidor.'), { status: 502 });
  }
  if (r.status === 403) throw Object.assign(new Error('Figma rechazó el token o no tenés acceso al archivo.'), { status: 502 });
  if (r.status === 404) throw Object.assign(new Error('No se encontró el archivo de Figma.'), { status: 502 });
  if (r.status === 429) throw Object.assign(new Error('Figma pidió esperar un momento. Probá de nuevo en un minuto.'), { status: 502 });
  if (!r.ok) throw Object.assign(new Error(`Figma respondió ${r.status}.`), { status: 502 });

  const json = await r.json();
  if (ref.nodeId) {
    const nodo = json.nodes && Object.values(json.nodes)[0];
    if (!nodo || !nodo.document) throw Object.assign(new Error('No encontré ese frame dentro del archivo.'), { status: 502 });
    return { documento: nodo.document, nombre: json.name };
  }
  return { documento: json.document, nombre: json.name };
}

const urlGuardada = () => getConfig('figma_url', '');

router.get('/config', (req, res) => {
  res.json({ url: urlGuardada(), tokenConfigurado: Boolean(process.env.FIGMA_TOKEN) });
});

router.post('/config', (req, res) => {
  const url = String((req.body && req.body.url) || '').trim();
  if (url && !leerUrl(url)) return res.status(400).json({ error: 'El enlace no parece ser de Figma (figma.com/design/…).' });
  setConfig('figma_url', url);
  res.json({ url });
});

async function analizar(req) {
  const url = (req.body && req.body.url) || urlGuardada();
  const { documento, nombre } = await pedirAFigma(url);
  const { bloques, avisos } = parsearFigma(documento, lib.listaProfesores());
  return { url, nombre, bloques, avisos };
}

function manejarError(res, e) {
  res.status(e.status || 500).json({ error: e.message || 'Error al leer Figma.' });
}

// Vista previa: muestra qué se importaría, sin tocar la base
router.post('/preview', async (req, res) => {
  try { res.json(await analizar(req)); } catch (e) { manejarError(res, e); }
});

// Importa: modo 'reemplazar' borra antes SOLO lo que vino de Figma; 'agregar' conserva todo.
router.post('/importar', async (req, res) => {
  try {
    const modo = req.body && req.body.modo === 'agregar' ? 'agregar' : 'reemplazar';
    const { url, bloques, avisos } = await analizar(req);
    if (!bloques.length) return res.status(422).json({ error: avisos[0] || 'No hay clases para importar.', avisos });

    setConfig('figma_url', url);
    const importados = [];
    const omitidos = [];

    db.exec('BEGIN');
    try {
      if (modo === 'reemplazar') db.prepare("DELETE FROM horarios WHERE origen = 'figma'").run();
      for (const b of bloques) {
        const v = lib.validarBloque(b);
        if (v.error) { omitidos.push(`${b.materia}: ${v.error}`); continue; }
        const datos = { ...v.bloque, profesor_id: b.profesor_id };
        const choque = lib.buscarConflicto(datos);
        if (choque) { omitidos.push(`${b.materia}: ${choque}`); continue; }
        const info = db.prepare(`
          INSERT INTO horarios (dia, hora_inicio, hora_fin, materia, salon, estado, profesor_id, profesor_nombre, origen, creado_por)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'figma', ?)
        `).run(datos.dia, datos.hora_inicio, datos.hora_fin, datos.materia, datos.salon,
               b.profesor_nombre ? 'ocupado' : 'disponible', b.profesor_id, b.profesor_nombre, req.session.user.id);
        importados.push(Number(info.lastInsertRowid));
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    require('../lib/historialLib').registrar(req.session.user, 'importar', `Importó ${importados.length} clase(s) desde Figma (modo ${modo}${omitidos.length ? `, ${omitidos.length} omitidas` : ''})`);
    res.json({ importados: importados.length, omitidos, avisos });
  } catch (e) { manejarError(res, e); }
});

module.exports = router;
