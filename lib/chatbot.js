// Lógica del asistente: detecta qué pide la persona, consulta la base y arma la respuesta.
// No depende de Express ni de Gemini (la IA entra como función opcional), así se puede probar sola.
const db = require('../db/database');
const lib = require('./horariosLib');
const backup = require('./backupLib');
const entrega = require('./entregaHorarioLib');

const NOMBRE_DIA_JS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

const plano = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const texto = (respuesta) => ({ tipo: 'texto', respuesta });
const celda = (v) => String(v ?? '—').replace(/\|/g, '/').replace(/\s+/g, ' ');
const kb = (bytes) => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/* ------------------------------ intenciones ------------------------------ */
// "horario de Ana", "qué clases tiene Ana Pérez": devuelve el nombre pedido (o null si es otra cosa: "horario de la semana", "del lunes"…).
const NO_NOMBRE = new Set(['hoy', 'manana', 'semana', 'la semana', 'toda la semana', 'todos', 'todas', 'los alumnos', 'alumnos', 'la institucion', 'institucion', 'ayer', 'mi', 'mis', 'clases']);
function nombreProfesorPedido(mensaje) {
  const t = plano(mensaje);
  const m = /\b(?:horario|clases?)\s+(?:de la|de|del)\s+(?:profesora|profesor|prof\.?|profe)?\s*([a-zñ]+(?: [a-zñ]+){0,3})\s*[?.!]*$/.exec(t)
    || /\bque clases tiene\s+(?:la |el )?(?:profesora |profesor |profe )?([a-zñ]+(?: [a-zñ]+){0,3})\s*[?.!]*$/.exec(t);
  if (!m) return null;
  const n = m[1].trim();
  if (NO_NOMBRE.has(n) || lib.DIAS.some(d => plano(d) === n) || /^(la|el|los|las|un|una|este|esta)\b/.test(n)) return null;
  return n;
}

// Admin: "Cargar horario de Ana Pérez:" + una clase por línea (así llega lo que leyó la foto).
const CARGA_POR_ADMIN = /^\s*(?:cargar|entregar|pasar|subir)\s+(?:el\s+)?horario\s+(?:de la|de|del)\s+(?:profesora|profesor|prof\.?|profe\s+)?\s*([^:\n]{2,60}):[ \t]*\r?\n([\s\S]+)$/i;

function detectarIntencion(mensaje) {
  if (CARGA_POR_ADMIN.test(String(mensaje || ''))) return 'cargar_horario_profesor';
  const t = plano(mensaje);
  if (/\b(backups?|respaldos?|copias? de seguridad)\b/.test(t)) return 'backup';
  if (/\b(imagen|grafico|esquema|dibujo)\b.*\b(horario|cuadrilla|semana|clases)\b|\bgener\w*\s+(una\s+)?imagen/.test(t)) return 'generar_imagen';
  if (/\b(quien|quienes|cuantos|que profesores?|lista de)\b.*\bentreg\w*|\b(falta\w*|pendientes?)\b.*\bentreg\w*|\bentreg\w*\b.*\b(falta\w*|pendientes?)\b/.test(t)) return 'entregas_admin';
  if (/\b(borr\w*|elimin\w*|quit\w*|anul\w*)\b.*\b(horario|entrega|clases)\b|\bconfirmo borrar\b/.test(t) && !entrega.pareceHorario(mensaje)) return 'borrar_entrega';
  if (/\b(mi entrega|horario (entregado|enviado)|(lo que|el horario que) (entregue|envie|mande|pase))\b/.test(t)) return 'ver_entrega';
  if (nombreProfesorPedido(mensaje)) return 'horario_de_profesor';
  if (entrega.pareceHorario(mensaje) || entrega.pideEntregar(mensaje)) return 'entregar_horario';
  if (/\b(lista negra|sancionad\w*)\b/.test(t)) return 'consultar_lista_negra';
  if (/\b(mis mensajes|mensajes nuevos|bandeja)\b/.test(t)) return 'mensajes';
  if (/\b(cambiar|cambio|intercambi\w*|permutar)\b.*\b(horario|clase|turno)\b|\bnecesito cambiar\b|\bintercambio\b/.test(t)) return 'intercambio_horario';
  if (/\bno puedo (dar|ir|asistir)|\bfalto\b|\bfaltare\b|\breemplazo\b|\bsuplente\b|\bcubrir\b|\brelevo\b/.test(t)) return 'buscar_reemplazo';
  if (/\b(salon(es)?|aulas?)\b/.test(t) && /\b(libres?|disponib\w*|ocupad\w*|vacios?)\b/.test(t)) return 'salones_libres';
  if (/\b(mi horario|mis horarios|mis clases|que clases tengo|que tengo|tengo clases?|mi semana|horario personal)\b/.test(t)) return 'mi_horario';
  if (/\b(disponib\w*|libres?)\b/.test(t)) return 'disponibilidad';
  if (/\b(tabla|cuadrilla completa|horario completo)\b|\bver (el |los )?horarios?\b|\bhorarios? de la semana\b/.test(t)) return 'tabla_markdown';
  if (/^(hola|buenas|buen dia|buenos dias|buenas tardes|buenas noches|hey|ayuda|help)\W*$/.test(t) || /\bque (podes|puedes|sabes) hacer\b|\bayuda\b/.test(t)) return 'ayuda';
  return 'ia';
}

function diaMencionado(mensaje) {
  const t = plano(mensaje);
  const dia = lib.DIAS.find(d => new RegExp(`\\b${plano(d)}\\b`).test(t));
  if (dia) return dia;
  const hoy = new Date().getDay();
  if (/\bhoy\b/.test(t)) return NOMBRE_DIA_JS[hoy];
  if (/\bmanana\b/.test(t)) return NOMBRE_DIA_JS[(hoy + 1) % 7];
  return null;
}

