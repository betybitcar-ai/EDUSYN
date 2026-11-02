// Entrega obligatoria del horario semanal de cada profesor.
// El profesor lo escribe en el asistente; acá se interpreta, se guarda como horario personal
// (origen "carga-profesor": no aparece en la grilla de los alumnos) y queda en "Por profesor" del admin.
const db = require('../db/database');
const lib = require('./horariosLib');
const historial = require('./historialLib');
const choques = require('./choquesLib');

const ORIGEN = 'carga-profesor';
const MAX_CLASES = 80;
const COLOR = { liceo: 'amarillo', utu: 'azul', coordinacion: 'verde' };

const DIA_RE = '(?:lunes|martes|miercoles|jueves|viernes|sabado)';
// "07:30-09:00", "7.30 a 9", "8h - 9h30", "08:00 hasta 09:30"
const HORA_RE = '(\\d{1,2})(?:[:.h](\\d{2}))?\\s?(?:hs?\\.?)?';
const TOKEN = new RegExp(`(?<![\\w°º])(${DIA_RE})(?![a-z])|(?<![\\w°º:.])${HORA_RE}\\s*(?:-|–|—|a|hasta)\\s*${HORA_RE}(?![\\d°º:])`, 'g');

const hhmm = (h, m) => lib.normalizarHora(`${h}:${m || '00'}`);
const sinTildes = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Interpreta un horario escrito a mano. Formato: "Lunes 07:30-09:00 3°MA liceo" (una clase por línea o seguidas;
// el día vale hasta el siguiente día). Devuelve { clases, errores }.
function parsearHorario(entrada) {
  const orig = String(entrada || '').normalize('NFC');
  const plano = sinTildes(orig);   // misma longitud que `orig`: los índices coinciden
  const marcas = [];
  for (const m of plano.matchAll(TOKEN)) marcas.push({ i: m.index, fin: m.index + m[0].length, m });
  const clases = [], errores = [];
  let dias = [], trasRango = false, primerDia = null, finUltimoRango = 0;
  // Palabras de relleno que no son parte del curso: "con 3°MA", "en el liceo", "curso 7°1"
  const limpiar = (t) => t.replace(/\b(en el|en la|en|del|de la)?\s*(liceo|figari|utu)\b/gi, ' ')
    .replace(/(^|\s)(con|para|curso|grupo|clase de|de|los|las|el|la|y)(?=\s|$)/gi, ' ')
    .replace(/\s+/g, ' ').replace(/^[\s,:\-–—()]+|[\s,:\-–—()]+$/g, '');

  marcas.forEach((t, k) => {
    if (t.m[1]) {   // un día; "lunes y miércoles 8-10" junta varios días antes de la hora
      if (trasRango) { dias = []; trasRango = false; }
      if (!dias.length) primerDia = t.i;
      const d = lib.normalizarDia(t.m[1]);
      if (!dias.includes(d)) dias.push(d);
      return;
    }
    const sig = marcas[k + 1] ? marcas[k + 1].i : orig.length;
    const desc = orig.slice(t.fin, sig).split(/[\n\r;]/)[0];
    const etiqueta = orig.slice(t.i, t.fin).trim();
    const primeraDelDia = !trasRango;
    if (!dias.length) { errores.push(`"${etiqueta}": falta indicar el día (Lunes, Martes…).`); return; }
    const ini = hhmm(t.m[2], t.m[3]), fin = hhmm(t.m[4], t.m[5]);
    if (!ini || !fin) { errores.push(`${dias[0]} "${etiqueta}": hora no válida.`); return; }
    if (lib.aMinutos(fin) <= lib.aMinutos(ini)) { errores.push(`${dias.join(' y ')} ${ini}-${fin}: la hora de fin tiene que ser posterior a la de inicio.`); return; }

    let texto = limpiar(desc);
    let lugarTxt = desc;
    // Curso escrito antes del día ("3°MA lunes de 8 a 10"): se toma lo que quedó entre la marca anterior y el día.
    if (!texto && primeraDelDia && primerDia !== null) {
      const linea = orig.slice(finUltimoRango, primerDia).split(/[\n\r;]/).pop();
      texto = limpiar(linea);
      lugarTxt = `${desc} ${linea}`;
    }
    finUltimoRango = t.fin;
    const d = sinTildes(lugarTxt);
    let color = null;
    if (/\bcoord\w*/.test(d)) color = COLOR.coordinacion;
    else if (/\bliceo\b|\bfigari\b/.test(d)) color = COLOR.liceo;
    else if (/\butu\b/.test(d)) color = COLOR.utu;
    trasRango = true;

    for (const dia of dias) {
      if (color === COLOR.coordinacion) {
        clases.push({ dia, hora_inicio: ini, hora_fin: fin, materia: (texto || 'Coordinación').slice(0, 80), curso: null, color });
      } else if (!texto) {
        errores.push(`${dia} ${ini}-${fin}: falta el curso (ej. 7°3, 3°CAD).`);
      } else if (texto.length > 40) {
        errores.push(`${dia} ${ini}-${fin}: el curso "${texto.slice(0, 20)}…" es demasiado largo.`);
      } else {
        clases.push({ dia, hora_inicio: ini, hora_fin: fin, materia: texto, curso: texto, color });
      }
    }
  });

  // Dos clases que se pisan el mismo día.
  for (let a = 0; a < clases.length; a++) for (let b = a + 1; b < clases.length; b++) {
    const x = clases[a], y = clases[b];
    if (x.dia === y.dia && lib.aMinutos(x.hora_inicio) < lib.aMinutos(y.hora_fin) && lib.aMinutos(y.hora_inicio) < lib.aMinutos(x.hora_fin))
      errores.push(`${x.dia}: ${x.hora_inicio}-${x.hora_fin} (${x.materia}) se pisa con ${y.hora_inicio}-${y.hora_fin} (${y.materia}).`);
  }
  if (clases.length > MAX_CLASES) errores.push(`Son demasiadas clases (máximo ${MAX_CLASES}).`);
  return { clases, errores };
}

// ¿Ya entregó? Sí si registró su entrega o si ya tiene un horario personal cargado desde su planilla (Silvio, Saúl, Valentina…).
function yaEntrego(profesorId) {
  if (!profesorId) return false;
  return Boolean(db.prepare('SELECT 1 FROM entregas_horario WHERE profesor_id = ?').get(profesorId)
    || db.prepare("SELECT 1 FROM horarios WHERE profesor_id = ? AND origen LIKE 'carga-%' LIMIT 1").get(profesorId));
}

function estadoEntrega(profesorId) {
  const e = db.prepare('SELECT enviado_en, cantidad FROM entregas_horario WHERE profesor_id = ?').get(profesorId);
  const cantidad = e ? e.cantidad : db.prepare("SELECT COUNT(*) AS n FROM horarios WHERE profesor_id = ? AND origen LIKE 'carga-%'").get(profesorId).n;
  return { entregado: yaEntrego(profesorId), enviado_en: e ? e.enviado_en : null, cantidad, con_foto: tieneFoto(profesorId) };
}

const tieneFoto = (profesorId) => Boolean(db.prepare('SELECT 1 FROM entregas_foto WHERE profesor_id = ?').get(profesorId));
const fotoDe = (profesorId) => db.prepare('SELECT imagen, enviado_en, subido_por FROM entregas_foto WHERE profesor_id = ?').get(profesorId) || null;

// Recibe la foto del horario de un profesor: la guarda para que el admin la vea en "Por profesor", avisa a los admin y
// da por entregado el horario (así el profesor ya puede usar todo el sistema) aunque todavía no esté transcrito a clases.
// `subidoPor` es quien la subió (el propio profesor o un admin). Devuelve { primera, transcrito }.
function guardarFoto(profesor, imagen, subidoPor, { avisar = true } = {}) {
  let primera, transcrito;
  db.exec('BEGIN');
  try {
    primera = !tieneFoto(profesor.id);
    db.prepare(`INSERT INTO entregas_foto (profesor_id, imagen, enviado_en, subido_por) VALUES (?, ?, datetime('now'), ?)
                ON CONFLICT(profesor_id) DO UPDATE SET imagen = excluded.imagen, enviado_en = excluded.enviado_en, subido_por = excluded.subido_por`)
      .run(profesor.id, imagen, subidoPor.nombre);
    transcrito = db.prepare('SELECT COUNT(*) AS n FROM horarios WHERE origen = ? AND profesor_id = ?').get(ORIGEN, profesor.id).n > 0;
    // Marca la entrega (si no la tenía) sin pisar la cantidad de clases ya transcritas.
    db.prepare(`INSERT INTO entregas_horario (profesor_id, enviado_en, cantidad) VALUES (?, datetime('now'), 0)
                ON CONFLICT(profesor_id) DO UPDATE SET enviado_en = datetime('now')`).run(profesor.id);
    const quien = subidoPor.id === profesor.id ? `${profesor.nombre} envió` : `${subidoPor.nombre} subió, en nombre de ${profesor.nombre},`;
    if (avisar) avisarAdmins(profesor, `📷 ${quien} la foto de su horario semanal. Está en “Por profesor”${transcrito ? '.' : ' para pasarla a clases.'}`);
    if (avisar) historial.registrar(subidoPor, 'entrega', `Foto del horario semanal de ${profesor.nombre}`);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return { primera, transcrito };
}

// Guarda las clases en el horario personal del profesor. Reemplaza solo los días que vienen en el mensaje
// (así se puede corregir un día sin reenviar todo) y avisa a los admin. Devuelve { dias, total }.
function guardarEntrega(usuario, clases) {
  const dias = [...new Set(clases.map(c => c.dia))];
  let total;
  db.exec('BEGIN');
  try {
    const borrar = db.prepare('DELETE FROM horarios WHERE origen = ? AND profesor_id = ? AND dia = ?');
    for (const d of dias) borrar.run(ORIGEN, usuario.id, d);
    const ins = db.prepare(`INSERT INTO horarios (dia, hora_inicio, hora_fin, materia, salon, estado, profesor_id, profesor_nombre, origen, color, curso, creado_por)
                            VALUES (?, ?, ?, ?, NULL, 'ocupado', ?, ?, ?, ?, ?, ?)`);
    for (const c of clases) ins.run(c.dia, c.hora_inicio, c.hora_fin, c.materia, usuario.id, usuario.nombre, ORIGEN, c.color, c.curso, usuario.id);
    total = db.prepare('SELECT COUNT(*) AS n FROM horarios WHERE origen = ? AND profesor_id = ?').get(ORIGEN, usuario.id).n;
    const antes = db.prepare('SELECT 1 FROM entregas_horario WHERE profesor_id = ?').get(usuario.id);
    db.prepare(`INSERT INTO entregas_horario (profesor_id, enviado_en, cantidad) VALUES (?, datetime('now'), ?)
                ON CONFLICT(profesor_id) DO UPDATE SET enviado_en = excluded.enviado_en, cantidad = excluded.cantidad`).run(usuario.id, total);
    // Si lo que entregó no cuadra con la grilla del admin, el aviso al admin ya lo dice.
    const difs = choques.choquesDe(usuario.id);
    const alerta = difs.length ? ` ⚠️ No coincide con la grilla: ${choques.resumenTipos(difs)}.` : '';
    avisarAdmins(usuario, `${usuario.nombre} ${antes ? 'actualizó' : 'entregó'} su horario semanal (${total} clase${total === 1 ? '' : 's'}). Ya está en “Por profesor”.${alerta}`);
    historial.registrar(usuario, 'entrega', `${antes ? 'Actualizó' : 'Entregó'} su horario semanal (${dias.join(', ')}; ${total} clases en total)`);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return { dias, total };
}

function avisarAdmins(usuario, contenido) {
  const aviso = db.prepare(`INSERT INTO mensajes (remitente_id, remitente_nombre, destinatario_id, destinatario_nombre, contenido, tipo)
                            VALUES (?, ?, ?, ?, ?, 'sistema')`);
  for (const a of db.prepare("SELECT id, nombre FROM usuarios WHERE rol = 'admin'").all()) aviso.run(usuario.id, usuario.nombre, a.id, a.nombre, contenido);
}

// Clases entregadas por el profesor por el asistente (las que él puede ver y corregir).
function entregadas(profesorId) {
  return db.prepare(`SELECT * FROM horarios WHERE origen = ? AND profesor_id = ? ORDER BY ${lib.ORDEN_DIA_SQL}, hora_inicio`).all(ORIGEN, profesorId);
}

// Borra lo entregado: todo o solo un día. Si se borra todo vuelve a quedar pendiente (y bloqueado) salvo que tenga un horario de planilla.
function borrarEntrega(usuario, dia = null) {
  db.exec('BEGIN');
  try {
    const info = dia
      ? db.prepare('DELETE FROM horarios WHERE origen = ? AND profesor_id = ? AND dia = ?').run(ORIGEN, usuario.id, dia)
      : db.prepare('DELETE FROM horarios WHERE origen = ? AND profesor_id = ?').run(ORIGEN, usuario.id);
    const quedan = db.prepare('SELECT COUNT(*) AS n FROM horarios WHERE origen = ? AND profesor_id = ?').get(ORIGEN, usuario.id).n;
    if (quedan === 0) {
      db.prepare('DELETE FROM entregas_horario WHERE profesor_id = ?').run(usuario.id);
      db.prepare('DELETE FROM entregas_foto WHERE profesor_id = ?').run(usuario.id);
    }
    else db.prepare('UPDATE entregas_horario SET cantidad = ? WHERE profesor_id = ?').run(quedan, usuario.id);
    if (info.changes) {
      avisarAdmins(usuario, `${usuario.nombre} borró ${dia ? 'las clases del ' + dia.toLowerCase() + ' de' : ''} su horario semanal entregado.`);
      historial.registrar(usuario, 'entrega', `Borró ${dia ? 'el ' + dia.toLowerCase() : 'todo'} de su horario semanal entregado (${info.changes} clases)`);
    }
    db.exec('COMMIT');
    return { borradas: info.changes, quedan };
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

// Busca profesores (con cuenta o de la plantilla) por parte del nombre: "ana", "ana perez". Devuelve la lista de coincidencias.
function buscarProfesores(texto) {
  const q = lib.normalizar(texto).split(' ').filter(Boolean);
  if (!q.length) return [];
  const todos = lib.profesoresParaSelector();
  const exactos = todos.filter(p => lib.mismoNombre(p.nombre, texto));
  if (exactos.length) return exactos;
  return todos.filter(p => { const n = lib.normalizar(p.nombre).split(' '); return q.every(t => n.some(x => x === t || x.startsWith(t))); });
}

// Para el admin: quién entregó y quién falta (profesores con cuenta).
function resumenAdmin() {
  const profes = db.prepare("SELECT id, nombre FROM usuarios WHERE rol = 'profesor' ORDER BY nombre COLLATE NOCASE").all();
  const lista = profes.map(p => ({ id: p.id, nombre: p.nombre, ...estadoEntrega(p.id) }));
  return { profesores: lista, pendientes: lista.filter(p => !p.entregado).length };
}

// ¿El mensaje parece un horario (dos o más franjas con día) o un pedido de entregarlo?
const PIDE_ENTREGAR = /\b(entreg\w*|pas(ar|o|e)|envi(ar|o|e)|sub(ir|o|e)|carg(ar|o|ue)|mand(ar|o|e)|registr(ar|o|e)|presentar)\b[^\n]{0,25}\bhorario\b/;
function pareceHorario(mensaje) {
  const p = sinTildes(String(mensaje || ''));
  if (!new RegExp(DIA_RE).test(p)) return false;
  const franjas = p.match(new RegExp(`${HORA_RE}\\s*(?:-|–|—|a|hasta)\\s*${HORA_RE}`, 'g')) || [];
  if (franjas.length >= 2) return true;
  // Una sola franja ("los lunes de 8 a 10 con 3°MA"): vale si trae un curso y no es otro pedido.
  return franjas.length === 1 && /\d\s?[°º]/.test(p) && !/\b(no puedo|falto|faltare|reemplazo|suplente|cubrir|relevo|cambiar|cambio|intercambi\w*|libres?|salon\w*|aulas?)\b/.test(p);
}
const pideEntregar = (mensaje) => PIDE_ENTREGAR.test(sinTildes(String(mensaje || '')));

const EJEMPLO = 'Lunes 07:30-09:00 3°MA liceo\nLunes 09:05-10:35 3°DF utu\nMiércoles 10:40-11:25 Coordinación\nJueves 07:30-09:00 3°MC utu';

module.exports = { ORIGEN, parsearHorario, yaEntrego, estadoEntrega, guardarFoto, fotoDe, tieneFoto, guardarEntrega, entregadas, borrarEntrega, buscarProfesores, resumenAdmin, pareceHorario, pideEntregar, EJEMPLO };
