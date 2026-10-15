const express = require('express');
const { requireRole } = require('../middleware/auth');
const cambios = require('../lib/cambiosLib');

const router = express.Router();

const manejar = (fn) => (req, res) => {
  try { res.json(fn(req)); }
  catch (e) {
    if (!e.status) { console.error('[cambios]', e); return res.status(500).json({ error: 'Error interno del servidor.' }); }
    res.status(e.status).json({ error: e.message });
  }
};

// Intercambios emparejados por el asistente que esperan la decisión del admin
router.get('/', requireRole('admin'), manejar(() => ({ cambios: cambios.pendientes() })));
router.post('/:id/aprobar', requireRole('admin'), manejar(req => cambios.aprobar(Number(req.params.id), req.session.user)));
router.post('/:id/rechazar', requireRole('admin'), manejar(req => cambios.rechazar(Number(req.params.id), req.session.user)));

module.exports = router;
