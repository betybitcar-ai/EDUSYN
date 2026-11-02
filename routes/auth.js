const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db/database');
const { vincularBloquesPorNombre } = require('../lib/horariosLib');

const { crearLimitador } = require('../lib/seguridad');
const { requireAuth, requireRole } = require('../middleware/auth');
const historial = require('../lib/historialLib');

const router = express.Router();

// En producción no existen claves por defecto: si falta la variable, nadie puede registrarse con ese rol.
const enProduccion = () => process.env.NODE_ENV === 'production';
const CODIGOS = {
  profesor: () => process.env.PROFE_CODE || (enProduccion() ? null : 'PROFE-2026'),
  admin: () => process.env.ADMIN_CODE || (enProduccion() ? null : 'ADMIN-2026')
};

// Contra fuerza bruta: 5 contraseñas erróneas por correo+IP y 10 claves de autorización erróneas por IP, cada 15 minutos.
const limiteLogin = crearLimitador({ max: 5 });
const limiteCodigo = crearLimitador({ max: 10 });
const esperar = (seg) => `Demasiados intentos. Probá de nuevo en ${Math.ceil(seg / 60)} minuto(s).`;

function usuarioPublico(u) {
  return { id: u.id, nombre: u.nombre, email: u.email, rol: u.rol };
}

router.post('/register', async (req, res) => {
  try {
    const { nombre, email, password, rol = 'alumno', codigo } = req.body || {};
    if (!nombre || !email || !password) {
      return res.status(400).json({ error: 'Completá nombre, correo y contraseña.' });
    }
    if (!['alumno', 'profesor', 'admin'].includes(rol)) {
      return res.status(400).json({ error: 'Rol no válido.' });
    }
    if (rol !== 'alumno') {
      const espera = limiteCodigo.bloqueado(req.ip);
      if (espera) return res.status(429).json({ error: esperar(espera) });
      const esperado = CODIGOS[rol]();
      if (!esperado || codigo !== esperado) {
        limiteCodigo.fallo(req.ip);
        return res.status(403).json({ error: 'La clave de autorización no es correcta para ese rol.' });
      }
    }
    if (db.prepare('SELECT id FROM usuarios WHERE email = ?').get(email)) {
      return res.status(409).json({ error: 'El correo electrónico ya está registrado.' });
    }
    const hash = await bcrypt.hash(password, 10);
    const info = db.prepare(
      'INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES (?, ?, ?, ?)'
    ).run(nombre.trim(), email.trim().toLowerCase(), hash, rol);
    const user = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(info.lastInsertRowid);
    req.session.user = usuarioPublico(user);
    vincularBloquesPorNombre(user);
    res.status(201).json({ user: req.session.user });
  } catch (e) {
    console.error('register', e);
    res.status(500).json({ error: 'Error interno al registrar la cuenta.' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Ingresá tu correo y contraseña.' });
    const clave = `${req.ip}|${email.trim().toLowerCase()}`;
    const espera = limiteLogin.bloqueado(clave);
    if (espera) return res.status(429).json({ error: esperar(espera) });
    const u = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(email.trim().toLowerCase());
    if (!u || !(await bcrypt.compare(password, u.password_hash))) {
      limiteLogin.fallo(clave);
      return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
    }
    limiteLogin.exito(clave);
    req.session.user = usuarioPublico(u);
    vincularBloquesPorNombre(u);
    res.json({ user: req.session.user });
  } catch (e) {
    console.error('login', e);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

// Cada persona cambia su propia contraseña (pide la actual).
router.post('/password', requireAuth, async (req, res) => {
  try {
    const { actual, nueva } = req.body || {};
    if (typeof actual !== 'string' || typeof nueva !== 'string' || !actual || !nueva) return res.status(400).json({ error: 'Completá la contraseña actual y la nueva.' });
    if (nueva.length < 8) return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 8 caracteres.' });
    if (nueva.length > 100) return res.status(400).json({ error: 'La nueva contraseña es demasiado larga.' });
    const clave = `pw|${req.session.user.id}|${req.ip}`;
    const espera = limiteLogin.bloqueado(clave);
    if (espera) return res.status(429).json({ error: esperar(espera) });
    const u = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.session.user.id);
    if (!u || !(await bcrypt.compare(actual, u.password_hash))) {
      limiteLogin.fallo(clave);
      return res.status(401).json({ error: 'La contraseña actual no es correcta.' });
    }
    if (nueva === actual) return res.status(400).json({ error: 'La nueva contraseña tiene que ser distinta de la actual.' });
    if (nueva === require('../lib/cuentasProfesores').passwordInicial()) return res.status(400).json({ error: 'Elegí una contraseña distinta de la inicial.' });
    limiteLogin.exito(clave);
    db.prepare('UPDATE usuarios SET password_hash = ? WHERE id = ?').run(await bcrypt.hash(nueva, 10), u.id);
    historial.registrar(req.session.user, 'clave', 'Cambió su contraseña');
    res.json({ ok: true });
  } catch (e) {
    console.error('password', e);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

// El admin devuelve la contraseña inicial a un profesor que la olvidó.
router.post('/restablecer', requireRole('admin'), (req, res) => {
  const id = Number((req.body || {}).usuario_id);
  const p = id ? db.prepare("SELECT id, nombre FROM usuarios WHERE id = ? AND rol = 'profesor'").get(id) : null;
  if (!p) return res.status(404).json({ error: 'Profesor no encontrado (solo se restablecen cuentas de profesores).' });
  const inicial = require('../lib/cuentasProfesores').passwordInicial();
  db.prepare('UPDATE usuarios SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(inicial, 10), p.id);
  db.prepare(`INSERT INTO mensajes (remitente_id, remitente_nombre, destinatario_id, destinatario_nombre, contenido, tipo)
              VALUES (NULL, 'Sistema Cuadrilla', ?, ?, ?, 'sistema')`)
    .run(p.id, p.nombre, 'La administración restableció tu contraseña a la inicial. Cambiala desde “Cambiar contraseña” en el menú.');
  historial.registrar(req.session.user, 'clave', `Restableció la contraseña de ${p.nombre}`);
  res.json({ ok: true, nombre: p.nombre, password: inicial });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'No hay sesión activa.' });
  res.json({ user: req.session.user });
});

module.exports = router;