// "a las 9", "9:30", "09.30", "9hs" -> "09:00" / "09:30" (o null).
function horaMencionada(mensaje) {
  const t = plano(mensaje);
  const m = /\b(\d{1,2})[:.h](\d{2})\b/.exec(t) || /\ba las (\d{1,2})\b/.exec(t) || /\b(\d{1,2})\s?(?:hs|horas?)\b/.exec(t);
  if (!m) return null;
  return lib.normalizarHora(`${m[1]}:${m[2] && /^\d{2}$/.test(m[2]) ? m[2] : '00'}`);
}


/* -------------------------------- tablas -------------------------------- */
function tablaMarkdown(horarios, vacio = '_No hay clases cargadas en el sistema._') {
  if (!horarios.length) return vacio;
  let tabla = '| Día | Hora | Curso | Materia | Profesor | Salón | Estado |\n|---|---|---|---|---|---|---|\n';
  for (const h of horarios) {
    tabla += `| ${celda(h.dia)} | ${h.hora_inicio}–${h.hora_fin} | ${celda(h.curso)} | ${celda(h.materia)} | ${celda(h.profesor_nombre)} | ${celda(h.salon)} | ${h.estado === 'disponible' ? '🟢 Libre' : '🔴 Ocupada'} |\n`;
  }
  return tabla;
}

const esPersonal = (h) => String(h.origen || '').startsWith('carga-');
// Grilla general (la de los alumnos): sin los horarios personales de los profesores.
// Cada curso se publica por separado: profesores y alumnos solo ven los cursos publicados (el admin ve todo).
const grillaGeneral = (usuario) => lib.horariosOrdenados().filter(h => !esPersonal(h) && ((usuario && usuario.rol === 'admin') || lib.cursoPublicado(h.curso)));
// Todas las clases de un profesor (planilla, entregadas por el asistente o asignadas por el admin).
const clasesPropias = (u) => lib.clasesDeProfesor({ id: u.id || null, nombre: u.nombre });

const LUGAR = { amarillo: 'Liceo', azul: 'UTU', verde: 'Coordinación' };
function tablaPropia(lista) {
  let tabla = '| Día | Hora | Curso | Materia | Lugar |\n|---|---|---|---|---|\n';
  for (const c of lista) {
    const materia = c.curso && c.materia && c.materia !== c.curso ? c.materia : '—';
    tabla += `| ${celda(c.dia)} | ${c.hora_inicio}–${c.hora_fin} | ${celda(c.curso || c.materia)} | ${celda(materia)} | ${celda(LUGAR[c.color] || c.salon)} |\n`;
  }
  return tabla;
}
const horasDe = (lista) => lista.reduce((acc, h) => acc + (lib.aMinutos(h.hora_fin) - lib.aMinutos(h.hora_inicio)) / 60, 0);

function ayuda(usuario) {
  const esProfe = usuario.rol === 'profesor';
  const lineas = [
    esProfe ? '- **ver tabla**: tu horario semanal en una tabla' : '- **ver tabla** de la grilla de los alumnos',
    esProfe ? '- **generar imagen**: tu horario semanal en imagen' : '- **generar imagen** de la grilla, o **imagen del horario de Ana** para un profesor',
    '- **disponibilidad**: clases libres sin profesor',
    '- **mis mensajes**: avisos de intercambios y relevos',
    '- **¿qué salones están libres el lunes a las 9?**: salones libres y ocupados a esa hora'
  ];
  if (usuario.rol === 'profesor') {
    lineas.push('- **entregar mi horario**: pasame tu horario semanal (obligatorio) y lo envío a la administración',
      '- **ver mi horario entregado** · **borrar mi horario del lunes** · **borrar mi horario**: revisá y corregí lo que entregaste');
    lineas.push('- **mi horario** (o **qué tengo el lunes**): tus clases de la semana', '- **cambiar horario**: busco a un colega para intercambiar',
      '- **no puedo dar clase el lunes**: te muestro quién puede reemplazarte y aviso a la administración');
  } else {
    lineas.push('- **¿quién falta entregar el horario?**: profesores que todavía no lo entregaron',
      '- **horario de Ana**: las clases de un profesor',
      '- **reemplazo para el lunes**: profesores libres para cada clase de ese día',
      '- **lista negra**: profesores que alcanzaron el límite de faltas',
      '- **hacer backup** / **ver backups**: copias de seguridad');
  }
  const pendiente = usuario.rol === 'profesor' && !entrega.yaEntrego(usuario.id) ? `⚠️ **Todavía no entregaste tu horario semanal y es obligatorio.** ${PEDIDO_HORARIO}\n\n` : '';
  return `${pendiente}Hola **${usuario.nombre}** 👋 Esto puedo hacer por vos:\n\n${lineas.join('\n')}\n\nTambién podés preguntarme cualquier otra cosa.`;
}

/* --------------------------- entrega del horario --------------------------- */
const PEDIDO_HORARIO = 'Escribime tu horario semanal, una clase por línea, con el día, la hora, el curso y el lugar (liceo, UTU o coordinación). Por ejemplo:\n\n' + entrega.EJEMPLO.split('\n').map(l => `- \`${l}\``).join('\n');

