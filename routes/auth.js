const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db/database');
const { vincularBloquesPorNombre } = require('../lib/horariosLib');

const { crearLimitador } = require('../lib/seguridad');

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

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'No hay sesión activa.' });
  res.json({ user: req.session.user });
});

module.exports = router;
