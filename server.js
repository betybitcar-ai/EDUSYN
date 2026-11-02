require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');

const app = express();
// Detrás de un proxy (Render, Railway, nginx…) define TRUST_PROXY=1 para que el límite de intentos use la IP real.
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1);
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'cambia-este-secreto-en-produccion',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production'
  }
}));

app.use('/api/auth', require('./routes/auth'));
app.get('/api/me', (req, res) => req.session.user
  ? res.json(req.session.user)
  : res.status(401).json({ error: 'No hay sesión activa.' }));

app.use('/api/horarios', require('./routes/horarios'));
app.use('/api/historial', require('./routes/historial'));
app.use('/api/exportar', require('./routes/exportar'));
app.use('/api/cambios', require('./routes/cambios'));
app.use('/api/figma', require('./routes/figma'));
app.use('/api/avisos', require('./routes/avisos'));
app.use('/api/ausencias', require('./routes/ausencias'));
app.use('/api/lista-negra', require('./routes/listaNegra'));
app.use('/api/mensajes', require('./routes/mensajes'));
// Clima de Artigas: lo ven todos los roles con sesión.
app.use('/api/clima', require('./routes/clima'));

// Asistente: funciona sin IA; con GEMINI_API_KEY además responde preguntas libres.
app.use('/api/chatbot', require('./routes/chatbot'));
// Backups: exclusivo del administrador (el control de rol está dentro del router).
app.use('/api/backup', require('./routes/backup'));

app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada.' }));

// Errores de la API siempre en JSON (p. ej. un cuerpo JSON mal formado).
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'El cuerpo de la petición no es JSON válido.' });
  console.error(err);
  res.status(err.status || 500).json({ error: 'Error interno del servidor.' });
});

if (require.main === module) {
  require('./lib/seguridad').verificarArranque();   // en producción no arranca con claves de ejemplo
  app.listen(PORT, () => console.log(`Cuadrilla corriendo en http://localhost:${PORT}`));
  require('./lib/cuentasProfesores').crearCuentasProfesores();   // una cuenta por cada profesor de la plantilla (si falta)
  require('./lib/horarioSilvio').cargarHorarioSilvio();       // horario de Silvio Fagundez (una sola vez)
  require('./lib/horarioSaul').cargarHorarioSaul();           // horario de Saúl Pereira (una sola vez)
  require('./lib/horarioValentina').cargarHorarioValentina(); // horario de Valentina Rodríguez (una sola vez)
  require('./lib/horariosLib').vincularBloquesPorNombre();   // une clases y cuentas de profesores ya existentes
  require('./lib/backupLib').iniciarBackupAutomatico();   // backup diario (BACKUP_AUTO=0 para apagarlo)
}
module.exports = app;