function entregarHorario(ctx) {
  const { usuario, mensaje } = ctx;
  if (usuario.rol !== 'profesor') return texto('El horario semanal lo entregan los profesores desde su cuenta. Como administrador lo ves en **Por profesor**' + (usuario.rol === 'admin' ? ', donde también aparece quién todavía no lo entregó.' : '.'));
  if (!entrega.pareceHorario(mensaje)) {
    return texto(`📝 Pasar tu horario semanal es **obligatorio**. ${PEDIDO_HORARIO}\n\nPodés pegarlo todo junto en un solo mensaje, o escribirlo más suelto, por ejemplo: _los lunes y miércoles de 8 a 10 con 3°MA en el liceo_. Si ya habías entregado, lo que mandes reemplaza las clases de esos días.`);
  }
  const { clases, errores } = entrega.parsearHorario(mensaje);
  if (errores.length) {
    return texto(`No guardé nada porque hay líneas que no pude interpretar:\n\n${errores.map(e => `- ${e}`).join('\n')}\n\nCorregilas y mandame el horario de nuevo (lo que mandes reemplaza esos días). Formato: \`Lunes 07:30-09:00 3°MA liceo\`.`);
  }
  if (!clases.length) return texto(`No encontré clases en tu mensaje. ${PEDIDO_HORARIO}`);
  const antes = entrega.estadoEntrega(usuario.id).entregado;
  const { dias, total } = entrega.guardarEntrega(usuario, clases);
  const sinLugar = clases.filter(c => !c.color).length;
  return texto(`✅ ${antes ? 'Actualicé' : 'Recibí'} tu horario semanal (${dias.map(d => d.toLowerCase()).join(', ')}) y ya se lo pasé a la administración: aparece en su sección **Por profesor**.\n\n` +
    `Tu horario entregado tiene **${total}** clase${total === 1 ? '' : 's'}:\n\n${tablaEntregadas(entrega.entregadas(usuario.id))}` +
    `${sinLugar ? `\n_${sinLugar} clase${sinLugar === 1 ? '' : 's'} sin lugar (liceo/UTU)._\n` : ''}\n` +
    `Para corregir un día, mandame solo ese día (reemplaza las clases de ese día). También: **borrar mi horario del lunes** o **ver mi horario entregado**.`);
}

// Admin carga el horario de un profesor (por ejemplo, leído de una foto). Reemplaza solo los días que incluya.
function cargarHorarioDeProfesor({ usuario, mensaje }) {
  if (usuario.rol !== 'admin') return texto('🔒 Cargar el horario de otro profesor es solo para la administración. Para el tuyo mandame tu horario directamente.');
  const m = CARGA_POR_ADMIN.exec(mensaje);
  const nombre = m[1].trim();
  const coinciden = entrega.buscarProfesores(nombre);
  if (!coinciden.length) return texto(`No encontré a ningún profesor que se llame "${nombre}".`);
  if (coinciden.length > 1) return texto(`Hay varios que coinciden con "${nombre}": ${coinciden.slice(0, 8).map(p => `**${p.nombre}**`).join(', ')}. Decime el nombre completo.`);
  const p = coinciden[0];
  if (!p.id) return texto(`**${p.nombre}** todavía no tiene cuenta, así que no puedo guardarle el horario. Se crea con \`npm run cargar-profesores\` o cuando se registre.`);
  const { clases, errores } = entrega.parsearHorario(m[2]);
  if (errores.length) {
    return texto(`No guardé nada: hay líneas que no pude interpretar (revisá las que la foto marcó con "?"):\n\n${errores.map(e => `- ${e}`).join('\n')}\n\nCorregilas y mandalo de nuevo. Formato: \`Lunes 07:30-09:00 3°MA liceo\`.`);
  }
  if (!clases.length) return texto('No encontré clases en el texto.');
  const antes = entrega.estadoEntrega(p.id).entregado;
  const { dias, total } = entrega.guardarEntrega({ id: p.id, nombre: p.nombre }, clases);
  return texto(`✅ ${antes ? 'Actualicé' : 'Cargué'} el horario de **${p.nombre}** (${dias.map(d => d.toLowerCase()).join(', ')}). Ahora tiene **${total}** clase${total === 1 ? '' : 's'} entregadas; lo ves en **Por profesor**.\n\n${tablaEntregadas(entrega.entregadas(p.id))}`);
}

const ordenClases = (a, b) => lib.DIAS.indexOf(a.dia) - lib.DIAS.indexOf(b.dia) || lib.aMinutos(a.hora_inicio) - lib.aMinutos(b.hora_inicio);
function tablaEntregadas(lista) {
  let tabla = '| Día | Hora | Curso | Lugar |\n|---|---|---|---|\n';
  for (const c of [...lista].sort(ordenClases)) tabla += `| ${celda(c.dia)} | ${c.hora_inicio}–${c.hora_fin} | ${celda(c.curso || c.materia)} | ${LUGAR[c.color] || '—'} |\n`;
  return tabla;
}

function verEntrega({ usuario }) {
  if (usuario.rol !== 'profesor') return texto('Eso es para profesores. Como administrador mirá los horarios en **Por profesor** o escribí **horario de Ana**.');
  const lista = entrega.entregadas(usuario.id);
  if (!lista.length) return texto(`Todavía no entregaste tu horario por acá. ${PEDIDO_HORARIO}`);
  const e = entrega.estadoEntrega(usuario.id);
  return texto(`📋 **Tu horario entregado** (${lista.length} clase${lista.length === 1 ? '' : 's'}${e.enviado_en ? ', última actualización ' + e.enviado_en + ' UTC' : ''}):\n\n${tablaEntregadas(lista)}\nPara corregir un día, mandame ese día de nuevo. Para quitar clases: **borrar mi horario del lunes** o **borrar mi horario**.`);
}

function borrarEntrega({ usuario, mensaje }) {
  if (usuario.rol !== 'profesor') return texto('Eso es para profesores.');
  const t = plano(mensaje);
  const lista = entrega.entregadas(usuario.id);
  if (!lista.length) return texto('No tenés clases entregadas por el asistente para borrar.');
  const dia = lib.DIAS.find(d => new RegExp(`\\b${plano(d)}\\b`).test(t));
  if (dia) {
    if (!lista.some(c => c.dia === dia)) return texto(`No tenés clases entregadas el ${dia}.`);
    const r = entrega.borrarEntrega(usuario, dia);
    return texto(r.quedan
      ? `🗑️ Borré las clases del **${dia}** (${r.borradas}). Te quedan ${r.quedan}. Mandame el ${dia} de nuevo si querés cargarlo bien.`
      : `🗑️ Borré las clases del **${dia}** y ya no te queda nada entregado: tenés que entregar tu horario de nuevo (es obligatorio). ${PEDIDO_HORARIO}`);
  }
  if (!/\bconfirmo\b/.test(t)) {
    return texto(`⚠️ Vas a borrar **todo** tu horario entregado (${lista.length} clase${lista.length === 1 ? '' : 's'}) y vas a tener que entregarlo de nuevo. Para confirmar escribí **confirmo borrar todo**. Si solo querés quitar un día: **borrar mi horario del lunes**.`);
  }
  const r = entrega.borrarEntrega(usuario);
  return texto(`🗑️ Borré tu horario entregado (${r.borradas} clases).${entrega.yaEntrego(usuario.id) ? '' : ` Recordá que es obligatorio entregarlo de nuevo. ${PEDIDO_HORARIO}`}`);
}

