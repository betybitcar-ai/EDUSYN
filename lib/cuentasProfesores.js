// Crea una cuenta de usuario (rol profesor) para cada nombre de lib/profesoresPlantilla.js.
// Es idempotente: si el profesor ya tiene cuenta (mismo nombre o mismo correo) no se duplica.
// Correo: nombre.apellido@gmail.com (sin tildes). Contraseña inicial: PROFE-2026 (o PROFE_PASSWORD_INICIAL si se define).
// Además, una sola vez (migración v2), TODAS las cuentas de profesores que ya existían (de la plantilla o no)
// pasan al correo nombre.apellido@gmail.com y a esa misma contraseña inicial.
const bcrypt = require('bcryptjs');
const db = require('../db/database');
const { PLANTILLA } = require('./profesoresPlantilla');
const { mismoNombre, normalizar } = require('./horariosLib');

const DOMINIO = process.env.PROFE_DOMINIO || 'gmail.com';

function emailDe(nombre) {
  return normalizar(nombre).split(' ').filter(Boolean).join('.') + '@' + DOMINIO;
}

const PASSWORD_POR_DEFECTO = 'PROFE-2026';
function passwordInicial() {
  return process.env.PROFE_PASSWORD_INICIAL || PASSWORD_POR_DEFECTO;
}

// Devuelve [{ nombre, email, creada }] para toda la plantilla.
function crearCuentasProfesores() {
  const pass = passwordInicial();
  const hash = bcrypt.hashSync(pass, 10);
  // Una única vez: las cuentas de profesores que ya existían pasan al correo @gmail.com y a la contraseña inicial.
  const migrar = db.getConfig('clave_profes_inicial_v2') !== '1';
  const existentes = db.prepare("SELECT id, nombre, email FROM usuarios WHERE rol = 'profesor'").all();
  const ins = db.prepare("INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES (?, ?, ?, 'profesor')");
  const correoLibre = (email, id) => !db.prepare('SELECT id FROM usuarios WHERE email = ? AND id <> ?').get(email, id);

  // Migra una cuenta existente: correo nuevo (si no choca con otra cuenta) + contraseña inicial.
  const migrarCuenta = (u) => {
    const nuevo = emailDe(u.nombre);
    if (u.email !== nuevo && correoLibre(nuevo, u.id)) {
      db.prepare('UPDATE usuarios SET email = ? WHERE id = ?').run(nuevo, u.id);
      u.email = nuevo;
    }
    db.prepare('UPDATE usuarios SET password_hash = ? WHERE id = ?').run(hash, u.id);
  };

  const resultado = [];
  for (const { nombre } of PLANTILLA) {
    const ya = existentes.find(u => mismoNombre(u.nombre, nombre));
    if (ya) {
      if (migrar) migrarCuenta(ya);
      resultado.push({ nombre: ya.nombre, email: ya.email, creada: false });
      continue;
    }
    const email = emailDe(nombre);
    if (db.prepare('SELECT id FROM usuarios WHERE email = ?').get(email)) { resultado.push({ nombre, email, creada: false }); continue; }
    ins.run(nombre, email, hash);
    resultado.push({ nombre, email, creada: true });
  }
  // Profesores registrados que no figuran en la plantilla: también se migran (una sola vez).
  if (migrar) {
    for (const u of existentes) {
      if (PLANTILLA.some(p => mismoNombre(u.nombre, p.nombre))) continue;
      migrarCuenta(u);
      resultado.push({ nombre: u.nombre, email: u.email, creada: false });
    }
    db.setConfig('clave_profes_inicial_v2', '1');
  }
  return resultado;
}

module.exports = { crearCuentasProfesores, emailDe, passwordInicial };
