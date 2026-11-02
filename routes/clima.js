const express = require('express');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Ciudad de Artigas, Uruguay. Open-Meteo es gratuito y no necesita clave.
const CIUDAD = { nombre: 'Artigas', pais: 'Uruguay', lat: -30.4, lon: -56.4667, zona: 'America/Montevideo' };
const CACHE_MS = 10 * 60 * 1000;   // el clima se pide como mucho una vez cada 10 minutos para todos los usuarios
const TIMEOUT_MS = 8000;

const URL_API = 'https://api.open-meteo.com/v1/forecast?' + new URLSearchParams({
  latitude: String(CIUDAD.lat),
  longitude: String(CIUDAD.lon),
  current: 'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m,is_day',
  daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max',
  timezone: CIUDAD.zona,
  forecast_days: '5',
  wind_speed_unit: 'kmh'
}).toString();

// Códigos WMO → descripción en español + emoji (día / noche).
const CODIGOS = {
  0: ['Despejado', '☀️', '🌙'],
  1: ['Mayormente despejado', '🌤️', '🌙'],
  2: ['Parcialmente nublado', '⛅', '☁️'],
  3: ['Nublado', '☁️', '☁️'],
  45: ['Niebla', '🌫️', '🌫️'],
  48: ['Niebla con escarcha', '🌫️', '🌫️'],
  51: ['Llovizna leve', '🌦️', '🌧️'],
  53: ['Llovizna', '🌦️', '🌧️'],
  55: ['Llovizna intensa', '🌧️', '🌧️'],
  56: ['Llovizna helada', '🌧️', '🌧️'],
  57: ['Llovizna helada intensa', '🌧️', '🌧️'],
  61: ['Lluvia leve', '🌦️', '🌧️'],
  63: ['Lluvia', '🌧️', '🌧️'],
  65: ['Lluvia fuerte', '🌧️', '🌧️'],
  66: ['Lluvia helada', '🌧️', '🌧️'],
  67: ['Lluvia helada fuerte', '🌧️', '🌧️'],
  71: ['Nevada leve', '🌨️', '🌨️'],
  73: ['Nevada', '🌨️', '🌨️'],
  75: ['Nevada fuerte', '❄️', '❄️'],
  77: ['Granizo fino', '🌨️', '🌨️'],
  80: ['Chubascos leves', '🌦️', '🌧️'],
  81: ['Chubascos', '🌧️', '🌧️'],
  82: ['Chubascos fuertes', '⛈️', '⛈️'],
  85: ['Chubascos de nieve', '🌨️', '🌨️'],
  86: ['Chubascos de nieve fuertes', '❄️', '❄️'],
  95: ['Tormenta', '⛈️', '⛈️'],
  96: ['Tormenta con granizo', '⛈️', '⛈️'],
  99: ['Tormenta con granizo fuerte', '⛈️', '⛈️']
};

function describir(codigo, esDia = true) {
  const c = CODIGOS[codigo] || ['Sin datos', '🌡️', '🌡️'];
  return { texto: c[0], icono: esDia ? c[1] : c[2] };
}

const PUNTOS = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
const direccionViento = (grados) => Number.isFinite(grados) ? PUNTOS[Math.round((((grados % 360) + 360) % 360) / 45) % 8] : '';

const redondear = (n, d = 0) => Number.isFinite(n) ? Number(n.toFixed(d)) : null;

// Convierte la respuesta de Open-Meteo en lo que usa la pantalla. Lanza si la respuesta no tiene lo esencial.
function normalizar(api) {
  const c = api && api.current, d = api && api.daily;
  if (!c || !d || !Array.isArray(d.time)) throw new Error('Respuesta del servicio del clima incompleta.');
  const esDia = c.is_day !== 0;
  const actual = describir(c.weather_code, esDia);
  return {
    ciudad: `${CIUDAD.nombre}, ${CIUDAD.pais}`,
    actualizado: c.time || null,
    actual: {
      temperatura: redondear(c.temperature_2m),
      sensacion: redondear(c.apparent_temperature),
      humedad: redondear(c.relative_humidity_2m),
      lluvia_mm: redondear(c.precipitation, 1),
      viento_kmh: redondear(c.wind_speed_10m),
      viento_dir: direccionViento(c.wind_direction_10m),
      es_dia: esDia,
      texto: actual.texto,
      icono: actual.icono
    },
    dias: d.time.map((fecha, i) => {
      const info = describir(d.weather_code[i], true);
      return {
        fecha,
        texto: info.texto,
        icono: info.icono,
        max: redondear(d.temperature_2m_max[i]),
        min: redondear(d.temperature_2m_min[i]),
        prob_lluvia: redondear(d.precipitation_probability_max && d.precipitation_probability_max[i]),
        lluvia_mm: redondear(d.precipitation_sum && d.precipitation_sum[i], 1),
        viento_max_kmh: redondear(d.wind_speed_10m_max && d.wind_speed_10m_max[i])
      };
    })
  };
}

// La función que consulta a Open-Meteo se puede reemplazar (así los tests no usan internet).
let consultar = async () => {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(URL_API, { signal: ctl.signal, headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`El servicio del clima respondió ${r.status}.`);
    return await r.json();
  } finally { clearTimeout(timer); }
};

let cache = { datos: null, en: 0 };
let pendiente = null;

async function obtenerClima(ahora = Date.now()) {
  if (cache.datos && ahora - cache.en < CACHE_MS) return { ...cache.datos, desactualizado: false };
  // Si ya hay una consulta en vuelo, todos esperan la misma (no se pide varias veces a la vez).
  if (!pendiente) {
    pendiente = consultar().then(normalizar).then(d => { cache = { datos: d, en: ahora }; return d; })
      .finally(() => { pendiente = null; });
  }
  try {
    return { ...(await pendiente), desactualizado: false };
  } catch (err) {
    // Sin conexión: se muestra el último dato guardado, marcado como desactualizado.
    if (cache.datos) return { ...cache.datos, desactualizado: true };
    throw err;
  }
}

// GET /api/clima - clima actual y pronóstico de 5 días en Artigas. Todos los roles con sesión.
router.get('/', requireAuth, async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await obtenerClima());
  } catch (err) {
    console.error('clima:', err.message);
    res.status(502).json({ error: 'No se pudo obtener el clima de Artigas en este momento. Probá de nuevo en unos minutos.' });
  }
});

module.exports = router;
module.exports._interno = {
  normalizar, describir, direccionViento, obtenerClima, CIUDAD, URL_API,
  usarConsulta(fn) { consultar = fn; cache = { datos: null, en: 0 }; pendiente = null; },
  vaciarCache() { cache = { datos: null, en: 0 }; pendiente = null; }
};