function entregasAdmin({ usuario }) {
  if (usuario.rol !== 'admin') return texto('🔒 Ese resumen es solo para la administración.');
  const { profesores, pendientes } = entrega.resumenAdmin();
  if (!profesores.length) return texto('Todavía no hay profesores con cuenta.');
  const faltan = profesores.filter(p => !p.entregado), ok = profesores.filter(p => p.entregado);
  return texto(`📝 **Entrega del horario semanal:** ${ok.length} de ${profesores.length} entregaron.\n\n` +
    (pendientes ? `⏳ **Faltan (${faltan.length}):**\n${faltan.map(p => `- ${p.nombre}`).join('\n')}\n\n_En **Por profesor** podés tocar 🔔 Recordarles._\n\n` : '🟢 Todos entregaron.\n\n') +
    (ok.length ? `✅ **Entregaron (${ok.length}):** ${ok.map(p => p.nombre).join(', ')}` : ''));
}

function horarioDeProfesor({ usuario, mensaje }) {
  if (usuario.rol !== 'admin') return texto('🔒 El horario de otros profesores lo ve solo la administración. Para el tuyo escribí **mi horario**.');
  const nombre = nombreProfesorPedido(mensaje);
  const coinciden = entrega.buscarProfesores(nombre);
  if (!coinciden.length) return texto(`No encontré a ningún profesor que se llame "${nombre}".`);
  if (coinciden.length > 1) return texto(`Hay varios que coinciden con "${nombre}": ${coinciden.slice(0, 8).map(p => `**${p.nombre}**`).join(', ')}. Decime el nombre completo.`);
  const p = coinciden[0];
  lib.vincularBloquesPorNombre();
  const clases = lib.clasesDeProfesor({ id: p.id || null, nombre: p.nombre });
  const e = p.id ? entrega.estadoEntrega(p.id) : null;
  const estadoE = e ? (e.entregado ? '✅ entregó su horario' : '⏳ todavía no entregó su horario') : 'sin cuenta todavía';
  if (!clases.length) return texto(`**${p.nombre}** (${estadoE}) no tiene clases cargadas.`);
  const horas = clases.reduce((acc, h) => acc + (lib.aMinutos(h.hora_fin) - lib.aMinutos(h.hora_inicio)) / 60, 0);
  return texto(`**${p.nombre}** · ${estadoE} · ${clases.length} clases, ${horasTxt(horas)} por semana:\n\n${tablaEntregadas(clases)}`);
}

const AVISO_ENTREGA = '📝 Antes de seguir tenés que **entregar tu horario semanal** (es obligatorio). ' + PEDIDO_HORARIO;

/* ------------------------------ imagen (SVG) ------------------------------ */
const escXml = (t) => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const recortar = (t, n) => { t = String(t ?? ''); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

// Mismo color por materia que en la web.
function matiz(materia) {
  let h = 5381;
  const s = plano(materia);
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return Math.round(((h % 16) * 22.5 + 8) % 360);
}

const COLOR_LUGAR = { amarillo: 48, azul: 215, verde: 140 };
function svgHorario(horarios, usuario, { propio = false } = {}) {
  const dias = horarios.some(h => h.dia === 'Sábado') ? lib.DIAS : lib.DIAS.slice(0, 5);
  const ancho = 168, alto = 62, sep = 8, margen = 20, cabecera = 86;
  const porDia = Object.fromEntries(dias.map(d => [d, horarios.filter(h => h.dia === d)]));
  const filas = Math.max(1, ...dias.map(d => porDia[d].length));
  const W = margen * 2 + dias.length * ancho + (dias.length - 1) * sep;
  const H = cabecera + filas * (alto + sep) + 34;

  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="system-ui, Arial, sans-serif">`;
  s += `<rect width="100%" height="100%" fill="#F9F6F0"/>`;
  s += `<text x="${margen}" y="36" font-size="22" font-weight="700" fill="#201C12">Cuadrilla · Horario semanal</text>`;
  s += `<text x="${margen}" y="58" font-size="12" fill="#777">${horarios.length} clases · ${propio ? 'horario de ' + escXml(usuario.nombre) : 'pedido por ' + escXml(usuario.nombre) + ' (' + escXml(usuario.rol) + ')'}</text>`;
  dias.forEach((d, i) => {
    const x = margen + i * (ancho + sep);
    s += `<rect x="${x}" y="66" width="${ancho}" height="${alto - 40}" rx="8" fill="#1F2937"/>`;
    s += `<text x="${x + ancho / 2}" y="82" font-size="13" font-weight="700" fill="#fff" text-anchor="middle">${escXml(d)}</text>`;
    porDia[d].forEach((h, j) => {
      const y = cabecera + j * (alto + sep);
      // En el horario propio el color es el lugar (amarillo liceo · azul UTU · verde coordinación), como en la web.
      const m = propio && COLOR_LUGAR[h.color] !== undefined ? COLOR_LUGAR[h.color] : matiz(h.materia);
      s += `<rect x="${x}" y="${y}" width="${ancho}" height="${alto}" rx="10" fill="hsl(${m} 75% 91%)" stroke="hsl(${m} 55% 45%)" stroke-width="1.5"/>`;
      s += `<text x="${x + 10}" y="${y + 17}" font-size="11" fill="#555">${escXml(h.hora_inicio)} – ${escXml(h.hora_fin)}</text>`;
      s += `<text x="${x + 10}" y="${y + 34}" font-size="13" font-weight="700" fill="#201C12">${escXml(recortar(propio ? (h.curso || h.materia) : h.materia, 21))}</text>`;
      const linea3 = propio ? [LUGAR[h.color], h.salon, h.curso && h.materia !== h.curso ? h.materia : null].filter(Boolean).join(' · ') || '—'
        : [h.profesor_nombre, h.salon].filter(Boolean).join(' · ') || 'Sin profesor';
      s += `<text x="${x + 10}" y="${y + 50}" font-size="11" fill="#444">${escXml(recortar(linea3, 28))}</text>`;
    });
  });
  return s + '</svg>';
}

const imagenSvg = (svg, respuesta) => ({ tipo: 'imagen', respuesta, imagen_url: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}` });
const SIN_CLASES_PROPIAS = `Todavía no tenés clases cargadas. ${'Mandame tu horario (podés subir una foto con el botón 📷) y lo guardo.'}`;

