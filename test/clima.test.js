// Clima de Artigas: lo ven todos los roles (con sesión), se guarda en caché y no depende de internet para las pruebas.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cuadrilla-clima-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.BACKUP_DIR = path.join(tmp, 'backups');

const clima = require('../routes/clima')._interno;

// Respuesta con la forma de Open-Meteo.
const respuestaApi = () => ({
  current: { time: '2026-10-23T14:00', temperature_2m: 24.6, apparent_temperature: 25.2, relative_humidity_2m: 48, precipitation: 0,
    weather_code: 2, wind_speed_10m: 14.4, wind_direction_10m: 200, is_day: 1 },
  daily: {
    time: ['2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27'],
    weather_code: [2, 61, 95, 0, 3],
    temperature_2m_max: [27.1, 22.3, 21.9, 26.0, 25.4],
    temperature_2m_min: [14.2, 13.8, 15.1, 12.0, 13.3],
    precipitation_probability_max: [10, 70, 90, 0, 20],
    precipitation_sum: [0, 5.2, 18.4, 0, 0.1],
    wind_speed_10m_max: [22, 30, 45, 15, 18]
  }
});

test('consulta a Open-Meteo con las coordenadas de Artigas', () => {
  assert.equal(clima.CIUDAD.nombre, 'Artigas');
  const url = new URL(clima.URL_API);
  assert.equal(url.hostname, 'api.open-meteo.com');
  assert.equal(url.searchParams.get('latitude'), '-30.4');
  assert.equal(url.searchParams.get('longitude'), '-56.4667');
  assert.equal(url.searchParams.get('timezone'), 'America/Montevideo');
});

test('normalizar: traduce códigos, redondea y da la dirección del viento', () => {
  const r = clima.normalizar(respuestaApi());
  assert.equal(r.ciudad, 'Artigas, Uruguay');
  assert.equal(r.actual.temperatura, 25);
  assert.equal(r.actual.texto, 'Parcialmente nublado');
  assert.equal(r.actual.icono, '⛅');
  assert.equal(r.actual.viento_dir, 'S');       // 200° → sur
  assert.equal(r.dias.length, 5);
  assert.equal(r.dias[1].texto, 'Lluvia leve');
  assert.equal(r.dias[2].texto, 'Tormenta');
  assert.equal(r.dias[2].prob_lluvia, 90);
  assert.throws(() => clima.normalizar({}), /incompleta/);
  assert.equal(clima.describir(0, false).icono, '🌙', 'de noche el cielo despejado es una luna');
  assert.equal(clima.describir(12345).texto, 'Sin datos');
});

test('caché: varias personas no generan varias consultas', async () => {
  let llamadas = 0;
  clima.usarConsulta(async () => { llamadas++; return respuestaApi(); });
  const t0 = Date.now();
  await Promise.all([clima.obtenerClima(t0), clima.obtenerClima(t0), clima.obtenerClima(t0)]);
  assert.equal(llamadas, 1, 'consultas simultáneas comparten una sola');
  await clima.obtenerClima(t0 + 60_000);
  assert.equal(llamadas, 1, 'a 1 minuto sigue en caché');
  await clima.obtenerClima(t0 + 11 * 60_000);
  assert.equal(llamadas, 2, 'a los 11 minutos vuelve a consultar');
});

test('sin conexión: devuelve el último dato guardado marcado como desactualizado', async () => {
  let falla = false;
  clima.usarConsulta(async () => { if (falla) throw new Error('sin red'); return respuestaApi(); });
  const t0 = Date.now();
  const ok = await clima.obtenerClima(t0);
  assert.equal(ok.desactualizado, false);
  falla = true;
  const viejo = await clima.obtenerClima(t0 + 20 * 60_000);
  assert.equal(viejo.desactualizado, true);
  assert.equal(viejo.actual.temperatura, 25);
  clima.vaciarCache();
  await assert.rejects(() => clima.obtenerClima(), /sin red/, 'sin dato guardado, el error sube');
});

test('API: exige sesión y la ven admin, profesor y alumno', async () => {
  clima.usarConsulta(async () => respuestaApi());
  const app = require('../server');
  const servidor = app.listen(0);
  await new Promise(r => servidor.once('listening', r));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  const pedir = async (ruta, opts = {}) => {
    const r = await fetch(base + ruta, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
    return { status: r.status, data: await r.json().catch(() => ({})), cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
  };
  const registrar = (nombre, email, rol, codigo) =>
    pedir('/api/auth/register', { method: 'POST', body: JSON.stringify({ nombre, email, password: 'secreto1', rol, codigo }) });

  try {
    assert.equal((await pedir('/api/clima')).status, 401, 'sin sesión no se puede');
    const usuarios = {
      admin: await registrar('Admin', 'admin@c.com', 'admin', 'ADMIN-2026'),
      profesor: await registrar('Prof Nueva', 'prof@c.com', 'profesor', 'PROFE-2026'),
      alumno: await registrar('Alu', 'alu@c.com', 'alumno')
    };
    for (const [rol, u] of Object.entries(usuarios)) {
      assert.equal(u.status, 201, `registro de ${rol}`);
      const r = await pedir('/api/clima', { headers: { cookie: u.cookie } });
      assert.equal(r.status, 200, `${rol} ve el clima`);
      assert.equal(r.data.ciudad, 'Artigas, Uruguay');
      assert.equal(r.data.dias.length, 5);
    }
    // Si el servicio cae y no hay nada guardado, responde un error claro (no se cuelga).
    clima.usarConsulta(async () => { throw new Error('caído'); });
    const caido = await pedir('/api/clima', { headers: { cookie: usuarios.alumno.cookie } });
    assert.equal(caido.status, 502);
    assert.match(caido.data.error, /clima de Artigas/);
  } finally { servidor.close(); }
});
