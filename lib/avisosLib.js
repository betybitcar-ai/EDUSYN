// Avisos dirigidos: el admin publica un aviso para todos, para uno o más cursos, para un turno
// o para un grupo de profesores. Los dirigidos solo los ven los profesores a quienes alcanzan (y el admin);
// los alumnos solo ven los avisos "para todos" (las cuentas de alumno no están ligadas a un curso).
//
// destino_tipo  destino (lista JSON)            ¿Quién lo ve?
// todos         —                                todos
// cursos        ["7°3", "3°MA"]                  profesores con alguna clase en esos cursos
// turno         ["1"] / ["1", "2"]               profesores de ese turno (según la plantilla)
// profesores    ["Ana Pérez", "Luis Gómez"]      esos profesores
const db = require('../db/database');
const lib = require('./horariosLib');
const { PLANTILLA } = require('./profesoresPlantilla');
const { normCurso } = require('./choquesLib');

const TIPOS = ['todos', 'cursos', 'turno', 'profesores'];
const MAX_DESTINOS = 60;

const turnoDe = (nombre) => { const p = PLANTILLA.find(x => lib.mismoNombre(x.nombre, nombre)); return p ? String(p.turno) : null; };
const TURNOS = () => [...new Set(PLANTILLA.map(p => String(p.turno)))].sort();

// Cursos que existen en el horario (sin repetir "7°3" / "7º 3").
function cursosConocidos() {
  const vistos = new Map();
  for (const f of db.prepare("SELECT DISTINCT curso FROM horarios WHERE curso IS NOT NULL AND TRIM(curso) <> ''").all()) {
    const k = normCurso(f.curso);
    if (!vistos.has(k)) vistos.set(k, f.curso.trim());
  }
  return [...vistos.values()].sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
}

// Opciones para el formulario del admin.
function opcionesDestino() {
  const profes = lib.profesoresParaSelector();
  return {
    cursos: cursosConocidos(),
    turnos: TURNOS().map(t => ({ valor: t, nombre: `Turno ${t}`, profesores: profes.filter(p => String(p.turno) === t).length })),
    profesores: profes.map(p => ({ nombre: p.nombre, turno: p.turno, cuenta: p.cuenta }))
  };
}

// Valida lo que manda el admin. Devuelve { error } o { tipo, valores } con los valores ya normalizados.
function parsearDestino(body = {}) {
  const tipo = body.destino_tipo === undefined || body.destino_tipo === null || body.destino_tipo === '' ? 'todos' : String(body.destino_tipo);
  if (!TIPOS.includes(tipo)) return { error: 'Destino no válido (todos, cursos, turno o profesores).' };
  if (tipo === 'todos') return { tipo, valores: [] };

  const crudos = [...new Set((Array.isArray(body.destino) ? body.destino : []).map(v => String(v ?? '').trim()).filter(Boolean))];
  if (!crudos.length) return { error: 'Elegí a quién va dirigido el aviso.' };
  if (crudos.length > MAX_DESTINOS) return { error: `Elegiste demasiados destinos (máximo ${MAX_DESTINOS}).` };

  const valores = [];
  for (const v of crudos) {
    if (tipo === 'turno') {
      if (!TURNOS().includes(v)) return { error: `El turno "${v.slice(0, 20)}" no existe.` };
      valores.push(v);
    } else if (tipo === 'cursos') {
      const curso = cursosConocidos().find(c => normCurso(c) === normCurso(v));
      if (!curso) return { error: `El curso "${v.slice(0, 40)}" no está en el horario.` };
      valores.push(curso);
    } else {
      const nombre = lib.nombreDePlantilla(v) || (lib.buscarProfesorPorNombre(v) || {}).nombre;
      if (!nombre) return { error: `El profesor "${v.slice(0, 60)}" no existe.` };
      valores.push(nombre);
    }
  }
  return { tipo, valores: [...new Set(valores)] };
}

function leerValores(aviso) {
  try { const v = JSON.parse(aviso.destino || '[]'); return Array.isArray(v) ? v.map(String) : []; } catch { return []; }
}

// Datos del profesor que se usan para decidir qué avisos le tocan (se calculan una vez por pedido).
function contexto(usuario) {
  if (!usuario || usuario.rol !== 'profesor') return { turno: null, cursos: new Set() };
  const cursos = new Set(lib.clasesDeProfesor({ id: usuario.id, nombre: usuario.nombre }).map(h => normCurso(h.curso)).filter(Boolean));
  return { turno: turnoDe(usuario.nombre), cursos };
}

function visiblePara(aviso, usuario, ctx = contexto(usuario)) {
  if (usuario.rol === 'admin') return true;
  const tipo = aviso.destino_tipo || 'todos';
  if (tipo === 'todos') return true;
  if (usuario.rol !== 'profesor') return false;
  const valores = leerValores(aviso);
  if (tipo === 'turno') return Boolean(ctx.turno) && valores.includes(ctx.turno);
  if (tipo === 'profesores') return valores.some(n => lib.mismoNombre(n, usuario.nombre));
  if (tipo === 'cursos') return valores.some(c => ctx.cursos.has(normCurso(c)));
  return false;
}

// Cuántos profesores con cuenta lo van a ver.
function contarDestinatarios(aviso) {
  const profes = db.prepare("SELECT id, nombre, rol FROM usuarios WHERE rol = 'profesor'").all();
  return profes.filter(p => visiblePara(aviso, p)).length;
}

// Texto corto de a quién va dirigido ("Turno 1", "Curso 7°3"…). null si es para todos.
// El detalle de nombres solo lo ve el admin.
function etiquetaDestino(aviso, verDetalle) {
  const tipo = aviso.destino_tipo || 'todos';
  const v = leerValores(aviso);
  if (tipo === 'turno') return v.length === 1 ? `Turno ${v[0]}` : `Turnos ${v.join(' y ')}`;
  if (tipo === 'cursos') return `${v.length === 1 ? 'Curso' : 'Cursos'} ${v.join(', ')}`;
  if (tipo === 'profesores') return verDetalle ? `Profesores: ${v.join(', ')}` : 'Grupo de profesores';
  return null;
}

// Lo que se manda al navegador (los nombres elegidos solo los recibe el admin).
function presentar(aviso, esAdmin) {
  const { destino, ...resto } = aviso;
  return { ...resto, para: etiquetaDestino(aviso, esAdmin), ...(esAdmin ? { destino: leerValores(aviso) } : {}) };
}

module.exports = { TIPOS, opcionesDestino, parsearDestino, contexto, visiblePara, contarDestinatarios, etiquetaDestino, presentar, leerValores, turnoDe };
