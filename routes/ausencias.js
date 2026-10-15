const express = require('express');
const db = require('../db/database');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

// ==========================================
// 1. LISTAR AUSENCIAS (GET /api/ausencias)
// ==========================================
// Devuelve todas las ausencias para los administradores, o solo las propias para los profesores.
router.get('/', requireRole('profesor', 'admin'), (req, res) => {
  const { user } = req.session;
  const selectConHorario = `
    SELECT 
      a.*,
      h.dia AS horario_dia,
      h.hora_inicio AS horario_hora_inicio,
      h.hora_fin AS horario_hora_fin,
      h.materia AS horario_materia
    FROM ausencias a
    LEFT JOIN horarios h ON h.id = a.horario_id
  `;
  let ausencias;

  if (user.rol === 'admin') {
    ausencias = db.prepare(`${selectConHorario} ORDER BY a.fecha DESC`).all();
  } else {
    // Los profesores solo ven sus propias ausencias/faltas en su calendario
    ausencias = db.prepare(`${selectConHorario} WHERE a.profesor_id = ? ORDER BY a.fecha DESC`).all(user.id);
  }

  res.json({ ausencias });
});

// ==========================================
// 2. REGISTRAR UNA AUSENCIA (POST /api/ausencias)
// ==========================================
// Permite a los profesores reportar sus faltas y a los administradores registrar ausencias de cualquier docente.
router.post('/', requireRole('profesor', 'admin'), (req, res) => {
  const { user } = req.session;
  const { 
    profesor_id, 
    profesor_nombre, 
    horario_id, 
    motivo, 
    fecha, 
    estado,         // 'Justificada', 'Injustificada', 'Pendiente'
    suplente_nombre // Profesor que cubre la clase si aplica
  } = req.body;

  if (!motivo) {
    return res.status(400).json({ error: 'El motivo de la ausencia es obligatorio.' });
  }

  // Si es profesor, la ausencia es sobre sí mismo salvo que un admin especifique otro
  const idProfesor = user.rol === 'profesor' ? user.id : (profesor_id || user.id);
  const nombreProfesor = user.rol === 'profesor' ? user.nombre : (profesor_nombre || user.nombre);
  
  // Fecha predeterminada: hoy si no se envía
  const fechaAusencia = fecha || new Date().toISOString().split('T')[0];
  
  // Estado predeterminado: Pendiente si lo carga el profesor, Justificada si lo hace el admin directamente
  const estadoAusencia = estado || (user.rol === 'admin' ? 'Justificada' : 'Pendiente');
  const nombreSuplente = suplente_nombre || 'Sin asignar';

  const info = db.prepare(`
    INSERT INTO ausencias (profesor_id, profesor_nombre, horario_id, motivo, fecha, estado, suplente_nombre, registrado_por)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(idProfesor, nombreProfesor, horario_id || null, motivo, fechaAusencia, estadoAusencia, nombreSuplente, user.id);

  const ausencia = db.prepare('SELECT * FROM ausencias WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ mensaje: 'Ausencia registrada correctamente.', ausencia });
});

// ==========================================
// 3. ACTUALIZAR ESTADO DE AUSENCIA (PUT /api/ausencias/:id/estado)
// ==========================================
// Exclusivo para administradores (ej. aprobar certificado médico o cambiar a justificada/injustificada)
router.put('/:id/estado', requireRole('admin'), (req, res) => {
  const { id } = req.params;
  const { estado } = req.body; 

  if (!['Justificada', 'Injustificada', 'Pendiente'].includes(estado)) {
    return res.status(400).json({ error: 'Estado no válido. Debe ser Justificada, Injustificada o Pendiente.' });
  }

  const resultado = db.prepare(`UPDATE ausencias SET estado = ? WHERE id = ?`).run(estado, id);

  if (resultado.changes === 0) {
    return res.status(404).json({ error: 'Ausencia no encontrada.' });
  }

  res.json({ mensaje: `Ausencia actualizada exitosamente a estado: ${estado}` });
});

module.exports = router;