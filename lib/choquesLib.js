// Detector de choques: compara lo que el profesor entregó (su horario personal, origen "carga-…")
// con las clases que el admin le asignó en la grilla. Solo lo ve el admin.
//
// Tres tipos de aviso por profesor:
//  - doble_lugar:   en la grilla está en un lugar y en lo que entregó figura en otro a la misma hora.
//  - hora_distinta: mismo curso y día, pero la hora no coincide.
//  - falta:         el admin le cargó una clase que no aparece en lo que entregó.
// Solo se compara a quien ya entregó algo: si no entregó nada, no hay con qué comparar (eso ya lo muestra la entrega pendiente).
const lib = require('./horariosLib');

const esPersonal = (h) => String(h.origen || '').startsWith('carga-');
const min = (hhmm) => lib.aMinutos(hhmm);

// "7°3", "7º 3" y "7° 3" son el mismo curso.
const normCurso = (c) => String(c || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[º˚]/g, '°').replace(/\s+/g, '');

// Misma clave que usa la pantalla "Por profesor": id de la cuenta o, si no tiene, el nombre de la plantilla.
const claveDe = (h) => h.profesor_id ? String(h.profesor_id) : `n:${lib.nombreDePlantilla(h.profesor_nombre) || h.profesor_nombre}`;

const cuando = (h) => `${h.dia} ${h.hora_inicio}–${h.hora_fin}`;
// Las clases del admin tienen materia y curso ("Matemática (7°3)"); las entregadas solo curso ("3°MA").
const nombreClase = (h) => (h.curso && normCurso(h.curso) !== normCurso(h.materia)) ? `${h.materia} (${h.curso})` : h.materia;

const solapan = (a, b) => a.dia === b.dia && min(a.hora_inicio) < min(b.hora_fin) && min(b.hora_inicio) < min(a.hora_fin);
const mismoCurso = (a, b) => Boolean(a.curso && b.curso && normCurso(a.curso) === normCurso(b.curso));

// Núcleo puro (fácil de probar): `asignadas` = clases de la grilla, `entregadas` = lo que entregó el profesor.
// Devuelve [{ tipo, dia, texto, ids }] ordenado por día y hora.
function compararProfesor(asignadas, entregadas) {
  const out = [];
  const sinPareja = new Set(entregadas.map(e => e.id));
  const pendientes = [];
  // 1) Lo que coincide exacto (día, horas y curso) queda en paz.
  for (const a of asignadas) {
    const par = entregadas.find(e => sinPareja.has(e.id) && e.dia === a.dia && e.hora_inicio === a.hora_inicio && e.hora_fin === a.hora_fin && mismoCurso(a, e));
    if (par) sinPareja.delete(par.id); else pendientes.push(a);
  }
  // 2) Lo demás: ¿se pisa con algo que entregó (dos lugares / hora distinta) o directamente no está (falta)?
  for (const a of pendientes) {
    const pisadas = entregadas.filter(e => solapan(a, e));
    if (!pisadas.length) {
      out.push({ tipo: 'falta', dia: a.dia, ids: [a.id], hora: a.hora_inicio,
        texto: `Le falta una clase: la grilla le asigna ${nombreClase(a)} el ${cuando(a)} y no figura en lo que entregó.` });
      continue;
    }
    for (const e of pisadas) {
      if (mismoCurso(a, e)) {
        out.push({ tipo: 'hora_distinta', dia: a.dia, ids: [a.id, e.id], hora: a.hora_inicio,
          texto: `${nombreClase(a)} no coincide en la hora: la grilla dice ${cuando(a)} y el profesor entregó ${e.hora_inicio}–${e.hora_fin}.` });
      } else {
        out.push({ tipo: 'doble_lugar', dia: a.dia, ids: [a.id, e.id], hora: a.hora_inicio,
          texto: `En dos lugares a la vez el ${a.dia}: la grilla dice ${nombreClase(a)} (${a.hora_inicio}–${a.hora_fin}) y en lo que entregó figura ${nombreClase(e)} (${e.hora_inicio}–${e.hora_fin}).` });
      }
    }
  }
  const orden = (d) => lib.DIAS.indexOf(d);
  return out.sort((x, y) => orden(x.dia) - orden(y.dia) || min(x.hora) - min(y.hora)).map(({ hora, ...resto }) => resto);
}

// Revisa a todos los profesores. Devuelve { choques, revisados, sin_entregar }.
//  choques: [{ clave, profesor_id, profesor, tipo, dia, texto, ids }]
//  revisados: profesores que entregaron algo y tienen clases en la grilla.
//  sin_entregar: profesores con clases en la grilla que no entregaron nada (no hay con qué comparar).
function detectarChoques() {
  lib.vincularBloquesPorNombre();
  const grupos = new Map();
  for (const h of lib.horariosOrdenados()) {
    if (!h.profesor_id && !h.profesor_nombre) continue;
    const clave = claveDe(h);
    if (!grupos.has(clave)) grupos.set(clave, { clave, profesor_id: h.profesor_id || null, profesor: h.profesor_nombre, asignadas: [], entregadas: [] });
    (esPersonal(h) ? grupos.get(clave).entregadas : grupos.get(clave).asignadas).push(h);
  }
  const choques = [];
  let revisados = 0, sinEntregar = 0;
  for (const g of grupos.values()) {
    if (!g.asignadas.length) continue;              // solo entregó: no hay nada de la grilla para contrastar
    if (!g.entregadas.length) { sinEntregar++; continue; }
    revisados++;
    for (const c of compararProfesor(g.asignadas, g.entregadas)) choques.push({ clave: g.clave, profesor_id: g.profesor_id, profesor: g.profesor, ...c });
  }
  return { choques, revisados, sin_entregar: sinEntregar };
}

// Choques de un solo profesor (por su clave: id de cuenta o "n:Nombre").
const choquesDe = (clave) => detectarChoques().choques.filter(c => c.clave === String(clave));

// "2 en dos lugares a la vez, 1 clase que falta" (para mensajes cortos).
function resumenTipos(choques) {
  const n = (t) => choques.filter(c => c.tipo === t).length;
  const partes = [];
  if (n('doble_lugar')) partes.push(`${n('doble_lugar')} en dos lugares a la vez`);
  if (n('hora_distinta')) partes.push(`${n('hora_distinta')} con hora distinta`);
  if (n('falta')) partes.push(`${n('falta')} clase${n('falta') === 1 ? '' : 's'} que falta${n('falta') === 1 ? '' : 'n'}`);
  return partes.join(', ');
}

module.exports = { compararProfesor, detectarChoques, choquesDe, resumenTipos, claveDe, normCurso };
