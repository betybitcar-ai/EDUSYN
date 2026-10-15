const express = require('express');
const db = require('../db/database');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/avisos?tipo=aviso|noticia
router.get('/', requireAuth, (req, res) => {
  const tipo = req.query.tipo === 'noticia' ? 'noticia' : 'aviso';
  const avisos = db.prepare('SELECT * FROM avisos WHERE tipo = ? ORDER BY id DESC LIMIT 100').all(tipo);
  res.json({ avisos });
});

router.post('/', requireRole('admin'), (req, res) => {
  const { titulo, contenido } = req.body || {};
  const tipo = req.body && req.body.tipo === 'noticia' ? 'noticia' : 'aviso';
  if (!titulo || !contenido) return res.status(400).json({ error: 'Título y contenido son obligatorios.' });
  const info = db.prepare('INSERT INTO avisos (tipo, titulo, contenido, autor_nombre) VALUES (?, ?, ?, ?)')
    .run(tipo, String(titulo).slice(0, 150), String(contenido).slice(0, 2000), req.session.user.nombre);
  res.status(201).json({ aviso: db.prepare('SELECT * FROM avisos WHERE id = ?').get(info.lastInsertRowid) });
});

router.delete('/:id', requireRole('admin'), (req, res) => {
  db.prepare('DELETE FROM avisos WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
