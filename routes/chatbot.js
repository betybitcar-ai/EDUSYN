const express = require('express');
const { requireRole } = require('../middleware/auth');
const { responder, detectarIntencion } = require('../lib/chatbot');
const entrega = require('../lib/entregaHorarioLib');

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

// Lee la foto de una planilla de horario y la transcribe a líneas "Lunes 07:30-09:00 3°MA liceo".
async function transcribirFoto(dataUrl) {
  if (!cliente) {
    const { GoogleGenAI } = require('@google/genai');
    cliente = new GoogleGenAI({ apiKey: claveIA() });
  }
  const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(dataUrl);
  const prompt = 'Esta es la foto del horario semanal de un profesor. Transcribilo con una clase por línea, con este formato exacto: ' +
    '"Día HH:MM-HH:MM curso lugar", por ejemplo "Lunes 07:30-09:00 3°MA liceo". Días: Lunes a Sábado. El lugar es liceo, UTU o coordinación (si la planilla no lo dice, omitilo). ' +
    'Si dos horas seguidas son del mismo grupo, unilas en una sola clase. Si algo no se lee bien, escribilo igual pero agregá " ?" al final de la línea. ' +
    'No inventes clases ni agregues explicaciones: respondé solo con las líneas.';
  let timer;
  const limite = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('La IA tardó demasiado.')), 40000); });
  try {
    const r = await Promise.race([
      cliente.models.generateContent({ model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
        contents: [{ role: 'user', parts: [{ inlineData: { mimeType: m[1], data: m[2] } }, { text: prompt }] }] }),
      limite
    ]);
    return String(r.text || '').replace(/```[a-z]*\n?|```/g, '').trim();
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
  // Un horario semanal completo puede ser largo: se permite más texto solo para entregarlo.
  const limite = ['entregar_horario', 'cargar_horario_profesor'].includes(detectarIntencion(mensaje)) ? 4000 : 1000;
  if (mensaje.length > limite) return res.status(400).json({ error: `El mensaje es demasiado largo (máximo ${limite} caracteres).` });

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

// POST /api/chatbot/foto { imagen: "data:image/jpeg;base64,…", profesor?: "Nombre" }
//  - profesor: la foto es de su horario. admin: la foto es del horario de `profesor` (debe tener cuenta).
// La foto SIEMPRE llega a "Por profesor" del admin y el profesor queda con el horario entregado (puede usar todo el sistema).
// Si hay IA y la lectura es limpia, además se pasa a clases solas; si no, el admin la ve y la transcribe, y el texto leído
// vuelve acá para que se revise y se envíe por el chat.
router.post('/foto', requireRole('profesor', 'admin'), async (req, res) => {
  const { imagen, profesor } = req.body || {};
  if (typeof imagen !== 'string' || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(imagen)) {
    return res.status(400).json({ error: 'Mandá una foto en formato JPG, PNG o WebP.' });
  }
  const u = req.session.user;
  let destino = { id: u.id, nombre: u.nombre };
  if (u.rol === 'admin') {
    const coinciden = typeof profesor === 'string' ? entrega.buscarProfesores(profesor) : [];
    if (coinciden.length !== 1) return res.status(400).json({ error: 'Elegí a qué profesor pertenece la foto.' });
    if (!coinciden[0].id) return res.status(400).json({ error: `${coinciden[0].nombre} todavía no tiene cuenta, así que no puedo guardarle el horario.` });
    destino = { id: coinciden[0].id, nombre: coinciden[0].nombre };
  }
  try {
    let texto = '', conIA = Boolean(claveIA());
    if (conIA) {
      try { texto = await transcribirFoto(imagen); }
      catch (e) { console.error('[chatbot/foto]', e.message); conIA = false; }   // la IA falló: igual se entrega la foto
    }
    const { clases, errores } = entrega.parsearHorario(texto);
    const listo = clases.length > 0 && errores.length === 0 && !/\?\s*$/m.test(texto);
    let total = null;
    if (listo) {   // lectura limpia: pasa a clases y el admin la ve armada en "Por profesor"
      total = entrega.guardarEntrega(destino, clases).total;
      entrega.guardarFoto(destino, imagen, u, { avisar: false });
    } else {
      entrega.guardarFoto(destino, imagen, u);
    }
    res.json({ estado: listo ? 'entregado' : 'foto_recibida', texto: texto.slice(0, 4000), total, con_ia: conIA, profesor: destino.nombre });
  } catch (e) {
    console.error('[chatbot/foto]', e);
    res.status(500).json({ error: 'No pude guardar la foto ahora. Probá de nuevo o escribí el horario.' });
  }
});

module.exports = router;
