// Crea una cuenta de usuario (rol profesor) para cada nombre de lib/profesoresPlantilla.js.
// Es idempotente: si el profesor ya tiene cuenta (mismo nombre o mismo correo) no la toca ni cambia su contraseña.
// Correo: nombre.apellido@cuadrilla.com (sin tildes). Contraseña inicial: PROFE_PASSWORD_INICIAL (por defecto "profe123").
// En producción no hay contraseña por defecto: sin PROFE_PASSWORD_INICIAL no se crea nada.
const bcrypt = require('bcryptjs');
const db = require('../db/database');
const { PLANTILLA } = require('./profesoresPlantilla');
const { mismoNombre, normalizar } = require('./horariosLib');

const DOMINIO = process.env.PROFE_DOMINIO || 'cuadrilla.com';

function emailDe(nombre) {
  return normalizar(nombre).split(' ').filter(Boolean).join('.') + '@' + DOMINIO;
}

function passwordInicial() {
  if (process.env.PROFE_PASSWORD_INICIAL) return process.env.PROFE_PASSWORD_INICIAL;
  return process.env.NODE_ENV === 'production' ? null : 'profe123';
}

// Devuelve [{ nombre, email, creada }] para toda la plantilla.
function crearCuentasProfesores() {
  const pass = passwordInicial();
  if (!pass) {
    console.warn('Cuentas de profesores NO creadas: definí PROFE_PASSWORD_INICIAL en .env (en producción no hay contraseña por defecto).');
    return [];
  }
  const hash = bcrypt.hashSync(pass, 10);
  const existentes = db.prepare("SELECT id, nombre, email FROM usuarios WHERE rol = 'profesor'").all();
  const ins = db.prepare("INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES (?, ?, ?, 'profesor')");
  const resultado = [];
  for (const { nombre } of PLANTILLA) {
    const ya = existentes.find(u => mismoNombre(u.nombre, nombre));
    if (ya) { resultado.push({ nombre: ya.nombre, email: ya.email, creada: false }); continue; }
    const email = emailDe(nombre);
    if (db.prepare('SELECT id FROM usuarios WHERE email = ?').get(email)) { resultado.push({ nombre, email, creada: false }); continue; }
    ins.run(nombre, email, hash);
    resultado.push({ nombre, email, creada: true });
  }
  return resultado;
}

module.exports = { crearCuentasProfesores, emailDe };