function imagenHorario({ usuario, mensaje }) {
  if (usuario.rol === 'profesor') {
    const mias = clasesPropias(usuario);
    if (!mias.length) return texto(SIN_CLASES_PROPIAS);
    return imagenSvg(svgHorario(mias, usuario, { propio: true }), `Aquí tenés tu horario semanal en imagen (${mias.length} clase${mias.length === 1 ? '' : 's'}):`);
  }
  const pedido = nombreProfesorPedido(mensaje);
  if (pedido) {
    const coinciden = entrega.buscarProfesores(pedido);
    if (!coinciden.length) return texto(`No encontré a ningún profesor que se llame "${pedido}".`);
    if (coinciden.length > 1) return texto(`Hay varios que coinciden con "${pedido}": ${coinciden.slice(0, 8).map(p => `**${p.nombre}**`).join(', ')}. Decime el nombre completo.`);
    const p = coinciden[0];
    lib.vincularBloquesPorNombre();
    const clases = clasesPropias({ id: p.id || null, nombre: p.nombre });
    if (!clases.length) return texto(`**${p.nombre}** no tiene clases cargadas todavía.`);
    return imagenSvg(svgHorario(clases, { nombre: p.nombre, rol: 'profesor' }, { propio: true }), `Aquí tenés el horario de **${p.nombre}** en imagen:`);
  }
  const grilla = grillaGeneral(usuario);
  if (!grilla.length) return texto('La grilla de los alumnos todavía no tiene clases. Para ver el horario de un profesor escribí **imagen del horario de Ana**.');
  return imagenSvg(svgHorario(grilla, usuario), 'Aquí tenés el horario semanal en imagen:');
}

function tablaDeHorario({ usuario }) {
  if (usuario.rol === 'profesor') {
    const mias = clasesPropias(usuario);
    if (!mias.length) return texto(SIN_CLASES_PROPIAS);
    return texto(`📋 **Tu horario semanal** · ${mias.length} clase${mias.length === 1 ? '' : 's'}, ${horasTxt(horasDe(mias))} por semana:\n\n${tablaPropia(mias)}`);
  }
  return texto(tablaMarkdown(grillaGeneral(usuario), '_La grilla de los alumnos todavía no tiene clases. Para ver a un profesor escribí **horario de Ana**._'));
}

function miHorario({ usuario, mensaje }) {
  if (usuario.rol !== 'profesor') return texto('Esa opción es para profesores. Para ver todo escribí **ver tabla**, o **horario de Ana** para un profesor.');
  const todas = clasesPropias(usuario);
  if (!todas.length) return texto(SIN_CLASES_PROPIAS);
  const dia = diaMencionado(mensaje);
  if (dia) {
    const deDia = todas.filter(h => h.dia === dia);
    return texto(deDia.length
      ? `⭐ **Tus clases del ${dia}** (${deDia.length}):\n\n${tablaPropia(deDia)}`
      : `No tenés clases el ${dia}.`);
  }
  return texto(`⭐ **Tu horario semanal** · ${todas.length} clase${todas.length === 1 ? '' : 's'}, ${horasTxt(horasDe(todas))} por semana:\n\n${tablaPropia(todas)}\nTambién lo ves en **Mi horario**.`);
}

/* ------------------------------ intercambios ------------------------------ */
const etiquetaClase = (h) => `${h.materia} (${h.dia} ${h.hora_inicio})`;

function elegirClasePropia(usuario, horarioId, mensaje) {
  if (horarioId) return db.prepare('SELECT * FROM horarios WHERE id = ? AND profesor_id = ?').get(horarioId, usuario.id);
  const propias = db.prepare(`SELECT * FROM horarios WHERE profesor_id = ? ORDER BY ${lib.ORDEN_DIA_SQL}, hora_inicio`).all(usuario.id);
  const dia = diaMencionado(mensaje);
  return (dia && propias.find(h => h.dia === dia)) || propias[0] || null;
}

