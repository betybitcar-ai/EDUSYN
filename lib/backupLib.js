// Copias de seguridad de la base de datos (SQLite). Solo se exponen a través de rutas de administrador.
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const db = require('../db/database');

const carpeta = () => process.env.BACKUP_DIR || path.join(__dirname, '..', 'backups');
// manual: lo pidió un admin · auto: programado · seguridad: se crea justo antes de restaurar
const PATRON = /^cuadrilla-\d{8}-\d{6}-(manual|auto|seguridad)\.db$/;
const MAX_AUTO = Number(process.env.BACKUP_MAX_AUTO) || 14;

const dos = (n) => String(n).padStart(2, '0');
function sello(d) {
  return `${d.getFullYear()}${dos(d.getMonth() + 1)}${dos(d.getDate())}-${dos(d.getHours())}${dos(d.getMinutes())}${dos(d.getSeconds())}`;
}

function describir(nombre) {
  const st = fs.statSync(path.join(carpeta(), nombre));
  return { nombre, tipo: PATRON.exec(nombre)[1], tamano: st.size, creado: st.mtime.toISOString() };
}

function crearBackup(tipo = 'manual') {
  if (!['manual', 'auto', 'seguridad'].includes(tipo)) throw new Error('Tipo de backup no válido.');
  fs.mkdirSync(carpeta(), { recursive: true });
  let fecha = new Date();
  let nombre = `cuadrilla-${sello(fecha)}-${tipo}.db`;
  while (fs.existsSync(path.join(carpeta(), nombre))) {   // dos backups en el mismo segundo
    fecha = new Date(fecha.getTime() + 1000);
    nombre = `cuadrilla-${sello(fecha)}-${tipo}.db`;
  }
  const destino = path.join(carpeta(), nombre);
  // VACUUM INTO genera una copia consistente y compacta aunque la base esté en uso (WAL).
  db.exec(`VACUUM INTO '${destino.replace(/'/g, "''")}'`);
  return describir(nombre);
}

function listarBackups() {
  if (!fs.existsSync(carpeta())) return [];
  return fs.readdirSync(carpeta()).filter(n => PATRON.test(n)).map(describir)
    .sort((a, b) => b.creado.localeCompare(a.creado) || b.nombre.localeCompare(a.nombre));
}

// Valida el nombre (nada de rutas ni "..") y devuelve la ruta completa o lanza un error con status.
function rutaBackup(nombre) {
  if (typeof nombre !== 'string' || !PATRON.test(nombre)) {
    throw Object.assign(new Error('Nombre de backup no válido.'), { status: 400 });
  }
  const ruta = path.join(carpeta(), nombre);
  if (!fs.existsSync(ruta)) throw Object.assign(new Error('Ese backup no existe.'), { status: 404 });
  return ruta;
}

function eliminarBackup(nombre) {
  fs.unlinkSync(rutaBackup(nombre));
}

function validarArchivo(ruta) {
  let bk;
  try {
    bk = new DatabaseSync(ruta);
    const ok = bk.prepare('PRAGMA integrity_check').get();
    const tablas = bk.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(t => t.name);
    if (Object.values(ok)[0] !== 'ok' || !tablas.includes('usuarios') || !tablas.includes('horarios')) {
      throw new Error('invalido');
    }
  } catch {
    throw Object.assign(new Error('El archivo de backup está dañado o no es de Cuadrilla.'), { status: 422 });
  } finally {
    try { bk && bk.close(); } catch { /* ya cerrado */ }
  }
}

// Reemplaza TODOS los datos actuales por los del backup. Antes guarda un backup de seguridad.
function restaurarBackup(nombre) {
  const ruta = rutaBackup(nombre);
  validarArchivo(ruta);
  const seguridad = crearBackup('seguridad');

  const tablas = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all().map(t => t.name);

  db.exec('PRAGMA foreign_keys = OFF');
  db.prepare('ATTACH DATABASE ? AS bk').run(ruta);
  try {
    db.exec('BEGIN');
    try {
      const enBackup = new Set(db.prepare("SELECT name FROM bk.sqlite_master WHERE type = 'table'").all().map(t => t.name));
      for (const t of tablas) db.exec(`DELETE FROM main."${t}"`);
      for (const t of tablas) {
        if (!enBackup.has(t)) continue;
        const actuales = db.prepare(`PRAGMA main.table_info("${t}")`).all().map(c => c.name);
        const delBackup = new Set(db.prepare(`PRAGMA bk.table_info("${t}")`).all().map(c => c.name));
        const cols = actuales.filter(c => delBackup.has(c)).map(c => `"${c}"`).join(', ');
        if (cols) db.exec(`INSERT INTO main."${t}" (${cols}) SELECT ${cols} FROM bk."${t}"`);
      }
      if (enBackup.has('sqlite_sequence')) {   // que los próximos ids continúen donde estaban
        db.exec('DELETE FROM main.sqlite_sequence');
        db.exec('INSERT INTO main.sqlite_sequence SELECT * FROM bk.sqlite_sequence');
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  } finally {
    try { db.exec('DETACH DATABASE bk'); } catch { /* no estaba adjunta */ }
    db.exec('PRAGMA foreign_keys = ON');
  }
  return { restaurado: nombre, respaldo_de_seguridad: seguridad.nombre };
}

function podarAutomaticos(max = MAX_AUTO) {
  listarBackups().filter(b => b.tipo === 'auto').slice(max).forEach(b => eliminarBackup(b.nombre));
}

// Backup diario automático: revisa cada hora y crea uno si el último automático tiene ~24 h o más.
function iniciarBackupAutomatico() {
  if (process.env.BACKUP_AUTO === '0') return null;
  const DIA = 24 * 60 * 60 * 1000;
  const revisar = () => {
    try {
      const ultimo = listarBackups().find(b => b.tipo === 'auto');
      if (!ultimo || Date.now() - new Date(ultimo.creado).getTime() >= DIA - 60 * 1000) {
        crearBackup('auto');
        podarAutomaticos();
      }
    } catch (e) { console.error('[backup] automático falló:', e.message); }
  };
  revisar();
  const timer = setInterval(revisar, 60 * 60 * 1000);
  timer.unref();
  return timer;
}

module.exports = {
  crearBackup, listarBackups, rutaBackup, eliminarBackup, restaurarBackup,
  podarAutomaticos, iniciarBackupAutomatico
};
