const express = require('express');
const db = require('../db/database');
const backup = require('../lib/backupLib');
const historial = require('../lib/historialLib');
const { generarPdfBackup } = require('../lib/backupPdfLib');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

// Todo el módulo es EXCLUSIVO del administrador (los backups contienen datos de todos los usuarios).
router.use(requireRole('admin'));

const manejar = (fn) => (req, res) => {
  try { fn(req, res); } catch (e) {
    if (!e.status) console.error('[backup]', e);
    res.status(e.status || 500).json({ error: e.status ? e.message : 'No se pudo completar la operación de backup.' });
  }
};

// GET /api/backup - lista los backups disponibles
router.get('/', manejar((req, res) => res.json({ backups: backup.listarBackups() })));

// POST /api/backup - crea un backup ahora
router.post('/', manejar((req, res) => {
  const b = backup.crearBackup('manual');
  historial.registrar(req.session.user, 'backup', `Creó el backup ${b.nombre}`);
  res.status(201).json({ mensaje: 'Backup creado.', backup: b });
}));

// GET /api/backup/:nombre/descargar - baja el archivo .db
router.get('/:nombre/descargar', manejar((req, res) => {
  const ruta = backup.rutaBackup(req.params.nombre);
  res.download(ruta, req.params.nombre);
}));

// GET /api/backup/:nombre/pdf - informe legible del backup (horarios, profesores, usuarios); no incluye contraseñas
router.get('/:nombre/pdf', manejar((req, res) => {
  const ruta = backup.rutaBackup(req.params.nombre);
  const pdf = generarPdfBackup(ruta, req.params.nombre);
  historial.registrar(req.session.user, 'backup', `Descargó en PDF el backup ${req.params.nombre}`);
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${req.params.nombre.replace(/\.db$/, '')}.pdf"`, 'Content-Length': pdf.length });
  res.end(pdf);
}));

// POST /api/backup/:nombre/restaurar { confirmar: true } - reemplaza los datos actuales
router.post('/:nombre/restaurar', manejar((req, res) => {
  if (!req.body || req.body.confirmar !== true) {
    return res.status(400).json({ error: 'Restaurar reemplaza todos los datos actuales: enviá { "confirmar": true }.' });
  }
  const r = backup.restaurarBackup(req.params.nombre);
  historial.registrar(req.session.user, 'backup', `Restauró el backup ${req.params.nombre} (copia de seguridad previa: ${r.respaldo_de_seguridad})`);
  // Si el admin actual ya no existe en el backup, se cierra su sesión.
  const yo = req.session.user;
  const vigente = db.prepare('SELECT id, nombre, email, rol FROM usuarios WHERE email = ? AND rol = ?').get(yo.email, 'admin');
  if (!vigente) {
    return req.session.destroy(() => res.json({ mensaje: 'Backup restaurado. Volvé a iniciar sesión.', ...r, relogin: true }));
  }
  req.session.user = vigente;
  res.json({ mensaje: 'Backup restaurado.', ...r, relogin: false });
}));

// DELETE /api/backup/:nombre
router.delete('/:nombre', manejar((req, res) => {
  backup.eliminarBackup(req.params.nombre);
  res.json({ mensaje: 'Backup eliminado.' });
}));

module.exports = router;
