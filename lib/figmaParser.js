/**
 * Convierte un archivo de Figma (JSON de la REST API) en bloques de horario.
 *
 * Convención de diseño (ver README):
 *   - Un frame/grupo por día, llamado "Lunes", "Martes", ... (también sirve "Lunes - Mañana").
 *   - Dentro, una tarjeta (frame/grupo/componente) por clase, con capas de texto, por ejemplo:
 *        Matemáticas
 *        08:00 - 09:30
 *        Aula 101
 *        Prof. Ana Pérez
 *   - Si no hay frames por día, se aceptan tarjetas sueltas que incluyan el nombre del día en un texto.
 */
const { DIAS, normalizar, normalizarDia, normalizarHora, buscarProfesorPorNombre } = require('./horariosLib');

const RE_HORA = /(\d{1,2})\s*[:.h]\s*(\d{2})\s*(?:-|–|—|a|hasta|to)\s*(\d{1,2})\s*[:.h]\s*(\d{2})/i;
const RE_SALON = /^(aula|sal[oó]n|sala)\b/i;
const RE_SALON_CON_NUMERO = /^(lab(oratorio)?|gimnasio|taller)\b.*\d/i;
const RE_PROF = /^(?:prof(?:esor|esora)?|doc(?:ente)?|lic|mtr[oa]|dra?)(?:\.\s*|:\s*|\s+)/i;

function textosDe(nodo) {
  if (nodo.type === 'TEXT') {
    return String(nodo.characters || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  }
  return (nodo.children || []).flatMap(textosDe);
}

function contieneHora(nodo) {
  return textosDe(nodo).some(t => RE_HORA.test(t));
}

// Contenedores mínimos que contienen una hora (cada uno = una clase).
function tarjetas(nodo) {
  if (nodo.visible === false || !contieneHora(nodo)) return [];
  const hijas = (nodo.children || []).filter(c => c.type !== 'TEXT').flatMap(tarjetas);
  return hijas.length ? hijas : [nodo];
}

function buscarContenedoresDeDia(nodo, acc = []) {
  if (nodo.visible === false) return acc;
  const esContenedor = nodo.type !== 'TEXT' && nodo.name;
  const dia = esContenedor ? diaDelNombre(nodo.name) : null;
  if (dia && contieneHora(nodo)) {
    acc.push({ dia, nodo });
    return acc; // no seguir bajando: los días no se anidan
  }
  (nodo.children || []).forEach(c => buscarContenedoresDeDia(c, acc));
  return acc;
}

function diaDelNombre(nombre) {
  const n = normalizar(nombre);
  return DIAS.find(d => n === normalizar(d) || n.startsWith(normalizar(d) + ' ')) || null;
}

function bloqueDesdeLineas(lineas, diaForzado, profesores) {
  const avisos = [];
  let dia = diaForzado || null;
  let hora_inicio = null, hora_fin = null, salon = null, profesorTxt = null;
  const resto = [];

  for (const linea of lineas) {
    const m = RE_HORA.exec(linea);
    if (m && !hora_inicio) {
      hora_inicio = normalizarHora(`${m[1]}:${m[2]}`);
      hora_fin = normalizarHora(`${m[3]}:${m[4]}`);
      const sobrante = linea.replace(RE_HORA, '').replace(/^[\s\-–—|·,]+|[\s\-–—|·,]+$/g, '');
      if (sobrante) resto.push(sobrante);
      continue;
    }
    if (!dia && normalizarDia(linea)) { dia = normalizarDia(linea); continue; }
    if (!salon && (RE_SALON.test(linea) || RE_SALON_CON_NUMERO.test(linea))) { salon = linea; continue; }
    if (!profesorTxt && RE_PROF.test(linea)) { profesorTxt = linea.replace(RE_PROF, '').trim(); continue; }
    resto.push(linea);
  }

  // Sin prefijo "Prof.": si alguna línea sobrante coincide con un profesor registrado, es el profesor.
  if (!profesorTxt) {
    const idx = resto.findIndex((l, i) => i > 0 && buscarProfesorPorNombre(l, profesores));
    if (idx > 0) profesorTxt = resto.splice(idx, 1)[0];
  }
  // Convención: materia, hora, salón y, si sobra otra línea, esa es el profesor (con o sin "Prof.").
  if (!profesorTxt && resto.length >= 2) profesorTxt = resto.splice(1, 1)[0];

  const materia = resto[0] || '';
  if (!materia) avisos.push('Tarjeta sin nombre de materia.');
  if (!dia) avisos.push(`"${materia || lineas[0]}": no se pudo saber el día.`);
  if (!hora_inicio || !hora_fin) avisos.push(`"${materia}": hora no válida.`);
  if (avisos.length) return { avisos };

  let profesor_id = null, profesor_nombre = null;
  if (profesorTxt) {
    const p = buscarProfesorPorNombre(profesorTxt, profesores);
    profesor_id = p ? p.id : null;
    profesor_nombre = p ? p.nombre : profesorTxt;
  }
  return { bloque: { dia, hora_inicio, hora_fin, materia, salon, profesor_id, profesor_nombre }, avisos };
}

function parsearFigma(documento, profesores = []) {
  const raiz = documento.document || documento;
  const bloques = [];
  const avisos = [];

  const procesar = (tarjeta, diaForzado) => {
    const r = bloqueDesdeLineas(textosDe(tarjeta), diaForzado, profesores);
    avisos.push(...r.avisos);
    if (r.bloque) bloques.push(r.bloque);
  };

  const dias = buscarContenedoresDeDia(raiz);
  if (dias.length) {
    dias.forEach(({ dia, nodo }) => tarjetas(nodo).forEach(t => procesar(t, dia)));
  } else {
    tarjetas(raiz).forEach(t => procesar(t, null));
  }

  if (!bloques.length && !avisos.length) {
    avisos.push('No encontré clases en el archivo. Revisá la convención de nombres (frames "Lunes", "Martes"… con textos de materia y hora).');
  }
  return { bloques, avisos };
}

module.exports = { parsearFigma };