function buscarYCruzarCambios(usuario, h) {
  db.exec('BEGIN');
  try {
    db.prepare('INSERT INTO solicitudes_cambio (profesor_id, profesor_nombre, horario_actual_id, motivo) VALUES (?, ?, ?, ?)')
      .run(usuario.id, usuario.nombre, h.id, 'Busca intercambio de horario');
    const miSolicitud = db.prepare('SELECT last_insert_rowid() AS id').get().id;

    const otra = db.prepare(`SELECT * FROM solicitudes_cambio WHERE profesor_id != ? AND estado = 'pendiente' ORDER BY id LIMIT 1`).get(usuario.id);
    let resultado = { emparejado: false };
    if (otra) {
      const suyo = db.prepare('SELECT * FROM horarios WHERE id = ?').get(otra.horario_actual_id);
      db.prepare(`UPDATE solicitudes_cambio SET estado = 'emparejado', pareja_id = ? WHERE id = ?`).run(miSolicitud, otra.id);
      db.prepare(`UPDATE solicitudes_cambio SET estado = 'emparejado', pareja_id = ? WHERE id = ?`).run(otra.id, miSolicitud);
      const aviso = (yo, otro, mia, suya) =>
        `El sistema encontró un posible intercambio: tu clase ${etiquetaClase(mia)} ↔ la de ${otro} ${suya ? etiquetaClase(suya) : ''}. Para que se haga efectivo la administración tiene que aprobarlo: te aviso apenas lo decida.`;
      const ins = db.prepare(`INSERT INTO mensajes (remitente_id, remitente_nombre, destinatario_id, destinatario_nombre, contenido, tipo)
                              VALUES (NULL, 'Sistema Cuadrilla', ?, ?, ?, 'intercambio')`);
      ins.run(usuario.id, usuario.nombre, aviso(usuario.nombre, otra.profesor_nombre, h, suyo));
      ins.run(otra.profesor_id, otra.profesor_nombre, aviso(otra.profesor_nombre, usuario.nombre, suyo || h, h));
      for (const ad of db.prepare("SELECT id, nombre FROM usuarios WHERE rol = 'admin'").all()) {
        ins.run(ad.id, ad.nombre, `Intercambio por aprobar: ${usuario.nombre} (${etiquetaClase(h)}) ↔ ${otra.profesor_nombre} (${suyo ? etiquetaClase(suyo) : 'su clase'}). Revisalo en la sección Cambios.`);
      }
      resultado = { emparejado: true, companero: otra.profesor_nombre };
    }
    db.exec('COMMIT');
    return resultado;
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

function intercambio(ctx) {
  const { usuario, horarioId, mensaje } = ctx;
  if (usuario.rol !== 'profesor') return texto('El intercambio de horarios lo piden los profesores desde su cuenta. Como administrador podés editar las clases desde la sección **Horario**.');
  const h = elegirClasePropia(usuario, horarioId, mensaje);
  if (!h) return texto('No encontré clases asignadas a tu cuenta para intercambiar. Si querés una, mirá las clases libres con **disponibilidad**.');
  const repetida = db.prepare(`SELECT id FROM solicitudes_cambio WHERE profesor_id = ? AND horario_actual_id = ? AND estado = 'pendiente'`).get(usuario.id, h.id);
  if (repetida) return texto(`Ya tenés una solicitud pendiente para **${etiquetaClase(h)}**. Te aviso apenas aparezca un colega compatible (escribí **mis mensajes** para revisar).`);
  const r = buscarYCruzarCambios(usuario, h);
  return texto(r.emparejado
    ? `¡Buenas noticias! Hubo coincidencia con **${r.companero}** para **${etiquetaClase(h)}**. La administración tiene que aprobarlo; escribí **mis mensajes** para ver los detalles.`
    : `Registré tu pedido de intercambio para **${etiquetaClase(h)}**. Cuando otro profesor pida un cambio te voy a avisar (escribí **mis mensajes** para revisar).\n\n_Si querías cambiar otra clase, decime el día: "cambiar horario del jueves"._`);
}

function mensajes(usuario) {
  const lista = db.prepare('SELECT * FROM mensajes WHERE destinatario_id = ? ORDER BY creado_en DESC, id DESC LIMIT 10').all(usuario.id);
  if (!lista.length) return texto('📭 No tenés mensajes.');
  db.prepare('UPDATE mensajes SET leido = 1 WHERE destinatario_id = ? AND leido = 0').run(usuario.id);
  return texto(`📬 **Tus últimos mensajes:**\n\n${lista.map(m => `- ${m.leido ? '' : '🆕 '}**${celda(m.remitente_nombre)}** (${m.creado_en}): ${m.contenido}`).join('\n')}`);
}

/* -------------------------------- reemplazos -------------------------------- */
function profesoresLibres(h) {
  const ini = lib.aMinutos(h.hora_inicio), fin = lib.aMinutos(h.hora_fin);
  const ocupados = new Set(db.prepare('SELECT profesor_id, hora_inicio, hora_fin FROM horarios WHERE dia = ? AND profesor_id IS NOT NULL AND id != ?')
    .all(h.dia, h.id)
    .filter(r => ini < lib.aMinutos(r.hora_fin) && fin > lib.aMinutos(r.hora_inicio))
    .map(r => r.profesor_id));
  const carga = lib.cargaDeProfesores();
  // Orden: primero quien tiene menos horas esta semana; al final quienes están cerca del límite de faltas (o ya en lista negra).
  return lib.listaProfesores()
    .filter(p => p.id !== h.profesor_id && !ocupados.has(p.id))
    .map(p => ({ ...p, ...(carga.get(p.id) || { horas: 0, faltas: 0, riesgo: 0 }) }))
    .sort((a, b) => a.riesgo - b.riesgo || a.horas - b.horas || a.nombre.localeCompare(b.nombre, 'es'));
}
const horasTxt = (n) => `${n.toFixed(1).replace('.0', '')} h`;
const etiquetaProfe = (p) => `${p.nombre} (${horasTxt(p.horas)}${p.riesgo === 2 ? ', 🚫 lista negra' : p.riesgo === 1 ? `, ⚠️ ${p.faltas} faltas` : ''})`;
const LEYENDA_ORDEN = '_Orden: ⭐ el sugerido tiene menos horas esta semana; al final van quienes están cerca del límite de faltas._';
// Profesores con cuenta que a esa hora están dando otra clase (en otro lugar), con la clase que tienen.
function profesoresEnOtroLugar(h) {
  const ini = lib.aMinutos(h.hora_inicio), fin = lib.aMinutos(h.hora_fin);
  const vistos = new Set();
  return db.prepare('SELECT * FROM horarios WHERE dia = ? AND profesor_id IS NOT NULL AND id != ? ORDER BY hora_inicio').all(h.dia, h.id)
    .filter(r => r.profesor_id !== h.profesor_id && ini < lib.aMinutos(r.hora_fin) && fin > lib.aMinutos(r.hora_inicio))
    .filter(r => !vistos.has(r.profesor_id) && vistos.add(r.profesor_id))
    .map(r => `${r.profesor_nombre} (en ${r.materia}${r.salon ? ', ' + r.salon : ''})`);
}
const enOtroLugar = (h) => { const l = profesoresEnOtroLugar(h); return l.length ? ` · 📍 En otro lugar a esa hora: ${l.slice(0, 6).join(', ')}${l.length > 6 ? ` y ${l.length - 6} más` : ''}` : ''; };
const nombres = (ps) => ps.length ? ps.slice(0, 6).map((p, i) => (i === 0 && p.riesgo === 0 ? '⭐ ' : '') + etiquetaProfe(p)).join(', ') + (ps.length > 6 ? ` y ${ps.length - 6} más` : '') : 'nadie libre en ese horario';

function reemplazo(ctx) {
  const { usuario, horarioId, mensaje } = ctx;
  const dia = diaMencionado(mensaje);

  if (usuario.rol === 'admin') {
    if (!dia) return texto('Decime para qué día buscar reemplazos, por ejemplo: **reemplazo para el lunes**.');
    const clases = db.prepare('SELECT * FROM horarios WHERE dia = ? ORDER BY hora_inicio').all(dia);
    if (!clases.length) return texto(`No hay clases cargadas el ${dia}.`);
    return texto(`**Profesores libres por clase — ${dia}:**\n\n${clases.map(h => `- **${h.materia}** ${h.hora_inicio}–${h.hora_fin}${h.profesor_nombre ? ` (${h.profesor_nombre})` : ''}: ${nombres(profesoresLibres(h))}${enOtroLugar(h)}`).join('\n')}\n\n${LEYENDA_ORDEN}`);
  }

  let clases;
  if (horarioId) {
    const h = db.prepare('SELECT * FROM horarios WHERE id = ? AND profesor_id = ?').get(horarioId, usuario.id);
    clases = h ? [h] : [];
  } else {
    const d = dia || NOMBRE_DIA_JS[new Date().getDay()];
    clases = db.prepare('SELECT * FROM horarios WHERE profesor_id = ? AND dia = ? ORDER BY hora_inicio').all(usuario.id, d);
    if (!clases.length) return texto(`No encontré clases tuyas el ${d}. Indicame el día, por ejemplo: **no puedo dar clase el lunes**.`);
  }
  if (!clases.length) return texto('No encontré esa clase en tu horario.');

  const admins = db.prepare("SELECT id, nombre FROM usuarios WHERE rol = 'admin'").all();
  const avisar = db.prepare(`INSERT INTO mensajes (remitente_id, remitente_nombre, destinatario_id, destinatario_nombre, contenido, tipo) VALUES (?, ?, ?, ?, ?, 'relevo')`);
  const yaAvisado = db.prepare(`SELECT id FROM mensajes WHERE remitente_id = ? AND destinatario_id = ? AND contenido = ? AND tipo = 'relevo' AND creado_en >= datetime('now', '-1 day')`);
  const lineas = [];
  for (const h of clases) {
    const libres = profesoresLibres(h);
    lineas.push(`- **${h.materia}** ${h.dia} ${h.hora_inicio}–${h.hora_fin}: ${nombres(libres)}${enOtroLugar(h)}`);
    const contenido = `${usuario.nombre} no puede dar ${etiquetaClase(h)}. Profesores libres: ${nombres(libres)}.`;
    for (const a of admins) if (!yaAvisado.get(usuario.id, a.id, contenido)) avisar.run(usuario.id, usuario.nombre, a.id, a.nombre, contenido);
  }
  return texto(`Entendido. Estos profesores están libres para cubrirte:\n\n${lineas.join('\n')}\n\n${LEYENDA_ORDEN}\n\n${admins.length ? '📣 Avisé a la administración para que asigne el reemplazo.' : '⚠️ No hay administradores registrados para avisar: contactá a la institución.'}`);
}

/* ------------------------------ salones libres ------------------------------ */
function salonesLibres(ctx) {
  const { mensaje } = ctx;
  const dia = diaMencionado(mensaje) || NOMBRE_DIA_JS[new Date().getDay()];
  if (!lib.DIAS.includes(dia)) return texto(`El ${dia.toLowerCase()} no hay clases.`);
  const todos = lib.listaSalones();
  if (!todos.length) return texto('Todavía no hay salones cargados en el horario. Agregá el salón al crear o editar las clases.');
  const hora = horaMencionada(mensaje);
  const nombrado = todos.find(s => plano(mensaje).includes(plano(s)));

  if (nombrado) {
    if (!hora) {
      const clases = lib.clasesDeSalon(nombrado).filter(h => h.dia === dia);
      return texto(clases.length
        ? `**${nombrado} — ${dia}:**\n\n${clases.map(h => `- ${h.hora_inicio}–${h.hora_fin}: ${h.materia}${h.profesor_nombre ? ` (${h.profesor_nombre})` : ''}`).join('\n')}`
        : `🟢 ${nombrado} no tiene clases el ${dia}: está libre todo el día.`);
    }
    const e = lib.estadoSalones(dia, hora).find(x => x.salon === nombrado);
    return texto(e.libre ? `🟢 ${nombrado} está libre el ${dia} a las ${hora}.`
      : `🔴 ${nombrado} está ocupado el ${dia} a las ${hora}: ${e.clase.materia}${e.clase.profesor_nombre ? ` (${e.clase.profesor_nombre})` : ''}, ${e.clase.hora_inicio}–${e.clase.hora_fin}.`);
  }
  if (!hora) return texto('Decime a qué hora, por ejemplo: **¿qué salones están libres el lunes a las 9?**');
  const estado = lib.estadoSalones(dia, hora);
  const libres = estado.filter(e => e.libre), ocupados = estado.filter(e => !e.libre);
  return texto(`**Salones el ${dia} a las ${hora}:**\n\n🟢 **Libres (${libres.length}):** ${libres.map(e => e.salon).join(', ') || 'ninguno'}\n\n🔴 **Ocupados (${ocupados.length}):**\n${ocupados.map(e => `- ${e.salon}: ${e.clase.materia}${e.clase.profesor_nombre ? ` (${e.clase.profesor_nombre})` : ''}, ${e.clase.hora_inicio}–${e.clase.hora_fin}`).join('\n') || '- ninguno'}`);
}

/* ---------------------------------- backup ---------------------------------- */
function respaldo(usuario, mensaje) {
  // Los respaldos son solo del administrador: a cualquier otro rol no se le da ninguna información.
  if (usuario.rol !== 'admin') return texto('🔒 Los backups solo los puede gestionar el administrador.');
  if (/\b(lista|listar|ver|cuales|cuantos|historial)\b/.test(plano(mensaje))) {
    const lista = backup.listarBackups();
    return texto(lista.length
      ? `**Backups disponibles (${lista.length}):**\n\n${lista.slice(0, 10).map(b => `- ${b.nombre} · ${kb(b.tamano)} · ${b.tipo}`).join('\n')}\n\nDescargá o restaurá desde la sección **Backup**.`
      : 'Todavía no hay backups. Escribí **hacer backup** para crear el primero.');
  }
  const b = backup.crearBackup('manual');
  return texto(`✅ Backup creado: **${b.nombre}** (${kb(b.tamano)}). Podés descargarlo o restaurarlo desde la sección **Backup**.`);
}

/* ------------------------------------ IA ------------------------------------ */
function contextoIA(usuario) {
  // El admin ve todo; el profesor solo sus propias clases y las clases libres (nunca el horario de otros profesores).
  const base = usuario.rol === 'admin' ? lib.horariosOrdenados()
    : [...clasesPropias(usuario), ...grillaGeneral(usuario).filter(h => h.estado === 'disponible')];
  const filas = base.slice(0, 200)
    .map(h => `${h.dia} ${h.hora_inicio}-${h.hora_fin} ${h.curso ? 'curso ' + h.curso + ', ' : ''}${h.materia}, ${h.salon || 's/salón'}, ${h.profesor_nombre ? 'Prof. ' + h.profesor_nombre : 'sin profesor (libre)'}`);
  return `Sos el asistente de Cuadrilla, una plataforma de horarios escolares. Hablás con ${usuario.nombre}, que tiene el rol de ${usuario.rol}. ` +
    `Respondé en español, de forma clara, breve y amable. Podés usar Markdown simple. ` +
    `Para responder sobre horarios usá SOLO estos datos reales (si algo no figura, decilo; no inventes):\n${filas.join('\n') || '(todavía no hay clases cargadas)'}`;
}

async function consultarIA(ctx, deps) {
  const { usuario, mensaje, historial } = ctx;
  if (!deps.generarIA) {
    return texto(`Todavía no tengo la IA conectada (falta configurar GEMINI_API_KEY), pero con lo que sé hacer te ayudo igual.\n\n${ayuda(usuario)}`);
  }
  try {
    const out = await deps.generarIA({ system: contextoIA(usuario), historial, mensaje });
    return texto((out || '').trim() || 'No pude armar una respuesta. ¿Podés reformular la pregunta?');
  } catch (e) {
    console.error('[chatbot] fallo de la IA:', e.message);
    return texto(`Ahora mismo no puedo consultar a la IA. Probá de nuevo en un rato.\n\nMientras tanto, esto sí puedo hacerlo:\n\n${ayuda(usuario)}`);
  }
}

/* ------------------------------- punto de entrada ------------------------------- */
async function responder(ctx, deps = {}) {
  const { usuario } = ctx;
  const intencion = detectarIntencion(ctx.mensaje);
  // Obligatorio: el profesor que no entregó su horario semanal no puede pedir intercambios ni reemplazos.
  if (usuario.rol === 'profesor' && ['intercambio_horario', 'buscar_reemplazo'].includes(intencion) && !entrega.yaEntrego(usuario.id)) {
    return texto(AVISO_ENTREGA);
  }
  switch (intencion) {
    case 'cargar_horario_profesor': return cargarHorarioDeProfesor(ctx);
    case 'entregar_horario': return entregarHorario(ctx);
    case 'ver_entrega': return verEntrega(ctx);
    case 'borrar_entrega': return borrarEntrega(ctx);
    case 'entregas_admin': return entregasAdmin(ctx);
    case 'horario_de_profesor': return horarioDeProfesor(ctx);
    case 'backup': return respaldo(usuario, ctx.mensaje);
    case 'generar_imagen': return imagenHorario(ctx);
    case 'consultar_lista_negra': {
      if (usuario.rol !== 'admin') return texto('🔒 La lista negra es información exclusiva de la administración.');
      const lista = lib.listaNegraActual();
      return texto(lista.length
        ? `⚠️ **Profesores con ${lib.LIMITE_FALTAS} faltas o más (lista negra):**\n\n${lista.map(l => `- **${l.profesor_nombre}**: ${l.total_faltas} faltas (última: ${l.ultima_falta})`).join('\n')}`
        : `🟢 Nadie alcanzó el límite de ${lib.LIMITE_FALTAS} faltas.`);
    }
    case 'mensajes': return mensajes(usuario);
    case 'salones_libres': return salonesLibres(ctx);
    case 'intercambio_horario': return intercambio(ctx);
    case 'buscar_reemplazo': return reemplazo(ctx);
    case 'mi_horario': return miHorario(ctx);
    case 'disponibilidad': {
      const grilla = grillaGeneral(usuario);
      if (!grilla.length) return texto('Todavía no hay clases cargadas en la grilla de los alumnos, así que no hay clases libres para mostrar.');
      const libres = grilla.filter(h => h.estado === 'disponible');
      return texto(libres.length
        ? `**Clases libres (${libres.length}):**\n\n${tablaMarkdown(libres)}\n${usuario.rol === 'profesor' ? '\nSi alguna te interesa, pedísela a la administración.' : ''}`
        : '🔴 No hay clases libres: todas tienen profesor asignado.');
    }
    case 'tabla_markdown': return tablaDeHorario(ctx);
    case 'ayuda': return texto(ayuda(usuario));
    default: return consultarIA(ctx, deps);
  }
}

module.exports = { detectarIntencion, responder, tablaMarkdown, svgHorario, plano };
