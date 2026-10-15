const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const dbPath = process.env.DB_PATH || path.join(__dirname, 'cuadrilla.db');
const db = new DatabaseSync(dbPath);

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    rol TEXT NOT NULL CHECK (rol IN ('alumno', 'profesor', 'admin')),
    creado_en TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS horarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dia TEXT NOT NULL,
    hora_inicio TEXT NOT NULL,
    hora_fin TEXT NOT NULL,
    materia TEXT NOT NULL,
    salon TEXT,
    estado TEXT NOT NULL DEFAULT 'disponible' CHECK (estado IN ('disponible', 'ocupado')),
    profesor_id INTEGER,
    profesor_nombre TEXT,
    origen TEXT NOT NULL DEFAULT 'manual',
    creado_por INTEGER,
    creado_en TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (profesor_id) REFERENCES usuarios(id) ON DELETE SET NULL,
    FOREIGN KEY (creado_por) REFERENCES usuarios(id) ON DELETE SET NULL
  );

  -- Pares clave/valor: publicación del horario, URL del archivo de Figma, etc.
  CREATE TABLE IF NOT EXISTS config (
    clave TEXT PRIMARY KEY,
    valor TEXT
  );

  CREATE TABLE IF NOT EXISTS avisos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo TEXT NOT NULL DEFAULT 'aviso' CHECK (tipo IN ('aviso', 'noticia')),
    titulo TEXT NOT NULL,
    contenido TEXT NOT NULL,
    autor_nombre TEXT NOT NULL,
    creado_en TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS mensajes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    remitente_id INTEGER,
    remitente_nombre TEXT NOT NULL,
    destinatario_id INTEGER,
    destinatario_nombre TEXT,
    contenido TEXT NOT NULL,
    tipo TEXT NOT NULL DEFAULT 'directo' CHECK (tipo IN ('directo', 'sistema', 'relevo', 'intercambio')),
    leido INTEGER NOT NULL DEFAULT 0,
    creado_en TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (remitente_id) REFERENCES usuarios(id) ON DELETE SET NULL,
    FOREIGN KEY (destinatario_id) REFERENCES usuarios(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS ausencias (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profesor_id INTEGER,
    profesor_nombre TEXT NOT NULL,
    horario_id INTEGER,
    motivo TEXT NOT NULL,
    registrado_por INTEGER NOT NULL,
    fecha TEXT NOT NULL DEFAULT (datetime('now')),
    estado TEXT NOT NULL DEFAULT 'Pendiente',
    suplente_nombre TEXT,
    reemplazo_asignado TEXT,
    FOREIGN KEY (profesor_id) REFERENCES usuarios(id) ON DELETE SET NULL,
    FOREIGN KEY (horario_id) REFERENCES horarios(id) ON DELETE SET NULL,
    FOREIGN KEY (registrado_por) REFERENCES usuarios(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS lista_negra (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profesor_id INTEGER,
    profesor_nombre TEXT NOT NULL,
    motivo TEXT NOT NULL,
    fecha_ingreso TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (profesor_id) REFERENCES usuarios(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS solicitudes_cambio (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profesor_id INTEGER NOT NULL,
    profesor_nombre TEXT NOT NULL,
    horario_actual_id INTEGER NOT NULL,
    motivo TEXT NOT NULL,
    estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'emparejado', 'completado', 'cancelado')),
    creado_en TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (profesor_id) REFERENCES usuarios(id) ON DELETE CASCADE,
    FOREIGN KEY (horario_actual_id) REFERENCES horarios(id) ON DELETE CASCADE
  );
`);

// Registro de quién hizo qué y cuándo (sin claves foráneas: se conserva aunque se borre la cuenta o la clase).
db.exec(`
  CREATE TABLE IF NOT EXISTS historial (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha TEXT NOT NULL DEFAULT (datetime('now')),
    usuario_id INTEGER,
    usuario_nombre TEXT NOT NULL,
    accion TEXT NOT NULL,
    detalle TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_historial_fecha ON historial (fecha DESC, id DESC);
`);

// Migración: color opcional de cada clase (amarillo / azul / verde) para la vista por horas.
if (!db.prepare('PRAGMA table_info(horarios)').all().some(c => c.name === 'color')) {
  db.exec('ALTER TABLE horarios ADD COLUMN color TEXT');
}

// Migración: cada solicitud emparejada apunta a la de su pareja (el admin aprueba el intercambio).
if (!db.prepare('PRAGMA table_info(solicitudes_cambio)').all().some(c => c.name === 'pareja_id')) {
  db.exec('ALTER TABLE solicitudes_cambio ADD COLUMN pareja_id INTEGER');
}

function getConfig(clave, defecto = null) {
  const fila = db.prepare('SELECT valor FROM config WHERE clave = ?').get(clave);
  return fila ? fila.valor : defecto;
}
function setConfig(clave, valor) {
  db.prepare(`INSERT INTO config (clave, valor) VALUES (?, ?)
              ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor`).run(clave, String(valor));
}

module.exports = db;
module.exports.getConfig = getConfig;
module.exports.setConfig = setConfig;
