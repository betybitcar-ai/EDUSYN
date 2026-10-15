const express = require('express');
const db = require('../db/database');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// La mensajería interna es una herramienta de coordinación entre profesores/admin.
// Los alumnos no tienen acceso a este módulo.

// GET /api/mensajes - trae los mensajes dirigidos al usuario logueado (y avisos de sistema)
router.get('/', requireRole('profesor', 'admin'), (req, res) => {
  const mensajes = db.prepare(`
    SELECT * FROM mensajes
    WHERE destinatario_id = ? OR tipo = 'sistema'
    ORDER BY creado_en DESC
  `).all(req.session.user.id);
  res.json({ mensajes });
});

// POST /api/mensajes - enviar un mensaje a otro usuario
// body: { destinatario_id, contenido, tipo? }
router.post('/', requireRole('profesor', 'admin'), (req, res) => {
  const { destinatario_id, contenido, tipo } = req.body;

  if (!contenido) {
    return res.status(400).json({ error: 'El contenido del mensaje es obligatorio.' });
  }

  let destinatarioNombre = null;
  if (destinatario_id) {
    const destinatario = db.prepare('SELECT nombre FROM usuarios WHERE id = ?').get(destinatario_id);
    if (!destinatario) {
      return res.status(404).json({ error: 'Destinatario no encontrado.' });
    }
    destinatarioNombre = destinatario.nombre;
  }

  const info = db.prepare(`
    INSERT INTO mensajes (remitente_id, remitente_nombre, destinatario_id, destinatario_nombre, contenido, tipo)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    req.session.user.id,
    req.session.user.nombre,
    destinatario_id || null,
    destinatarioNombre,
    contenido,
    tipo || 'directo'
  );

  const mensaje = db.prepare('SELECT * FROM mensajes WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ mensaje: 'Mensaje enviado.', datos: mensaje });
});

// PATCH /api/mensajes/:id/leido - marcar un mensaje como leído
router.patch('/:id/leido', requireRole('profesor', 'admin'), (req, res) => {
  const { id } = req.params;
  db.prepare('UPDATE mensajes SET leido = 1 WHERE id = ? AND destinatario_id = ?')
    .run(id, req.session.user.id);
  res.json({ mensaje: 'Mensaje marcado como leído.' });
});

module.exports = router;
