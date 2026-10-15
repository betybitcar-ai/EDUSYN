const express = require('express');
const { requireRole } = require('../middleware/auth');
const { LIMITE_FALTAS, listaNegraActual } = require('../lib/horariosLib');

const router = express.Router();

// GET /api/lista-negra - exclusivo del Administrador.
// Calcula en vivo, a partir del registro de Ausencias, qué profesores
// alcanzaron o superaron el límite de faltas permitido.
router.get('/', requireRole('admin'), (req, res) => {
  res.json({ limite_faltas: LIMITE_FALTAS, lista_negra: listaNegraActual() });
});

module.exports = router;
