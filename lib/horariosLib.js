const db = require('../db/database');

const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

// Minúsculas, sin tildes, sin títulos ("Prof.", "Lic."), sin signos: sirve para comparar nombres.
function normalizar(txt = '') {
  return String(txt)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\b(prof(esor|esora)?|doc(ente)?|lic|mtro|mtra|dr|dra|sr|sra)\b\.?/g, ' ')
    .replace(/[^a-z0-9ñ ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizarDia(txt = '') {
  const n = normalizar(txt);
  return DIAS.find(d => normalizar(d) === n) || null;
}

function aMinutos(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function normalizarHora(txt) {
  const m = /^(\d{1,2})[:.h](\d{2})$/.exec(String(txt).trim());
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

// Valida un bloque y devuelve { error } o { bloque } ya normalizado.
function validarBloque(entrada) {
  const dia = normalizarDia(entrada.dia);
  const hora_inicio = normalizarHora(entrada.hora_inicio);
  const hora_fin = normalizarHora(entrada.hora_fin);
  const materia = String(entrada.materia || '').trim();
  const salon = String(entrada.salon || '').trim() || null;

  if (!dia) return { error: `Día no válido (${DIAS.join(', ')}).` };
  if (!hora_inicio || !hora_fin) return { error: 'Las horas deben tener formato HH:MM.' };
  if (aMinutos(hora_fin) <= aMinutos(hora_inicio)) return { error: 'La hora de fin debe ser posterior a la de inicio.' };
  if (!materia) return { error: 'Falta la materia.' };
  if (materia.length > 80 || (salon && salon.length > 40)) return { error: 'Materia o salón demasiado largos.' };
  return { bloque: { dia, hora_inicio, hora_fin, materia, salon } };
}

// Busca choques de horario: mismo profesor o mismo salón en el mismo día con horas superpuestas.
function buscarConflicto({ dia, hora_inicio, hora_fin, salon, profesor_id, profesor_nombre }, excluirId = null) {
  const excluidos = [].concat(excluirId ?? []);   // un id, varios (intercambios) o ninguno
  const filas = db.prepare('SELECT * FROM horarios WHERE dia = ?').all(dia).filter(f => !excluidos.includes(f.id));
  const ini = aMinutos(hora_inicio), fin = aMinutos(hora_fin);
  for (const f of filas) {
    const se_pisan = ini < aMinutos(f.hora_fin) && fin > aMinutos(f.hora_inicio);
    if (!se_pisan) continue;
    const mismoProfe = (profesor_id && f.profesor_id === profesor_id) ||
      (!profesor_id && profesor_nombre && !f.profesor_id && f.profesor_nombre && normalizar(f.profesor_nombre) === normalizar(profesor_nombre));
    if (mismoProfe) {
      return `${f.profesor_nombre} ya tiene ${f.materia} el ${dia} de ${f.hora_inicio} a ${f.hora_fin}.`;
    }
    if (salon && f.salon && normalizar(f.salon) === normalizar(salon)) {
      return `${f.salon} ya está ocupado el ${dia} de ${f.hora_inicio} a ${f.hora_fin} (${f.materia}).`;
    }
  }
  return null;
}

// Orden Lunes → Sábado para consultas SQL (alfabéticamente "Jueves" quedaría antes que "Lunes").
const ORDEN_DIA_SQL = `CASE dia WHEN 'Lunes' THEN 1 WHEN 'Martes' THEN 2 WHEN 'Miércoles' THEN 3
  WHEN 'Jueves' THEN 4 WHEN 'Viernes' THEN 5 WHEN 'Sábado' THEN 6 ELSE 7 END`;

function horariosOrdenados() {
  return db.prepare(`SELECT * FROM horarios ORDER BY ${ORDEN_DIA_SQL}, hora_inicio`).all();
}

// Faltas a partir de las cuales un profesor entra a la Lista Negra (una sola definición para toda la app).
const LIMITE_FALTAS = Number(process.env.LIMITE_FALTAS) || 30;

function listaNegraActual() {
  return db.prepare(`
    SELECT profesor_id, profesor_nombre, COUNT(*) AS total_faltas, MAX(fecha) AS ultima_falta
    FROM ausencias
    WHERE profesor_id IS NOT NULL
    GROUP BY profesor_id, profesor_nombre
    HAVING COUNT(*) >= ?
    ORDER BY total_faltas DESC
  `).all(LIMITE_FALTAS);
}

function listaProfesores() {
  return db.prepare("SELECT id, nombre, email FROM usuarios WHERE rol = 'profesor' ORDER BY nombre").all();
}

// Para el selector del admin: cuentas de profesores + los de la plantilla que todavía no tienen cuenta.
function profesoresParaSelector() {
  const { PLANTILLA } = require('./profesoresPlantilla');
  const cuentas = listaProfesores();
  const turnoDe = (nombre) => (PLANTILLA.find(p => mismoNombre(p.nombre, nombre)) || {}).turno || null;
  const lista = cuentas.map(c => ({ id: c.id, nombre: c.nombre, email: c.email, turno: turnoDe(c.nombre), cuenta: true }));
  for (const p of PLANTILLA) {
    if (!cuentas.some(c => mismoNombre(c.nombre, p.nombre))) lista.push({ id: null, nombre: p.nombre, turno: p.turno, cuenta: false });
  }
  return lista.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

// Nombre canónico de la plantilla para un texto ("jonhy vasconcellos" → "Jonhy Vasconcello"), o null.
function nombreDePlantilla(texto) {
  const { PLANTILLA } = require('./profesoresPlantilla');
  const p = PLANTILLA.find(x => mismoNombre(x.nombre, texto));
  return p ? p.nombre : null;
}

// Distancia de edición (para tolerar erratas como "Fagunde" / "Fagundez").
function distancia(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length][b.length];
}
const palabraIgual = (a, b) => a === b || (a.length >= 5 && b.length >= 5 && distancia(a, b) <= 1);

// ¿Es la misma persona? Sin tildes ni mayúsculas, ignora el orden y las palabras de más
// ("Ana Li Rodríguez" = "Ana Rodríguez"), y tolera una errata por palabra. Pide al menos 2 palabras.
function mismoNombre(a, b) {
  const ta = normalizar(a).split(' ').filter(Boolean), tb = normalizar(b).split(' ').filter(Boolean);
  if (!ta.length || !tb.length) return false;
  if (ta.join(' ') === tb.join(' ')) return true;
  const [corto, largo] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  if (corto.length < 2) return false;
  const usadas = new Set();
  return corto.every(w => {
    const i = largo.findIndex((x, k) => !usadas.has(k) && palabraIgual(w, x));
    if (i < 0) return false;
    usadas.add(i);
    return true;
  });
}

// Busca un profesor registrado cuyo nombre coincida con el texto (p. ej. "Prof. Ana Pérez").
// Solo devuelve resultado si hay UNA sola coincidencia (si hay dudas, no adivina).
function buscarProfesorPorNombre(texto, profesores = listaProfesores()) {
  const n = normalizar(texto);
  if (!n) return null;
  const exacto = profesores.filter(p => normalizar(p.nombre) === n);
  if (exacto.length === 1) return exacto[0];
  const parecidos = profesores.filter(p => mismoNombre(p.nombre, texto));
  if (parecidos.length === 1) return parecidos[0];
  if (parecidos.length > 1) return null;   // varias personas parecidas: mejor no adivinar
  const parcial = profesores.filter(p => {
    const pn = normalizar(p.nombre);
    return pn.includes(n) || n.includes(pn);
  });
  return parcial.length === 1 ? parcial[0] : null;
}

// Clases cargadas con un nombre que no estaba vinculado a ninguna cuenta: se las asigna al profesor
// cuya cuenta coincide (aunque el nombre tenga tildes, orden o una errata distinta) para que le
// aparezcan en "Mi horario". Sin `usuario` revisa a todos los profesores.
function vincularBloquesPorNombre(usuario = null) {
  if (usuario && usuario.rol !== 'profesor') return 0;
  const pendientes = db.prepare('SELECT id, profesor_nombre FROM horarios WHERE profesor_id IS NULL AND profesor_nombre IS NOT NULL').all();
  if (!pendientes.length) return 0;
  const profesores = listaProfesores();
  const upd = db.prepare("UPDATE horarios SET profesor_id = ?, profesor_nombre = ?, estado = 'ocupado' WHERE id = ?");
  let vinculados = 0;
  for (const h of pendientes) {
    const p = buscarProfesorPorNombre(h.profesor_nombre, profesores);
    if (!p || (usuario && p.id !== usuario.id)) continue;
    upd.run(p.id, p.nombre, h.id);
    vinculados++;
  }
  return vinculados;
}

// Clases de una persona: por cuenta (profesor_id) o, si todavía no tiene cuenta, por nombre.
function clasesDeProfesor({ id = null, nombre = null }) {
  return horariosOrdenados().filter(h =>
    (id && h.profesor_id === id) || (h.profesor_nombre && nombre && mismoNombre(h.profesor_nombre, nombre)));
}

// Clase que tiene esa persona a una hora concreta de un día (o null si está libre).
function claseEnHora(persona, dia, hhmm) {
  const t = aMinutos(hhmm);
  return clasesDeProfesor(persona).find(h => h.dia === dia && t >= aMinutos(h.hora_inicio) && t < aMinutos(h.hora_fin)) || null;
}

// Todas las personas conocidas (cuentas + plantilla), para reconocer nombres en un mensaje.
function personasConocidas() {
  return profesoresParaSelector().map(p => ({ id: p.id, nombre: p.nombre }));
}

// ---------- salones ----------
// Salones que aparecen en el horario (sin repetir "Aula 101" / "aula 101").
function listaSalones() {
  const vistos = new Map();
  for (const h of horariosOrdenados()) if (h.salon && !vistos.has(normalizar(h.salon))) vistos.set(normalizar(h.salon), h.salon);
  return [...vistos.values()].sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
}

function clasesDeSalon(salon) {
  const k = normalizar(salon);
  return horariosOrdenados().filter(h => h.salon && normalizar(h.salon) === k);
}

// Estado de todos los salones a una hora de un día: [{ salon, libre, clase }]
function estadoSalones(dia, hhmm) {
  const t = aMinutos(hhmm);
  const todas = horariosOrdenados().filter(h => h.dia === dia && h.salon && t >= aMinutos(h.hora_inicio) && t < aMinutos(h.hora_fin));
  return listaSalones().map(salon => {
    const c = todas.find(h => normalizar(h.salon) === normalizar(salon));
    return { salon, libre: !c, clase: c ? { materia: c.materia, profesor_nombre: c.profesor_nombre, hora_inicio: c.hora_inicio, hora_fin: c.hora_fin } : null };
  });
}

// ---------- carga de los profesores (para ordenar reemplazos) ----------
const UMBRAL_CERCA_LIMITE = 0.8;   // desde el 80 % del límite de faltas se considera "cerca"

// Map id -> { horas semanales, faltas, riesgo: 0 normal | 1 cerca del límite | 2 en lista negra }
function cargaDeProfesores() {
  const carga = new Map();
  const de = (id) => { if (!carga.has(id)) carga.set(id, { horas: 0, faltas: 0, riesgo: 0 }); return carga.get(id); };
  for (const h of db.prepare('SELECT profesor_id, hora_inicio, hora_fin FROM horarios WHERE profesor_id IS NOT NULL').all())
    de(h.profesor_id).horas += (aMinutos(h.hora_fin) - aMinutos(h.hora_inicio)) / 60;
  for (const f of db.prepare('SELECT profesor_id, COUNT(*) AS n FROM ausencias WHERE profesor_id IS NOT NULL GROUP BY profesor_id').all()) {
    const c = de(f.profesor_id);
    c.faltas = f.n;
    c.riesgo = f.n >= LIMITE_FALTAS ? 2 : f.n >= Math.ceil(LIMITE_FALTAS * UMBRAL_CERCA_LIMITE) ? 1 : 0;
  }
  return carga;
}

// Traslado liceo <-> UTU: amarillo = liceo, azul = UTU (verde = coordinación, no cuenta como lugar distinto).
const LUGAR_DE_COLOR = { amarillo: 'liceo', azul: 'UTU' };
const COLORES_VALIDOS = ['amarillo', 'azul', 'verde'];
const TRASLADO_MINUTOS = () => Number(process.env.TRASLADO_MINUTOS) || 30;

// Pares de clases seguidas del MISMO profesor en lugares distintos con menos tiempo del necesario para trasladarse.
function problemasTraslado(clases) {
  const out = [];
  const porDia = {};
  for (const h of clases) (porDia[h.dia] = porDia[h.dia] || []).push(h);
  for (const lista of Object.values(porDia)) {
    lista.sort((a, b) => aMinutos(a.hora_inicio) - aMinutos(b.hora_inicio));
    for (let i = 0; i < lista.length - 1; i++) {
      const a = lista[i], b = lista[i + 1];
      const la = LUGAR_DE_COLOR[a.color], lb = LUGAR_DE_COLOR[b.color];
      const margen = aMinutos(b.hora_inicio) - aMinutos(a.hora_fin);
      if (la && lb && la !== lb && margen >= 0 && margen < TRASLADO_MINUTOS()) {
        out.push({ ids: [a.id, b.id], dia: a.dia, margen,
          texto: `Traslado justo el ${a.dia}: ${a.materia} termina ${a.hora_fin} (${la}) y ${b.materia} empieza ${b.hora_inicio} (${lb}); hay ${margen} min y se necesitan al menos ${TRASLADO_MINUTOS()}.` });
      }
    }
  }
  return out;
}

// Problemas de traslado de todos los profesores: [{ clave, profesor, texto, ids }]
function traslados() {
  const grupos = new Map();
  for (const h of horariosOrdenados()) {
    if (!h.profesor_id && !h.profesor_nombre) continue;
    const clave = h.profesor_id ? String(h.profesor_id) : `n:${h.profesor_nombre}`;
    if (!grupos.has(clave)) grupos.set(clave, { profesor: h.profesor_nombre, clases: [] });
    grupos.get(clave).clases.push(h);
  }
  const out = [];
  for (const [clave, g] of grupos) for (const p of problemasTraslado(g.clases)) out.push({ clave, profesor: g.profesor, ...p });
  return out;
}

// Cuando el admin cambia una clase ya publicada, avisa a los profesores afectados (el de antes y el de ahora).
// antes/despues: fila de `horarios` (o null si se creó / se borró).
function avisarCambioClase(antes, despues) {
  if (db.getConfig('horario_publicado', '0') !== '1') return 0;
  const cuando = (h) => `${h.dia} ${h.hora_inicio}–${h.hora_fin}${h.salon ? ', ' + h.salon : ''}`;
  const ins = db.prepare(`INSERT INTO mensajes (remitente_id, remitente_nombre, destinatario_id, destinatario_nombre, contenido, tipo)
                          VALUES (NULL, 'Sistema Cuadrilla', ?, ?, ?, 'sistema')`);
  const nombreDe = (id) => (db.prepare('SELECT nombre FROM usuarios WHERE id = ?').get(id) || {}).nombre;
  const enviar = (id, txt) => { const n = id && nombreDe(id); if (n) { ins.run(id, n, txt); return 1; } return 0; };
  let n = 0;
  if (!antes && despues) return enviar(despues.profesor_id, `Se te asignó una clase nueva: ${despues.materia} (${cuando(despues)}).`);
  if (antes && !despues) return enviar(antes.profesor_id, `Se eliminó tu clase ${antes.materia} (${cuando(antes)}).`);
  if (antes.profesor_id !== despues.profesor_id) {
    n += enviar(antes.profesor_id, `Ya no tenés la clase ${antes.materia} (${cuando(antes)}): se asignó a otro profesor.`);
    n += enviar(despues.profesor_id, `Se te asignó la clase ${despues.materia} (${cuando(despues)}).`);
    return n;
  }
  const cambios = [];
  if (antes.dia !== despues.dia || antes.hora_inicio !== despues.hora_inicio || antes.hora_fin !== despues.hora_fin)
    cambios.push(`pasó de ${antes.dia} ${antes.hora_inicio}–${antes.hora_fin} a ${despues.dia} ${despues.hora_inicio}–${despues.hora_fin}`);
  if ((antes.salon || '') !== (despues.salon || '')) cambios.push(`cambió de salón (${antes.salon || 'sin salón'} → ${despues.salon || 'sin salón'})`);
  if (antes.materia !== despues.materia) cambios.push(`ahora se llama ${despues.materia}`);
  return cambios.length ? enviar(despues.profesor_id, `Cambió tu clase ${antes.materia}: ${cambios.join('; ')}.`) : 0;
}

module.exports = {
  listaSalones, clasesDeSalon, estadoSalones, cargaDeProfesores, UMBRAL_CERCA_LIMITE,
  COLORES_VALIDOS, problemasTraslado, traslados, avisarCambioClase,
  clasesDeProfesor, claseEnHora, personasConocidas,
  DIAS, normalizar, normalizarDia, normalizarHora, aMinutos,
  validarBloque, buscarConflicto, ORDEN_DIA_SQL, horariosOrdenados, LIMITE_FALTAS, listaNegraActual, listaProfesores, mismoNombre, profesoresParaSelector, nombreDePlantilla, buscarProfesorPorNombre, vincularBloquesPorNombre
};
