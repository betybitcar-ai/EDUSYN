const express = require('express');
const db = require('../db/database');
const { requireAuth, requireRole } = require('../middleware/auth');
const avisosLib = require('../lib/avisosLib');
const historial = require('../lib/historialLib');

const router = express.Router();

// GET /api/avisos/destinos - opciones para dirigir un aviso (cursos, turnos, profesores). Solo admin.
router.get('/destinos', requireRole('admin'), (req, res) => {
  res.json(avisosLib.opcionesDestino());
});

// GET /api/avisos?tipo=aviso|noticia
// El admin ve todo. Un aviso dirigido solo lo ven los profesores a quienes alcanza; los alumnos, solo los de "todos".
router.get('/', requireAuth, (req, res) => {
  const tipo = req.query.tipo === 'noticia' ? 'noticia' : 'aviso';
  const usuario = req.session.user;
  const esAdmin = usuario.rol === 'admin';
  let filas = db.prepare('SELECT * FROM avisos WHERE tipo = ? ORDER BY id DESC LIMIT 500').all(tipo);
  if (!esAdmin) {
    const ctx = avisosLib.contexto(usuario);
    filas = filas.filter(a => avisosLib.visiblePara(a, usuario, ctx));
  }
  res.json({ avisos: filas.slice(0, 100).map(a => avisosLib.presentar(a, esAdmin)) });
});

// POST /api/avisos { tipo, titulo, contenido, destino_tipo?, destino? }
// Solo los avisos se pueden dirigir; las noticias son siempre para todos.
router.post('/', requireRole('admin'), (req, res) => {
  const { titulo, contenido } = req.body || {};
  const tipo = req.body && req.body.tipo === 'noticia' ? 'noticia' : 'aviso';
  if (!titulo || !contenido) return res.status(400).json({ error: 'Título y contenido son obligatorios.' });
  const dest = tipo === 'aviso' ? avisosLib.parsearDestino(req.body) : { tipo: 'todos', valores: [] };
  if (dest.error) return res.status(400).json({ error: dest.error });

  const info = db.prepare('INSERT INTO avisos (tipo, titulo, contenido, autor_nombre, destino_tipo, destino) VALUES (?, ?, ?, ?, ?, ?)')
    .run(tipo, String(titulo).slice(0, 150), String(contenido).slice(0, 2000), req.session.user.nombre,
         dest.tipo, dest.tipo === 'todos' ? null : JSON.stringify(dest.valores));
  const aviso = db.prepare('SELECT * FROM avisos WHERE id = ?').get(info.lastInsertRowid);

  const respuesta = { aviso: avisosLib.presentar(aviso, true) };
  if (dest.tipo !== 'todos') {
    respuesta.destinatarios = avisosLib.contarDestinatarios(aviso);
    historial.registrar(req.session.user, 'aviso',
      `Publicó el aviso “${aviso.titulo}” para ${respuesta.aviso.para} (${respuesta.destinatarios} profesor${respuesta.destinatarios === 1 ? '' : 'es'} con cuenta)`);
  }
  res.status(201).json(respuesta);
});

router.delete('/:id', requireRole('admin'), (req, res) => {
  db.prepare('DELETE FROM avisos WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
