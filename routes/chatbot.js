const express = require('express');
const { requireRole } = require('../middleware/auth');
const { responder } = require('../lib/chatbot');

const router = express.Router();

const claveIA = () => process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
let cliente = null;

// La IA es opcional: sin clave el asistente responde igual con sus funciones de horarios.
async function generarIA({ system, historial, mensaje }) {
  if (!cliente) {
    const { GoogleGenAI } = require('@google/genai');   // se carga recién acá: si falta, no se cae la app
    cliente = new GoogleGenAI({ apiKey: claveIA() });
  }
  const contents = [
    ...historial.map(m => ({ role: m.rol === 'yo' ? 'user' : 'model', parts: [{ text: m.texto }] })),
    { role: 'user', parts: [{ text: mensaje }] }
  ];
  let timer;
  const limite = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('La IA tardó demasiado.')), 25000); });
  try {
    const r = await Promise.race([
      cliente.models.generateContent({ model: process.env.GEMINI_MODEL || 'gemini-2.5-flash', contents, config: { systemInstruction: system } }),
      limite
    ]);
    return r.text;
  } finally { clearTimeout(timer); }
}

// Últimos mensajes de la conversación (el cliente los manda), limpios y empezando por uno del usuario.
function limpiarHistorial(h) {
  if (!Array.isArray(h)) return [];
  const out = h.filter(m => m && ['yo', 'bot'].includes(m.rol) && typeof m.texto === 'string' && m.texto.trim())
    .map(m => ({ rol: m.rol, texto: m.texto.slice(0, 1500) })).slice(-10);
  while (out.length && out[0].rol !== 'yo') out.shift();
  return out;
}

// POST /api/chatbot { mensaje, horarioId?, historial? } - solo profesores y administradores
router.post('/', requireRole('profesor', 'admin'), async (req, res) => {
  const { mensaje, horarioId, historial } = req.body || {};
  if (typeof mensaje !== 'string' || !mensaje.trim()) return res.status(400).json({ error: 'Escribí un mensaje.' });
  if (mensaje.length > 1000) return res.status(400).json({ error: 'El mensaje es demasiado largo (máximo 1000 caracteres).' });

  try {
    const respuesta = await responder({
      mensaje: mensaje.trim(),
      horarioId: Number.isInteger(Number(horarioId)) && Number(horarioId) > 0 ? Number(horarioId) : null,
      historial: limpiarHistorial(historial),
      usuario: req.session.user
    }, { generarIA: claveIA() ? generarIA : null });
    res.json(respuesta);
  } catch (e) {
    console.error('[chatbot]', e);
    res.status(500).json({ error: 'Ocurrió un error interno al procesar tu solicitud en el asistente.' });
  }
});

module.exports = router;
