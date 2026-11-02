const express = require('express');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Ciudad de Artigas, Uruguay.
// Fuente principal: Open-Meteo (gratis, sin clave). Respaldo: MET Noruega (gratis, sin clave, pide un User-Agent con contacto).
const CIUDAD = { nombre: 'Artigas', pais: 'Uruguay', lat: -30.4, lon: -56.4667, zona: 'America/Montevideo' };
const CACHE_MS = 30 * 60 * 1000;   // el clima se pide como mucho una vez cada 30 minutos para todos los usuarios
const TIMEOUT_MS = 8000;
const REINTENTOS = 2;              // intentos por proveedor si responde 429 o un error de servidor
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

const URL_API = 'https://api.open-meteo.com/v1/forecast?' + new URLSearchParams({
  latitude: String(CIUDAD.lat),
  longitude: String(CIUDAD.lon),
  current: 'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m,is_day',
  daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max',
  timezone: CIUDAD.zona,
  forecast_days: '5',
  wind_speed_unit: 'kmh'
}).toString();

// MET Noruega (respaldo). Identifica a la app con un contacto; se puede cambiar con la variable CLIMA_CONTACTO.
const UTC_OFFSET_H = -3;   // Uruguay (UTC-3, sin horario de verano)
const CONTACTO = process.env.CLIMA_CONTACTO || 'https://github.com/betybitcar-ai/EDUSYN';
const URL_MET = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${CIUDAD.lat.toFixed(4)}&lon=${CIUDAD.lon.toFixed(4)}`;

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

// ---- Respaldo: MET Noruega ----
// Símbolos de MET Noruega → códigos WMO (para reutilizar las mismas descripciones e iconos).
const SIMBOLO_A_WMO = {
  clearsky: 0, fair: 1, partlycloudy: 2, cloudy: 3, fog: 45,
  lightrain: 61, rain: 63, heavyrain: 65,
  lightrainshowers: 80, rainshowers: 81, heavyrainshowers: 82,
  lightsleet: 66, sleet: 66, heavysleet: 67,
  lightsleetshowers: 66, sleetshowers: 66, heavysleetshowers: 67,
  lightsnow: 71, snow: 73, heavysnow: 75,
  lightsnowshowers: 85, snowshowers: 85, heavysnowshowers: 86
};

function simboloAWmo(simbolo) {
  if (!simbolo) return null;
  const base = String(simbolo).replace(/_(day|night|polartwilight)$/, '');
  if (base.includes('thunder')) return 95;
  return base in SIMBOLO_A_WMO ? SIMBOLO_A_WMO[base] : null;
}

// Convierte la respuesta de MET Noruega a la misma forma que Open-Meteo, para usar el mismo normalizar().
function desdeMetNo(api) {
  const serie = api && api.properties && api.properties.timeseries;
  if (!Array.isArray(serie) || !serie.length) throw new Error('Respuesta de MET Noruega incompleta.');
  const local = (t) => new Date(Date.parse(t) + UTC_OFFSET_H * 3600 * 1000);

  const dias = new Map();
  for (const p of serie) {
    const det = p.data && p.data.instant && p.data.instant.details;
    if (!det || !Number.isFinite(Date.parse(p.time))) continue;
    const l = local(p.time);
    const fecha = l.toISOString().slice(0, 10);
    if (!dias.has(fecha)) dias.set(fecha, { temps: [], vientos: [], lluvia: 0, simbolo: null, distancia: Infinity });
    const dia = dias.get(fecha);
    if (Number.isFinite(det.air_temperature)) dia.temps.push(det.air_temperature);
    if (Number.isFinite(det.wind_speed)) dia.vientos.push(det.wind_speed * 3.6);   // m/s → km/h

    // La lluvia se suma por hora cuando hay datos horarios; si no, por bloques de 6 horas (sin repetir).
    const n1 = p.data.next_1_hours, n6 = p.data.next_6_hours;
    const mm = n1 ? (n1.details && n1.details.precipitation_amount) : (n6 && n6.details && n6.details.precipitation_amount);
    if (Number.isFinite(mm)) dia.lluvia += mm;

    // Símbolo del día: el más cercano al mediodía local.
    const sim = (n6 && n6.summary && n6.summary.symbol_code) || (n1 && n1.summary && n1.summary.symbol_code);
    if (sim) {
      const dist = Math.abs(l.getUTCHours() - 12);
      if (dist < dia.distancia) { dia.distancia = dist; dia.simbolo = sim; }
    }
  }

  const fechas = [...dias.keys()].sort().slice(0, 5);
  const primero = serie[0];
  const det0 = (primero.data && primero.data.instant && primero.data.instant.details) || {};
  const prox = (primero.data && (primero.data.next_1_hours || primero.data.next_6_hours)) || {};
  const simActual = prox.summary && prox.summary.symbol_code;
  const horaLocal = local(primero.time).getUTCHours();
  const esDia = simActual ? !/_night$/.test(simActual) : (horaLocal >= 6 && horaLocal < 20);
  const maxDe = (arr) => arr.length ? Math.max(...arr) : null;
  const minDe = (arr) => arr.length ? Math.min(...arr) : null;

  return {
    current: {
      time: local(primero.time).toISOString().slice(0, 16),
      temperature_2m: det0.air_temperature,
      apparent_temperature: det0.air_temperature,
      relative_humidity_2m: det0.relative_humidity,
      precipitation: prox.details && prox.details.precipitation_amount,
      weather_code: simboloAWmo(simActual),
      wind_speed_10m: Number.isFinite(det0.wind_speed) ? det0.wind_speed * 3.6 : null,
      wind_direction_10m: det0.wind_from_direction,
      is_day: esDia ? 1 : 0
    },
    daily: {
      time: fechas,
      weather_code: fechas.map((f) => simboloAWmo(dias.get(f).simbolo)),
      temperature_2m_max: fechas.map((f) => maxDe(dias.get(f).temps)),
      temperature_2m_min: fechas.map((f) => minDe(dias.get(f).temps)),
      precipitation_probability_max: fechas.map(() => null),   // MET Noruega (compact) no la incluye
      precipitation_sum: fechas.map((f) => dias.get(f).lluvia),
      wind_speed_10m_max: fechas.map((f) => maxDe(dias.get(f).vientos))
    }
  };
}

// Pide un JSON con tiempo límite y reintentos (solo si responde 429 o un error de servidor).
async function pedirJson(url, headers, nombre) {
  let ultimoError;
  for (let intento = 0; intento < REINTENTOS; intento++) {
    if (intento > 0) await esperar(2000 * intento);   // espera 2 s antes del segundo intento
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const r = await fetch(url, { signal: ctl.signal, headers });
      if (r.ok) return await r.json();
      ultimoError = new Error(`${nombre} respondió ${r.status}.`);
      if (r.status !== 429 && r.status < 500) break;   // otros errores no se reintentan
    } catch (err) {
      ultimoError = err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw ultimoError;
}

// La función que consulta el clima se puede reemplazar (así los tests no usan internet).
// Primero Open-Meteo; si falla (por ejemplo 429), se usa MET Noruega.
let consultar = async () => {
  try {
    return await pedirJson(URL_API, { Accept: 'application/json' }, 'El servicio del clima');
  } catch (errPrincipal) {
    console.error('clima: Open-Meteo falló (' + errPrincipal.message + '). Probando MET Noruega.');
    try {
      const api = await pedirJson(URL_MET, { Accept: 'application/json', 'User-Agent': `Cuadrilla/1.0 (${CONTACTO})` }, 'MET Noruega');
      return desdeMetNo(api);
    } catch (errRespaldo) {
      throw new Error(`${errPrincipal.message} / ${errRespaldo.message}`);
    }
  }
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
  normalizar, describir, direccionViento, obtenerClima, desdeMetNo, CIUDAD, URL_API,
  usarConsulta(fn) { consultar = fn; cache = { datos: null, en: 0 }; pendiente = null; },
  vaciarCache() { cache = { datos: null, en: 0 }; pendiente = null; }
};
