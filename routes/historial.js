const express = require('express');
const { requireRole } = require('../middleware/auth');
const historial = require('../lib/historialLib');

const router = express.Router();

// GET /api/historial?q=texto&accion=editar&limite=200 - solo administrador
router.get('/', requireRole('admin'), (req, res) => {
  res.json({
    acciones: historial.ACCIONES,
    historial: historial.listar({ texto: req.query.q, accion: req.query.accion, limite: req.query.limite })
  });
});

module.exports = router;
