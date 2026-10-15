// Crea datos de demostración: 1 admin, 4 profesores y una semana de clases (en borrador).
// Uso: npm run seed
require('dotenv').config();
if (process.env.NODE_ENV === 'production' && process.env.SEED_FORZAR !== '1') {
  console.error('El seed crea cuentas con contraseñas conocidas (admin123, profe123): no se ejecuta en producción.');
  process.exit(1);
}
const bcrypt = require('bcryptjs');
const db = require('./database');

function usuario(nombre, email, password, rol) {
  const ya = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(email);
  if (ya) return ya;
  const info = db.prepare('INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES (?, ?, ?, ?)')
    .run(nombre, email, bcrypt.hashSync(password, 10), rol);
  return db.prepare('SELECT * FROM usuarios WHERE id = ?').get(info.lastInsertRowid);
}

const admin = usuario('Administrador', 'admin@cuadrilla.com', 'admin123', 'admin');
const ana = usuario('Ana Pérez', 'ana@cuadrilla.com', 'profe123', 'profesor');
const carlos = usuario('Carlos Gómez', 'carlos@cuadrilla.com', 'profe123', 'profesor');
const lucia = usuario('Lucía Fernández', 'lucia@cuadrilla.com', 'profe123', 'profesor');
const martin = usuario('Martín Rodríguez', 'martin@cuadrilla.com', 'profe123', 'profesor');
usuario('Alumno Demo', 'alumno@cuadrilla.com', 'alumno123', 'alumno');

if (db.prepare('SELECT COUNT(*) AS n FROM horarios').get().n === 0) {
  const clases = [
    ['Lunes', '08:00', '09:30', 'Matemáticas', 'Aula 101', ana],
    ['Lunes', '09:45', '11:15', 'Física', 'Aula 102', martin],
    ['Lunes', '11:30', '13:00', 'Programación', 'Laboratorio 3', lucia],
    ['Martes', '08:00', '09:30', 'Historia', 'Aula 202', carlos],
    ['Martes', '09:45', '11:15', 'Inglés', 'Aula 101', lucia],
    ['Martes', '11:30', '13:00', 'Matemáticas', 'Aula 101', ana],
    ['Miércoles', '08:00', '09:30', 'Química', 'Laboratorio 1', martin],
    ['Miércoles', '09:45', '11:15', 'Literatura', 'Aula 203', carlos],
    ['Miércoles', '11:30', '13:00', 'Programación', 'Laboratorio 3', lucia],
    ['Jueves', '08:00', '09:30', 'Física', 'Aula 102', martin],
    ['Jueves', '09:45', '11:15', 'Historia', 'Aula 202', carlos],
    ['Jueves', '11:30', '13:00', 'Educación Física', 'Gimnasio', null],
    ['Viernes', '08:00', '09:30', 'Inglés', 'Aula 101', lucia],
    ['Viernes', '09:45', '11:15', 'Matemáticas', 'Aula 101', ana],
    ['Viernes', '11:30', '13:00', 'Arte', 'Taller', null]
  ];
  const ins = db.prepare(`INSERT INTO horarios (dia, hora_inicio, hora_fin, materia, salon, estado, profesor_id, profesor_nombre, creado_por)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const [dia, ini, fin, materia, salon, p] of clases) {
    ins.run(dia, ini, fin, materia, salon, p ? 'ocupado' : 'disponible', p ? p.id : null, p ? p.nombre : null, admin.id);
  }
}
console.log('Listo. Cuentas de prueba:');
console.log('  admin    admin@cuadrilla.com  / admin123');
console.log('  profesor ana@cuadrilla.com    / profe123  (también carlos, lucia, martin)');
console.log('  alumno   alumno@cuadrilla.com / alumno123');
