'use strict';

/* ============================== utilidades ============================== */
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];
const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const NOMBRE_DIA_JS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

const esc = (t) => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inicial = (n) => (String(n || '?').trim()[0] || '?').toUpperCase();

async function api(ruta, { method = 'GET', body } = {}) {
  const r = await fetch(ruta, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  let data = {};
  try { data = await r.json(); } catch { /* sin cuerpo */ }
  if (!r.ok) throw Object.assign(new Error(data.error || data.message || `Error ${r.status}`), { status: r.status, data });
  return data;
}

let toastTimer;
function toast(msg, esError = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('error', esError);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}

// Cada materia tiene siempre el mismo color (a partir de su nombre).
function matiz(materia) {
  let h = 5381;
  const s = String(materia).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return Math.round(((h % 16) * 22.5 + 8) % 360);
}

/* ================================ estado ================================ */
const estado = {
  user: null,
  horarios: [],
  publicado: false,
  publicadoEn: null,
  cursos: [],            // [{ curso, publicado, publicado_en, clases }]: un horario (borrador/publicado) por curso
  cursoActual: null,     // curso cuyo horario se está viendo / armando
  profesores: [],
  traslados: [],
  salones: [],
  filtroMateria: null,
  vistaMio: 'horas',
  entrega: { entregado: true },   // profesor: ¿ya entregó su horario semanal?
  entregas: { profesores: [], pendientes: 0 },   // admin: quién entregó
  choques: { choques: [], revisados: 0, sin_entregar: 0 },   // admin: lo entregado contra la grilla
  destinos: { cursos: [], turnos: [], profesores: [] },     // admin: opciones para dirigir un aviso
  editandoId: null
};
const esAdmin = () => estado.user?.rol === 'admin';
const esProfe = () => estado.user?.rol === 'profesor';

/* ============================== autenticación ============================== */
function mostrarPestana(login) {
  $('#tab-login').classList.toggle('is-active', login);
  $('#tab-registro').classList.toggle('is-active', !login);
  $('#form-login').classList.toggle('is-active', login);
  $('#form-registro').classList.toggle('is-active', !login);
}
$('#tab-login').onclick = () => mostrarPestana(true);
$('#tab-registro').onclick = () => mostrarPestana(false);
$('#reg-rol').onchange = (e) => { $('#reg-codigo-wrap').hidden = e.target.value === 'alumno'; };

$('#form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#login-error').textContent = '';
  try {
    const { user } = await api('/api/auth/login', { method: 'POST', body: { email: $('#login-email').value, password: $('#login-password').value } });
    await entrar(user);
  } catch (err) { $('#login-error').textContent = err.message; }
});

$('#form-registro').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#reg-error').textContent = '';
  try {
    const { user } = await api('/api/auth/register', { method: 'POST', body: {
      nombre: $('#reg-nombre').value, email: $('#reg-email').value, password: $('#reg-password').value,
      rol: $('#reg-rol').value, codigo: $('#reg-codigo').value
    } });
    await entrar(user);
  } catch (err) { $('#reg-error').textContent = err.message; }
});

$('#btn-salir').onclick = async () => {
  await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
  location.reload();
};

async function entrar(user) {
  estado.user = user;
  $('#auth-screen').hidden = true;
  $('#app-shell').hidden = false;

  $('#user-nombre').textContent = user.nombre;
  $('#user-rol').textContent = user.rol;
  $('#user-avatar').textContent = inicial(user.nombre);

  // Menú y controles según el rol
  $$('#sidebar-nav .nav-item').forEach(b => {
    const roles = b.dataset.roles;
    b.hidden = Boolean(roles) && !roles.split(',').includes(user.rol);
  });
  $$('.admin-only').forEach(el => { el.hidden = !esAdmin(); });
  $('#btn-foto-horario').hidden = !(esProfe() || esAdmin());
  $('#sel-foto-profe').hidden = !esAdmin();
  $('#descargas-horario').hidden = esProfe();   // admin y alumnos descargan la grilla general; el profesor, su propio horario
  if (esProfe()) $('#horarios-titulo').textContent = 'Horario de toda la institución';

  if (esAdmin()) {
    estado.profesores = (await api('/api/horarios/profesores').catch(() => ({ profesores: [] }))).profesores;
    const sel = $('#sel-foto-profe');
    sel.innerHTML = '<option value="">¿De qué profesor es la foto?</option>' + estado.profesores.filter(p => p.id).map(p => `<option value="${esc(p.nombre)}">${esc(p.nombre)}</option>`).join('');
  }
  await cargarHorarios();
  if (esAdmin()) actualizarBadgeCambios();
  await cargarEntrega();
  if (window.Clima) Clima.iniciar();   // clima de Artigas para todos los roles
  if (esProfe() && !estado.entrega.entregado) {
    chatBurbuja('bot', { html: mdHtml('¡Hola **' + user.nombre + '**! Antes de empezar necesito tu **horario semanal** (es obligatorio). Escribilo o pegalo acá, una clase por línea con el día, la hora, el curso y el lugar (liceo, UTU o coordinación). Por ejemplo:\n\n- `Lunes 07:30-09:00 3°MA liceo`\n- `Lunes 09:05-10:35 3°DF utu`\n- `Miércoles 10:40-11:25 Coordinación`\n\nApenas lo reciba se lo paso a la administración.') });
    irA('chat');
    return;
  }
  irA(esProfe() ? 'mi-horario' : 'horarios');
}

/* ====================== entrega obligatoria del horario ====================== */
async function cargarEntrega() {
  try {
    if (esProfe()) estado.entrega = await api('/api/horarios/entrega');
    else if (esAdmin()) estado.entregas = await api('/api/horarios/entrega');
  } catch { /* si falla, no se bloquea la app */ }
  renderBloqueoEntrega();
}

// Aviso fijo + menú bloqueado para el profesor que todavía no entregó.
function renderBloqueoEntrega() {
  const bloquear = esProfe() && !estado.entrega.entregado;
  $('#aviso-entrega').hidden = !bloquear;
  $$('#sidebar-nav .nav-item').forEach(b => {
    const libre = b.dataset.vista === 'chat';
    b.classList.toggle('is-bloqueado', bloquear && !libre);
    b.title = bloquear && !libre ? 'Primero entregá tu horario semanal' : '';
  });
}

/* ================================ navegación ================================ */
function irA(vista) {
  // Obligatorio: mientras el profesor no entregue su horario semanal, solo puede usar el Asistente.
  if (esProfe() && !estado.entrega.entregado && vista !== 'chat') {
    toast('Primero entregá tu horario semanal: es obligatorio.', true);
    vista = 'chat';
  }
  renderBloqueoEntrega();
  $$('#sidebar-nav .nav-item').forEach(b => b.classList.toggle('is-active', b.dataset.vista === vista));
  $$('.main-area .vista').forEach(v => v.classList.toggle('is-active', v.id === `vista-${vista}`));
  if (vista === 'avisos') cargarFeed('aviso');
  if (vista === 'noticias') cargarFeed('noticia');
  if (vista === 'lista-negra') cargarListaNegra();
  if (vista === 'backup' && esAdmin()) cargarBackups();
  if (vista === 'chat') chatAtajos();
  if (vista === 'asistencias') renderCalendario();
  if (vista === 'mi-horario') renderMiHorario();
  if (vista === 'profesores') { renderProfesores(); cargarEntrega().then(renderProfesores); }
  if (vista === 'cambios') cargarCambios();
  if (vista === 'salones') renderSalones();
  if (vista === 'historial') cargarHistorial();
  if (vista === 'clima' && window.Clima) Clima.abrir();
  if (vista === 'mapa3d' && window.Mapa3D) Mapa3D.abrir();
}
$$('#sidebar-nav .nav-item').forEach(b => b.addEventListener('click', () => irA(b.dataset.vista)));

/* ================================ horarios ================================ */
// Los horarios cargados desde la planilla de cada profesor (origen "carga-…") viven solo en
// "Por profesor" / "Mi horario". La grilla general "Horario" es solo para armar el de los alumnos.
const esHorarioDeProfesor = (h) => String(h.origen || '').startsWith('carga-');
const horariosGenerales = () => estado.horarios.filter(h => !esHorarioDeProfesor(h));

async function cargarHorarios() {
  const data = await api('/api/horarios');
  estado.horarios = data.horarios;
  estado.cursos = data.cursos || [];
  estado.publicado = data.publicado;
  estado.publicadoEn = data.publicado_en;
  if (!estado.cursos.some(c => c.curso === estado.cursoActual)) estado.cursoActual = estado.cursos[0]?.curso || null;
  renderEstadoPublicacion();
  renderHorarios();
  if (esProfe()) renderMiHorario();
  if (esAdmin()) {
    estado.traslados = (await api('/api/horarios/traslados').catch(() => ({ traslados: [] }))).traslados;
    estado.salones = (await api('/api/horarios/salones').catch(() => ({ salones: [] }))).salones;
    estado.choques = await api('/api/horarios/choques').catch(() => ({ choques: [], revisados: 0, sin_entregar: 0 }));
    const nCh = estado.choques.choques.length, badge = $('#badge-choques');
    badge.hidden = !nCh; badge.textContent = nCh;
    renderProfesores();
  }
}

// Datos del curso que se está viendo (cada curso tiene su propio estado de publicación).
const datosCurso = () => estado.cursos.find(c => c.curso === estado.cursoActual) || null;
const clasesDelCurso = () => horariosGenerales().filter(h => (h.curso || '').toLowerCase() === (estado.cursoActual || '').toLowerCase());

function renderCursosTabs() {
  const cont = $('#cursos-tabs');
  if (!estado.cursos.length) {
    cont.innerHTML = `<span class="cursos-vacio">${esAdmin() ? 'Todavía no hay cursos: creá el primero con “+ Nuevo curso”.' : ''}</span>`;
  } else {
    cont.innerHTML = estado.cursos.map(c => `<button type="button" role="tab" aria-selected="${c.curso === estado.cursoActual}"
        class="curso-tab${c.curso === estado.cursoActual ? ' is-on' : ''}" data-curso="${esc(c.curso)}">
        ${esAdmin() ? `<span class="punto${c.publicado ? ' pub' : ''}" title="${c.publicado ? 'Publicado' : 'En borrador'}"></span>` : ''}${esc(c.curso)} <small>${c.clases}</small></button>`).join('');
  }
  const d = datosCurso();
  $('#btn-quitar-curso').hidden = !(esAdmin() && d && d.clases === 0);
}
$('#cursos-tabs').addEventListener('click', (e) => {
  const t = e.target.closest('.curso-tab');
  if (!t) return;
  estado.cursoActual = t.dataset.curso;
  estado.filtroMateria = null;
  renderEstadoPublicacion();
  renderHorarios();
});

$('#btn-nuevo-curso').onclick = async () => {
  const nombre = (prompt('¿Para qué curso es el nuevo horario? (ej. 3°MF, 7°3, 3°CAD)') || '').trim();
  if (!nombre) return;
  try {
    const r = await api('/api/horarios/cursos', { method: 'POST', body: { curso: nombre } });
    estado.cursos = r.cursos;
    estado.cursoActual = (r.cursos.find(c => c.curso.toLowerCase() === nombre.toLowerCase()) || {}).curso || nombre;
    toast(`Horario de ${estado.cursoActual} creado (en borrador)`);
    renderEstadoPublicacion();
    renderHorarios();
  } catch (err) { toast(err.message, true); }
};

$('#btn-quitar-curso').onclick = async () => {
  const d = datosCurso();
  if (!d || d.clases) return;
  if (!confirm(`¿Quitar el curso ${d.curso}? No tiene clases cargadas.`)) return;
  try {
    await api(`/api/horarios/cursos/${encodeURIComponent(d.curso)}`, { method: 'DELETE' });
    toast(`Curso ${d.curso} quitado`);
    await cargarHorarios();
  } catch (err) { toast(err.message, true); }
};

function renderEstadoPublicacion() {
  renderCursosTabs();
  const d = datosCurso();
  const pub = Boolean(d && d.publicado);
  const pill = $('#estado-pill');
  pill.textContent = !d ? 'Sin curso' : (pub ? 'Publicado' : 'En borrador');
  pill.className = `pill ${pub ? 'pill-publicado' : 'pill-borrador'}`;
  let detalle = '';
  if (esAdmin()) {
    detalle = !d ? 'Creá el horario de un curso para empezar.'
      : pub ? `El horario de ${d.curso} ya lo ven profesores y alumnos${d.publicado_en ? ' · desde ' + new Date(d.publicado_en).toLocaleString('es') : ''}.`
        : `Borrador de ${d.curso}: solo vos lo ves. Cada curso se publica por separado.`;
  } else if (esProfe()) {
    detalle = d ? `Horario de ${d.curso}, publicado por la administración.` : 'La administración todavía no publicó ningún curso.';
  }
  $('#estado-detalle').textContent = detalle;
  const btn = $('#btn-publicar');
  btn.disabled = !d;
  btn.textContent = pub ? `🔒 Volver ${d.curso} a borrador` : `📢 Publicar ${d ? d.curso : 'curso'}`;
  btn.className = `btn ${pub ? 'btn-secondary' : 'btn-primary'}`;
  $('#btn-nueva-clase').disabled = !d;
  $('#btn-nuevo-curso').hidden = !esAdmin();
  // Alumnos: ocultar estado, no les sirve
  $('#estado-pill').hidden = estado.user.rol === 'alumno';
}

function tarjetaClase(h, { conAcciones = true } = {}) {
  const mia = esProfe() && h.profesor_id === estado.user.id;
  const profHtml = h.profesor_nombre
    ? `<div class="clase-prof"><span class="av">${esc(inicial(h.profesor_nombre))}</span>${esc(h.profesor_nombre)}</div>`
    : (esAdmin() ? `<div class="clase-prof sin"><span class="av">?</span>Sin profesor asignado</div>` : '');

  let acciones = '';
  if (conAcciones) {
    if (esAdmin()) {
      acciones = `<button class="mini" data-act="editar" data-id="${h.id}">Editar</button>
                  <button class="mini peligro" data-act="borrar" data-id="${h.id}">Eliminar</button>`;
    } else if (esProfe()) {
      if (h.estado === 'disponible') acciones = `<button class="mini" data-act="reclamar" data-id="${h.id}">Tomar clase</button>`;
      else if (mia) acciones = `<button class="mini" data-act="liberar" data-id="${h.id}">Liberar</button>`;
    }
  }
  return `<article class="clase${mia ? ' mia' : ''}" style="--h:${matiz(h.materia)}"
            data-materia="${esc(h.materia)}"
            data-busca="${esc((h.materia + ' ' + (h.curso || '') + ' ' + (h.profesor_nombre || '') + ' ' + (h.salon || '')).toLowerCase())}">
      <span class="clase-hora">${esc(h.hora_inicio)} – ${esc(h.hora_fin)}</span>
      ${h.curso ? `<div class="clase-curso">🎓 Curso ${esc(h.curso)}</div>` : ''}
      <div class="clase-materia">${esc(h.materia)}</div>
      ${h.salon ? `<div class="clase-salon">📍 ${esc(h.salon)}</div>` : ''}
      ${profHtml}
      ${acciones ? `<div class="clase-acc">${acciones}</div>` : ''}
    </article>`;
}

function grillaHtml(lista, opciones) {
  const hayS = lista.some(h => h.dia === 'Sábado');
  const dias = hayS ? DIAS : DIAS.slice(0, 5);
  const hoy = NOMBRE_DIA_JS[new Date().getDay()];
  const html = dias.map(d => {
    const clases = lista.filter(h => h.dia === d).sort((a, b) => a.hora_inicio.localeCompare(b.hora_inicio));
    return `<section class="dia-col${d === hoy ? ' es-hoy' : ''}" aria-label="${d}">
      <div class="dia-titulo">${d}${d === hoy ? '<small>HOY</small>' : ''}</div>
      ${clases.length ? clases.map(h => tarjetaClase(h, opciones)).join('') : '<div class="dia-vacio">Sin clases</div>'}
    </section>`;
  }).join('');
  return { html, cols: dias.length };
}

function renderHorarios() {
  const cont = $('#grilla-horarios');
  poblarCursosExport();
  const generales = clasesDelCurso();   // solo las clases del curso elegido: cada curso es un horario aparte
  const sinContenido = !estado.cursoActual || !generales.length;
  $('.toolbar').hidden = sinContenido;

  if (!esAdmin() && !estado.cursos.length) {
    cont.style.setProperty('--cols', 1);
    cont.innerHTML = `<div class="vacio"><div class="emoji">🛠️</div><h3>El horario todavía se está armando</h3>
      <p class="muted">Cuando la administración lo publique, lo vas a ver acá${esProfe() ? ', y tu horario personal en “Mi horario”' : ' con todos sus colores'}.</p></div>`;
    $('#leyenda').innerHTML = '';
    return;
  }
  if (!generales.length) {
    cont.style.setProperty('--cols', 1);
    cont.innerHTML = `<div class="vacio"><div class="emoji">🗓️</div><h3>No hay clases cargadas</h3>
      <p class="muted">${esAdmin() ? (estado.cursoActual ? `Cargá la primera clase de ${esc(estado.cursoActual)} con “+ Nueva clase”.` : 'Creá el horario de un curso con “+ Nuevo curso”.') : 'Todavía no hay clases.'}</p></div>`;
    $('#leyenda').innerHTML = '';
    return;
  }

  const { html, cols } = grillaHtml(generales, { conAcciones: true });
  cont.style.setProperty('--cols', cols);
  cont.innerHTML = html;

  const materias = [...new Set(generales.map(h => h.materia))].sort((a, b) => a.localeCompare(b, 'es'));
  $('#leyenda').innerHTML = materias.map(m =>
    `<button type="button" class="chip${estado.filtroMateria === m ? ' is-on' : ''}" style="--h:${matiz(m)}" data-materia="${esc(m)}">${esc(m)}</button>`).join('');
  aplicarFiltros();
}

function aplicarFiltros() {
  const q = $('#filtro-horarios').value.trim().toLowerCase();
  $$('#grilla-horarios .clase').forEach(c => {
    const okTxt = !q || c.dataset.busca.includes(q);
    const okMat = !estado.filtroMateria || c.dataset.materia === estado.filtroMateria;
    c.classList.toggle('oculta', !(okTxt && okMat));
  });
}
$('#filtro-horarios').addEventListener('input', aplicarFiltros);
$('#leyenda').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  estado.filtroMateria = estado.filtroMateria === chip.dataset.materia ? null : chip.dataset.materia;
  $$('#leyenda .chip').forEach(c => c.classList.toggle('is-on', c.dataset.materia === estado.filtroMateria));
  aplicarFiltros();
});

// Acciones sobre las tarjetas (admin y profesor), en ambas grillas
async function manejarAccion(e) {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const id = Number(btn.dataset.id);
  const h = estado.horarios.find(x => x.id === id);
  try {
    if (btn.dataset.act === 'editar') return abrirModal(h);
    if (btn.dataset.act === 'borrar') {
      if (!confirm(`¿Eliminar ${h.materia} del ${h.dia} (${h.hora_inicio})?`)) return;
      await api(`/api/horarios/${id}`, { method: 'DELETE' });
      toast('Clase eliminada');
    }
    if (btn.dataset.act === 'reclamar') { await api(`/api/horarios/${id}/reclamar`, { method: 'POST' }); toast('¡Clase tomada! La ves en “Mi horario”'); }
    if (btn.dataset.act === 'liberar') { await api(`/api/horarios/${id}/liberar`, { method: 'POST' }); toast('Clase liberada'); }
    await cargarHorarios();
  } catch (err) { toast(err.message, true); }
}
$('#grilla-horarios').addEventListener('click', manejarAccion);
$('#grilla-mio').addEventListener('click', manejarAccion);

/* ---------- publicar ---------- */
$('#btn-publicar').onclick = async () => {
  const d = datosCurso();
  if (!d) return;
  const quiere = !d.publicado;
  const clases = clasesDelCurso();
  const sinProf = clases.filter(h => !h.profesor_id && !h.profesor_nombre).length;
  const traslados = estado.traslados.length ? `\n\nOjo: ${estado.traslados.length} traslado(s) liceo↔UTU con poco margen (miralos en “Por profesor”).` : '';
  const aviso = (sinProf ? `\n\nOjo: ${sinProf} clase(s) todavía no tienen profesor.` : '') + traslados;
  if (!confirm(quiere ? `¿Publicar el horario de ${d.curso}? Los profesores de ese curso van a ver sus clases en “Mi horario” y los alumnos la grilla de ${d.curso}. Los demás cursos no se tocan.${aviso}` : `¿Volver ${d.curso} a borrador? Profesores y alumnos dejarán de ver ese curso (los otros siguen igual).`)) return;
  try {
    const r = await api('/api/horarios/publicar', { method: 'POST', body: { curso: d.curso, publicado: quiere } });
    toast(quiere ? `¡Horario de ${d.curso} publicado! Se avisó a ${r.profesores_avisados} profesor${r.profesores_avisados === 1 ? '' : 'es'}.` : `${d.curso} volvió a borrador`);
    await cargarHorarios();
  } catch (err) { toast(err.message, true); }
};

/* ---------- modal crear / editar ---------- */
const modal = $('#modal-clase');
$('#clase-dia').innerHTML = DIAS.map(d => `<option>${d}</option>`).join('');

// Valor del selector que corresponde a la clase: id de cuenta, "n:Nombre" (sin cuenta) o vacío.
const claveProfesor = (h) => !h ? '' : h.profesor_id ? String(h.profesor_id) : (h.profesor_nombre ? `n:${h.profesor_nombre}` : '');

function abrirModal(h = null) {
  estado.editandoId = h ? h.id : null;
  $('#modal-clase-titulo').textContent = h ? 'Editar clase' : 'Nueva clase';
  $('#clase-error').textContent = '';
  $('#clase-dia').value = h?.dia || 'Lunes';
  // El curso no se elige acá: la clase va al horario del curso que se está armando (uno por vez).
  $('#clase-curso').value = h?.curso || estado.cursoActual || '';
  $('#clase-materia').value = h?.materia || '';
  $('#clase-inicio').value = h?.hora_inicio || '08:00';
  $('#clase-fin').value = h?.hora_fin || '09:30';
  $('#clase-salon').value = h?.salon || '';
  $('#clase-lugar').value = h?.color || '';
  // Todos los profesores de la institución (con cuenta o no), agrupados por turno
  const opcion = (p) => `<option value="${p.id ? p.id : 'n:' + esc(p.nombre)}">${esc(p.nombre)}${p.cuenta ? '' : ' (sin cuenta aún)'}</option>`;
  const grupo = (titulo, lista) => lista.length ? `<optgroup label="${titulo}">${lista.map(opcion).join('')}</optgroup>` : '';
  $('#clase-profesor').innerHTML = `<option value="">Sin asignar</option>` +
    grupo('Turno 1', estado.profesores.filter(p => p.turno === 1)) +
    grupo('Turno 2', estado.profesores.filter(p => p.turno === 2)) +
    grupo('Otros', estado.profesores.filter(p => !p.turno));
  $('#clase-profesor').value = claveProfesor(h);
  modal.showModal();
}
$('#btn-nueva-clase').onclick = () => {
  if (!estado.cursoActual) return toast('Primero creá el horario de un curso con “+ Nuevo curso”.', true);
  abrirModal();
};
$('#clase-cancelar').onclick = () => modal.close();

$('#form-clase').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pid = $('#clase-profesor').value;
  const cuerpo = {
    curso: (estado.editandoId ? ($('#clase-curso').value) : estado.cursoActual || '').trim(), dia: $('#clase-dia').value, materia: $('#clase-materia').value,
    hora_inicio: $('#clase-inicio').value, hora_fin: $('#clase-fin').value,
    salon: $('#clase-salon').value, color: $('#clase-lugar').value
  };
  const editando = estado.editandoId ? estado.horarios.find(x => x.id === estado.editandoId) : null;
  // Solo se toca el profesor si cambió (así no se pierde un nombre importado sin cuenta)
  if (!editando || claveProfesor(editando) !== pid) {
    if (pid.startsWith('n:')) cuerpo.profesor_nombre = pid.slice(2);
    else cuerpo.profesor_id = pid ? Number(pid) : null;
  }
  try {
    const r = await api(editando ? `/api/horarios/${editando.id}` : '/api/horarios', { method: editando ? 'PUT' : 'POST', body: cuerpo });
    modal.close();
    // Los avisos de traslado no bloquean, pero se muestran para que el admin decida
    toast((editando ? 'Clase actualizada' : 'Clase creada') + (r.avisos?.length ? ` · ⚠️ ${r.avisos.join(' ')}` : ''), Boolean(r.avisos?.length));
    await cargarHorarios();
  } catch (err) { $('#clase-error').textContent = err.message; }
});

/* ================================ mi horario ================================ */
function renderMiHorario() {
  if (!esProfe()) return;
  const mias = estado.horarios.filter(h => h.profesor_id === estado.user.id);
  const horas = mias.reduce((acc, h) => {
    const [a, b] = h.hora_inicio.split(':').map(Number), [c, d] = h.hora_fin.split(':').map(Number);
    return acc + ((c * 60 + d) - (a * 60 + b)) / 60;
  }, 0);
  $('#mi-resumen').innerHTML = mias.length
    ? `<span class="resumen-chips"><span class="pill pill-ok">${mias.length} clases por semana</span><span class="pill pill-ok">${horas.toFixed(1).replace('.0', '')} h semanales</span></span>`
    : 'Todavía no tenés clases asignadas.';

  const hoy = NOMBRE_DIA_JS[new Date().getDay()];
  const deHoy = mias.filter(h => h.dia === hoy).sort((a, b) => a.hora_inicio.localeCompare(b.hora_inicio));
  $('#mi-hoy').innerHTML = `<div class="hoy-card"><h3>${hoy === 'Domingo' || hoy === 'Sábado' && !deHoy.length ? `Hoy es ${hoy.toLowerCase()}: ¡descansá!` : `Hoy · ${hoy}`}</h3>
    ${deHoy.length ? `<div class="hoy-lista">${deHoy.map(h => tarjetaClase(h, { conAcciones: false })).join('')}</div>`
      : (hoy === 'Domingo' || hoy === 'Sábado' ? '' : '<p>No tenés clases hoy.</p>')}</div>`;

  const cont = $('#grilla-mio');
  if (!mias.length) {
    $('#tabla-mio').hidden = true; cont.hidden = false;
    cont.style.setProperty('--cols', 1);
    cont.innerHTML = `<div class="vacio"><div class="emoji">🌤️</div><h3>Sin clases asignadas</h3>
      <p class="muted">Todavía no tenés clases cargadas. Mandale tu horario al Asistente (podés subir una foto) y aparece acá.</p></div>`;
    return;
  }
  const { html, cols } = grillaHtml(mias, { conAcciones: true });
  cont.style.setProperty('--cols', cols);
  cont.innerHTML = html;
  const porHoras = estado.vistaMio === 'horas';
  $('#tabla-mio').innerHTML = porHoras ? tablaHorasHtml(mias) : '';
  $('#tabla-mio').hidden = !porHoras;
  cont.hidden = porHoras;
  $$('#mi-vista-toggle [data-v]').forEach(b => b.classList.toggle('is-on', b.dataset.v === estado.vistaMio));
}

// Cursos que se ofrecen al elegir el curso de una clase (el admin igual puede escribir cualquier otro).
// 1) Bachilleratos Tecnológicos Profesionales (BTP) de la Escuela Técnica de Artigas "Maestro Carlos Martín de Vecchi",
//    según su oferta educativa publicada por la UTU, en 1°, 2° y 3° año. Para agregar o quitar uno, editá BTP_ARTIGAS.
// 2) Los grupos con sigla que ya usan los horarios cargados de la escuela (3°MA, 3°CAD…), en 1°, 2° y 3°. Editá ORIENTACIONES_UTU.
const BTP_ARTIGAS = ['BTP Gastronomía', 'BTP Carpintería', 'BTP Electricidad', 'BTP Electrotecnia', 'BTP Sist. Mecánicos Automatizados'];
const ORIENTACIONES_UTU = ['MA', 'MB', 'MC', 'MF', 'MT', 'CAD', 'CVH', 'CT', 'HCP', 'DF', 'BA'];
const BACHILLERATOS_UTU = [
  ...[1, 2, 3].flatMap(a => BTP_ARTIGAS.map(o => `${a}° ${o}`)),
  ...[1, 2, 3].flatMap(a => ORIENTACIONES_UTU.map(o => `${a}°${o}`))
];

/* ---------- admin: horario de cada profesor ---------- */
let profSeleccion = '';
function renderProfesores() {
  if (!esAdmin()) return;
  const sel = $('#prof-select');
  const conteo = (p) => estado.horarios.filter(h => claveProfesor(h) === (p.id ? String(p.id) : `n:${p.nombre}`)).length;
  const entregaDe = (p) => p.id ? estado.entregas.profesores.find(x => x.id === p.id) : null;
  const marca = (p) => { const e = entregaDe(p); return e ? (e.entregado ? '✅ ' : '⏳ ') : ''; };
  const opcion = (p) => `<option value="${p.id ? p.id : 'n:' + esc(p.nombre)}">${marca(p)}${esc(p.nombre)} (${conteo(p)} clases)${p.cuenta ? '' : ' · sin cuenta aún'}</option>`;
  const grupo = (titulo, lista) => lista.length ? `<optgroup label="${titulo}">${lista.map(opcion).join('')}</optgroup>` : '';
  sel.innerHTML = grupo('Turno 1', estado.profesores.filter(p => p.turno === 1)) + grupo('Turno 2', estado.profesores.filter(p => p.turno === 2)) +
    grupo('Otros', estado.profesores.filter(p => !p.turno));
  if (!profSeleccion || ![...sel.options].some(o => o.value === profSeleccion)) profSeleccion = sel.options[0]?.value || '';
  sel.value = profSeleccion;
  const pSel = estado.profesores.find(x => (x.id ? String(x.id) : `n:${x.nombre}`) === profSeleccion);
  $('#btn-reset-clave').hidden = !(pSel && pSel.id);   // solo si ya tiene cuenta

  // Entrega obligatoria: resumen de pendientes y estado del profesor elegido.
  const pend = estado.entregas.profesores.filter(x => !x.entregado);
  const eSel = pSel && pSel.id ? estado.entregas.profesores.find(x => x.id === pSel.id) : null;
  $('#prof-entrega').innerHTML = estado.entregas.profesores.length
    ? `<div class="aviso-entrega ${pend.length ? 'pendiente' : 'ok'}">${pend.length
        ? `⏳ <b>${pend.length}</b> profesor${pend.length === 1 ? '' : 'es'} sin entregar el horario semanal (obligatorio): ${pend.map(x => esc(x.nombre)).join(', ')}. <button type="button" class="mini" id="btn-recordar-entrega">🔔 Recordarles</button>`
        : '✅ Todos los profesores con cuenta entregaron su horario semanal.'}
       ${eSel ? `<div class="entrega-sel">${eSel.entregado ? `✅ <b>${esc(eSel.nombre)}</b> entregó su horario${eSel.enviado_en ? ' el ' + esc(new Date(eSel.enviado_en.replace(' ', 'T') + 'Z').toLocaleString('es')) : ''}.` : `⏳ <b>${esc(eSel.nombre)}</b> todavía no entregó su horario.`}</div>` : ''}</div>`
    : '';
  // Foto del horario que mandó el profesor (o el admin por él): se ve acá aunque todavía no esté pasada a clases.
  $('#prof-foto').innerHTML = eSel && eSel.con_foto
    ? `<div class="foto-entrega"><a href="/api/horarios/entrega/foto/${eSel.id}" target="_blank" rel="noopener"><img alt="Foto del horario de ${esc(eSel.nombre)}" src="/api/horarios/entrega/foto/${eSel.id}?t=${encodeURIComponent(eSel.enviado_en || '')}"></a>
         <div><b>📷 Foto del horario de ${esc(eSel.nombre)}</b><p class="muted">${eSel.cantidad ? `Ya está pasada a clases (${eSel.cantidad}).` : 'Todavía no está pasada a clases: mirála y cargala con el asistente.'}</p>
         <button type="button" class="mini" id="btn-transcribir-foto" data-nombre="${esc(eSel.nombre)}">✍️ Cargar sus clases en el asistente</button></div></div>`
    : '';
  const tabla = $('#prof-tabla'), grilla = $('#prof-grilla');
  renderChoques();
  const avisos = estado.traslados.filter(t => t.clave === profSeleccion);
  const choquesSel = estado.choques.choques.filter(c => c.clave === profSeleccion);
  $('#prof-avisos').innerHTML = choquesSel.map(c => `<div class="aviso-choque" data-tipo="${esc(c.tipo)}">${ICONO_CHOQUE[c.tipo] || '⚠️'} ${esc(c.texto)}</div>`).join('')
    + avisos.map(t => `<div class="aviso-traslado">⚠️ ${esc(t.texto)}</div>`).join('');
  const mias = estado.horarios.filter(h => claveProfesor(h) === profSeleccion);
  const p = estado.profesores.find(x => (x.id ? String(x.id) : `n:${x.nombre}`) === profSeleccion);
  const horas = mias.reduce((acc, h) => acc + (aMin(h.hora_fin) - aMin(h.hora_inicio)) / 60, 0);
  $('#prof-resumen').innerHTML = !p ? 'No hay profesores.' : mias.length
    ? `<span class="resumen-chips"><b>${esc(p.nombre)}</b> <span class="pill pill-ok">${mias.length} clases por semana</span><span class="pill pill-ok">${horas.toFixed(1).replace('.0', '')} h semanales</span></span>`
    : `<b>${esc(p.nombre)}</b> todavía no tiene clases asignadas.`;
  if (!mias.length) {
    tabla.hidden = true; grilla.hidden = false; grilla.style.setProperty('--cols', 1);
    grilla.innerHTML = `<div class="vacio"><div class="emoji">🌤️</div><h3>Sin clases asignadas</h3><p class="muted">Asignale clases desde “Horario → Nueva clase” o “Editar”.</p></div>`;
    return;
  }
  const { html, cols } = grillaHtml(mias, { conAcciones: true });
  grilla.style.setProperty('--cols', cols);
  grilla.innerHTML = html;
  const porHoras = estado.vistaProf !== 'dias';
  tabla.innerHTML = porHoras ? tablaHorasHtml(mias) : '';
  tabla.hidden = !porHoras;
  grilla.hidden = porHoras;
  $$('#prof-vista-toggle [data-v]').forEach(b => b.classList.toggle('is-on', b.dataset.v === (porHoras ? 'horas' : 'dias')));
}
// Resumen de diferencias entre lo que entregaron los profesores y la grilla (solo admin).
const ICONO_CHOQUE = { doble_lugar: '🔀', hora_distinta: '🕒', falta: '❓' };
function renderChoques() {
  const { choques, revisados, sin_entregar: sinEntregar } = estado.choques;
  const porProfe = new Map();
  for (const c of choques) {
    if (!porProfe.has(c.clave)) porProfe.set(c.clave, { clave: c.clave, nombre: c.profesor, n: 0 });
    porProfe.get(c.clave).n++;
  }
  const nota = sinEntregar ? `<div class="choque-nota">${sinEntregar} profesor${sinEntregar === 1 ? '' : 'es'} con clases en la grilla todavía no entregaron nada, así que no se pueden comparar.</div>` : '';
  if (!choques.length) {
    $('#prof-choques').innerHTML = revisados || sinEntregar
      ? `<div class="aviso-entrega ${revisados ? 'ok' : 'pendiente'}">${revisados ? `✅ Lo que entregaron ${revisados} profesor${revisados === 1 ? '' : 'es'} coincide con la grilla.` : '🔎 Todavía no hay entregas para comparar con la grilla.'}${nota}</div>`
      : '';
    return;
  }
  const chips = [...porProfe.values()].map(p => `<button type="button" class="chip-choque${p.clave === profSeleccion ? ' is-on' : ''}" data-clave="${esc(p.clave)}">${esc(p.nombre)} · ${p.n}</button>`).join('');
  $('#prof-choques').innerHTML = `<div class="aviso-choque aviso-choque-resumen"><b>⚠️ ${choques.length} diferencia${choques.length === 1 ? '' : 's'} entre lo que entregaron los profesores y la grilla</b>
    <div class="chips-choque">${chips}</div>${nota}</div>`;
}
$('#prof-choques').addEventListener('click', (e) => {
  const b = e.target.closest('[data-clave]');
  if (!b) return;
  profSeleccion = b.dataset.clave;
  renderProfesores();
});
$('#prof-foto').addEventListener('click', (e) => {
  const b = e.target.closest('#btn-transcribir-foto');
  if (!b) return;
  irA('chat');
  const input = $('#chat-input');
  input.value = `Cargar horario de ${b.dataset.nombre}:\nLunes 07:30-09:00 3°MA liceo\n`;
  input.dispatchEvent(new Event('input'));
  input.focus();
});
$('#prof-entrega').addEventListener('click', async (e) => {
  if (!e.target.closest('#btn-recordar-entrega')) return;
  try { const r = await api('/api/horarios/entrega/recordar', { method: 'POST' }); toast(`Recordatorio enviado a ${r.avisados} profesor${r.avisados === 1 ? '' : 'es'}`); }
  catch (err) { toast(err.message, true); }
});
$('#prof-select').addEventListener('change', (e) => { profSeleccion = e.target.value; renderProfesores(); });
$('#prof-vista-toggle').addEventListener('click', (e) => {
  const b = e.target.closest('[data-v]');
  if (!b) return;
  estado.vistaProf = b.dataset.v;
  renderProfesores();
});
$('#prof-grilla').addEventListener('click', manejarAccion);

/* ---------- admin: horario por salón ---------- */
const normSalon = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9ñ ]/g, ' ').replace(/\s+/g, ' ').trim();
let salonSeleccion = '';
function renderSalones() {
  if (!esAdmin()) return;
  const sel = $('#salon-select');
  if (!$('#libres-dia').options.length) {
    $('#libres-dia').innerHTML = DIAS.map(d => `<option>${d}</option>`).join('');
    const hoy = NOMBRE_DIA_JS[new Date().getDay()];
    $('#libres-dia').value = DIAS.includes(hoy) ? hoy : 'Lunes';
    $('#libres-hora').value = '08:00';
  }
  const conteo = (n) => estado.horarios.filter(h => h.salon && normSalon(h.salon) === normSalon(n)).length;
  sel.innerHTML = estado.salones.map(n => `<option value="${esc(n)}">${esc(n)} (${conteo(n)} clases)</option>`).join('');
  const tabla = $('#salon-tabla');
  if (!estado.salones.length) {
    $('#salon-resumen').textContent = 'Todavía no hay salones cargados.';
    tabla.hidden = false;
    tabla.innerHTML = `<div class="vacio"><div class="emoji">🏫</div><h3>No hay salones cargados</h3><p class="muted">Agregá el salón al crear o editar las clases y acá vas a ver cuándo está libre.</p></div>`;
    return;
  }
  if (!salonSeleccion || ![...sel.options].some(o => o.value === salonSeleccion)) salonSeleccion = sel.options[0].value;
  sel.value = salonSeleccion;
  const clases = estado.horarios.filter(h => h.salon && normSalon(h.salon) === normSalon(salonSeleccion));
  const horas = clases.reduce((a, h) => a + (aMin(h.hora_fin) - aMin(h.hora_inicio)) / 60, 0);
  $('#salon-resumen').innerHTML = `<span class="resumen-chips"><b>${esc(salonSeleccion)}</b> <span class="pill pill-ok">${clases.length} clases por semana</span><span class="pill pill-ok">${horas.toFixed(1).replace('.0', '')} h ocupado</span></span> · las celdas vacías son horas libres.`;
  tabla.hidden = false;
  tabla.innerHTML = tablaHorasHtml(clases, { mostrarProfesor: true });
}
$('#salon-select').addEventListener('change', (e) => { salonSeleccion = e.target.value; renderSalones(); });
$('#btn-libres').onclick = async () => {
  const cont = $('#libres-resultado');
  try {
    const r = await api(`/api/horarios/salones?dia=${encodeURIComponent($('#libres-dia').value)}&hora=${encodeURIComponent($('#libres-hora').value)}`);
    const libres = r.salones.filter(x => x.libre), ocupados = r.salones.filter(x => !x.libre);
    cont.innerHTML = `<p><b>${esc(r.dia)} a las ${esc(r.hora)}</b></p>
      <div class="chips-salon">${libres.map(x => `<span class="chip-salon libre">🟢 ${esc(x.salon)}</span>`).join('') || '<span class="muted">Ningún salón libre.</span>'}</div>
      <div class="chips-salon">${ocupados.map(x => `<span class="chip-salon ocupado" title="${esc(x.clase.hora_inicio)}–${esc(x.clase.hora_fin)}">🔴 ${esc(x.salon)} · ${esc(x.clase.materia)}${x.clase.profesor_nombre ? ' (' + esc(x.clase.profesor_nombre) + ')' : ''}</span>`).join('')}</div>`;
  } catch (err) { cont.innerHTML = `<p class="err">${esc(err.message)}</p>`; }
};

/* ============================ historial (admin) ============================ */
const ETIQUETA_ACCION = {};
async function cargarHistorial() {
  const cont = $('#contenedor-historial');
  try {
    const q = encodeURIComponent($('#hist-q').value.trim()), accion = encodeURIComponent($('#hist-accion').value);
    const r = await api(`/api/historial?q=${q}&accion=${accion}`);
    const sel = $('#hist-accion');
    if (sel.options.length === 1) {
      Object.assign(ETIQUETA_ACCION, r.acciones);
      for (const [k, v] of Object.entries(r.acciones)) sel.add(new Option(v, k));
    }
    cont.innerHTML = r.historial.length
      ? `<table class="preview-tabla"><thead><tr><th>Cuándo</th><th>Quién</th><th>Acción</th><th>Detalle</th></tr></thead><tbody>
         ${r.historial.map(h => `<tr><td>${esc(new Date(h.fecha.replace(' ', 'T') + 'Z').toLocaleString('es'))}</td><td>${esc(h.usuario_nombre)}</td>
           <td><span class="pill pill-ok">${esc(ETIQUETA_ACCION[h.accion] || h.accion)}</span></td><td>${esc(h.detalle)}</td></tr>`).join('')}</tbody></table>`
      : '<p class="muted">No hay registros con ese filtro.</p>';
  } catch (err) { cont.textContent = err.message; }
}
let histTimer;
$('#hist-q').addEventListener('input', () => { clearTimeout(histTimer); histTimer = setTimeout(cargarHistorial, 250); });
$('#hist-accion').addEventListener('change', cargarHistorial);
$('#btn-borrar-historial').onclick = async () => {
  if (!confirm('¿Borrar TODO el historial de cambios? No se puede deshacer (los backups guardados no se tocan).')) return;
  try {
    const r = await api('/api/historial', { method: 'DELETE' });
    toast(`Historial borrado (${r.borrados} registro${r.borrados === 1 ? '' : 's'})`);
    cargarHistorial();
  } catch (err) { toast(err.message, true); }
};

/* ---------- imprimir / guardar como PDF ---------- */
// Arma una hoja por profesor en #zona-impresion y abre el diálogo de impresión (ahí se elige "Guardar como PDF").
function imprimirHorarios(lista) {
  const conClases = lista.filter(x => x.clases.length);
  if (!conClases.length) return toast('No hay clases para imprimir.', true);
  const fecha = new Date().toLocaleDateString('es');
  $('#zona-impresion').innerHTML = conClases.map(({ nombre, clases, conProfesor }) => {
    const horas = clases.reduce((a, h) => a + (aMin(h.hora_fin) - aMin(h.hora_inicio)) / 60, 0);
    return `<section class="hoja">
      <h1>${esc(nombre)}</h1>
      <p class="hoja-sub">Cuadrilla · Horario semanal · ${clases.length} clases · ${horas.toFixed(1).replace('.0', '')} h semanales · ${fecha}</p>
      ${tablaHorasHtml(clases, { mostrarProfesor: Boolean(conProfesor) })}
      <p class="hoja-leyenda"><span style="background:${COLORES_CLASE.amarillo}"></span>Liceo <span style="background:${COLORES_CLASE.azul}"></span>UTU <span style="background:${COLORES_CLASE.verde}"></span>Coordinación</p>
    </section>`;
  }).join('');
  document.body.classList.add('imprimiendo');
  const limpiar = () => { document.body.classList.remove('imprimiendo'); $('#zona-impresion').innerHTML = ''; window.removeEventListener('afterprint', limpiar); };
  window.addEventListener('afterprint', limpiar);
  setTimeout(() => window.print(), 50);
}
$('#btn-imprimir-mio').onclick = () => imprimirHorarios([{ nombre: estado.user.nombre, clases: estado.horarios.filter(h => h.profesor_id === estado.user.id) }]);
$('#btn-imprimir-prof').onclick = () => {
  const p = estado.profesores.find(x => (x.id ? String(x.id) : `n:${x.nombre}`) === profSeleccion);
  if (p) imprimirHorarios([{ nombre: p.nombre, clases: estado.horarios.filter(h => claveProfesor(h) === profSeleccion) }]);
};
$('#btn-imprimir-todos').onclick = () => imprimirHorarios(estado.profesores.map(p => ({
  nombre: p.nombre, clases: estado.horarios.filter(h => claveProfesor(h) === (p.id ? String(p.id) : `n:${p.nombre}`)) })));

/* ---------- descargar en Excel / PDF ---------- */
async function descargar(url, nombreDefecto) {
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Error ${r.status}`);
    const blob = await r.blob();
    const m = /filename="([^"]+)"/.exec(r.headers.get('content-disposition') || '');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = m ? m[1] : nombreDefecto;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('Descarga lista ✅');
  } catch (err) { toast(err.message, true); }
}
$('#btn-excel-mio').onclick = () => descargar('/api/exportar/excel?alcance=mio', 'mi-horario.xlsx');
$('#btn-excel-prof').onclick = () => {
  const p = estado.profesores.find(x => (x.id ? String(x.id) : `n:${x.nombre}`) === profSeleccion);
  if (p) descargar(`/api/exportar/excel?alcance=profesor&${p.id ? 'id=' + p.id : 'nombre=' + encodeURIComponent(p.nombre)}`, 'horario-profesor.xlsx');
};
// Selector de curso para descargar (Todos / uno): lo usan el admin y los alumnos.
// (los alumnos reciben de la API solo el horario general, sin los horarios personales de los profesores)
function poblarCursosExport() {
  const sel = $('#exp-curso');
  const previo = sel.value;
  const cursos = [...new Set(estado.horarios.map(h => h.curso).filter(Boolean))].sort((x, y) => x.localeCompare(y, 'es', { numeric: true }));
  sel.innerHTML = '<option value="">Todos los cursos</option>' + cursos.map(c => `<option value="${esc(c)}">Curso ${esc(c)}</option>`).join('');
  if (cursos.includes(previo)) sel.value = previo;
}
$('#btn-excel-horario').onclick = () => {
  const c = $('#exp-curso').value;
  descargar(c ? `/api/exportar/excel?alcance=curso&curso=${encodeURIComponent(c)}` : '/api/exportar/excel?alcance=todo', 'horario.xlsx');
};
$('#btn-pdf-horario').onclick = () => {
  const c = $('#exp-curso').value;
  const porCurso = (curso) => estado.horarios.filter(h => (h.curso || '') === curso);
  if (c) return imprimirHorarios([{ nombre: `Curso ${c}`, clases: porCurso(c), conProfesor: true }]);
  const cursos = [...new Set(estado.horarios.map(h => h.curso).filter(Boolean))].sort((x, y) => x.localeCompare(y, 'es', { numeric: true }));
  const hojas = cursos.map(k => ({ nombre: `Curso ${k}`, clases: porCurso(k), conProfesor: true }));
  const sin = estado.horarios.filter(h => !h.curso);
  if (sin.length) hojas.push({ nombre: 'Clases sin curso asignado', clases: sin, conProfesor: true });
  imprimirHorarios(hojas);
};

/* ---------- contraseña ---------- */
const modalClave = $('#modal-clave');
$('#btn-clave').onclick = () => { $('#form-clave').reset(); $('#clave-error').textContent = ''; modalClave.showModal(); };
$('#clave-cancelar').onclick = () => modalClave.close();
$('#form-clave').addEventListener('submit', async (e) => {
  e.preventDefault();
  const nueva = $('#clave-nueva').value;
  if (nueva !== $('#clave-repetir').value) { $('#clave-error').textContent = 'Las contraseñas nuevas no coinciden.'; return; }
  try {
    await api('/api/auth/password', { method: 'POST', body: { actual: $('#clave-actual').value, nueva } });
    modalClave.close();
    toast('Contraseña actualizada ✅');
  } catch (err) { $('#clave-error').textContent = err.message; }
});
$('#btn-reset-clave').onclick = async () => {
  const p = estado.profesores.find(x => (x.id ? String(x.id) : `n:${x.nombre}`) === profSeleccion);
  if (!p || !p.id) return;
  if (!confirm(`¿Restablecer la contraseña de ${p.nombre} a la inicial?`)) return;
  try {
    const r = await api('/api/auth/restablecer', { method: 'POST', body: { usuario_id: p.id } });
    alert(`Listo. La contraseña de ${r.nombre} ahora es: ${r.password}\n\nPedile que la cambie al entrar.`);
  } catch (err) { toast(err.message, true); }
};

/* ---------- vista por horas: filas = franjas de la institución, bloques de color ---------- */
const FRANJAS = [['07:30', '08:15'], ['08:15', '09:00'], ['09:05', '09:50'], ['09:50', '10:35'], ['10:40', '11:25'], ['11:25', '12:10'],
  ['12:10', '12:55'], ['13:05', '13:50'], ['13:50', '14:35'], ['14:40', '15:25'], ['15:25', '16:10'], ['16:15', '17:00'],
  ['17:00', '17:45'], ['17:45', '18:30'], ['18:30', '20:20']];
const COLORES_CLASE = { amarillo: '#f7dc00', azul: '#1ea7fd', verde: '#3dd21d' };
const colorClase = (h) => COLORES_CLASE[h.color] || `hsl(${matiz(h.materia)} 75% 80%)`;
const aMin = (t) => { const [a, b] = t.split(':').map(Number); return a * 60 + b; };
const sinCero = (t) => t.replace(/^0/, '');

function tablaHorasHtml(lista, { mostrarProfesor = false } = {}) {
  const n = FRANJAS.length;
  const dias = DIAS.slice(0, lista.some(h => h.dia === 'Sábado') ? 6 : 5);
  const hoy = NOMBRE_DIA_JS[new Date().getDay()];
  let fuera = 0;
  const celdas = {};   // dia -> { [franja de inicio]: { h, i1, i2 } }
  const tapado = {};   // dia -> franjas cubiertas por un bloque que empezó antes
  for (const d of dias) {
    celdas[d] = {}; tapado[d] = Array(n).fill(false);
    const ocupadas = Array(n).fill(false);
    for (const h of lista.filter(x => x.dia === d).sort((a, b) => a.hora_inicio.localeCompare(b.hora_inicio))) {
      const idx = FRANJAS.map((_, i) => i).filter(i => aMin(FRANJAS[i][1]) > aMin(h.hora_inicio) && aMin(FRANJAS[i][0]) < aMin(h.hora_fin));
      let i1 = idx[0], i2 = idx[idx.length - 1];
      while (i1 !== undefined && i1 <= i2 && ocupadas[i1]) i1++;          // si dos clases comparten franja, la segunda empieza después
      if (i1 === undefined || i1 > i2) { fuera++; continue; }
      for (let i = i1; i <= i2; i++) { if (ocupadas[i]) { i2 = i - 1; break; } }
      for (let i = i1; i <= i2; i++) { ocupadas[i] = true; if (i > i1) tapado[d][i] = true; }
      celdas[d][i1] = { h, i1, i2 };
    }
  }
  const filas = FRANJAS.map(([ini, fin], i) => {
    const tinte = `hsl(97 55% ${38 + 40 * i / (n - 1)}%)`;
    const tds = dias.map(d => {
      if (tapado[d][i]) return '';
      const c = celdas[d][i];
      if (!c) return '<td class="hv"></td>';
      const { h, i1, i2 } = c;
      const exacto = h.hora_inicio === FRANJAS[i1][0] && h.hora_fin === FRANJAS[i2][1];
      return `<td class="hb" rowspan="${i2 - i1 + 1}" style="background:${colorClase(h)}" title="${esc(h.materia)} · ${esc(h.hora_inicio)}–${esc(h.hora_fin)}">
        <b>${esc(h.materia)}</b>${h.curso && h.curso !== h.materia ? `<small>🎓 ${esc(h.curso)}</small>` : ''}${exacto ? '' : `<small>${esc(sinCero(h.hora_inicio))} a ${esc(sinCero(h.hora_fin))}</small>`}${mostrarProfesor ? (h.profesor_nombre ? `<small>👤 ${esc(h.profesor_nombre)}</small>` : '') : (h.salon ? `<small>📍 ${esc(h.salon)}</small>` : '')}</td>`;
    }).join('');
    return `<tr${i === n - 1 ? ' class="ultima"' : ''}><th class="franja" style="background:${tinte}">${sinCero(ini)} a ${sinCero(fin)}</th>${tds}</tr>`;
  }).join('');
  return `<table class="tabla-horas"><thead><tr><th>Horarios</th>${dias.map(d => `<th${d === hoy ? ' class="es-hoy"' : ''}>${d}</th>`).join('')}</tr></thead><tbody>${filas}</tbody></table>` +
    (fuera ? `<p class="muted">${fuera} clase(s) caen fuera de las franjas: miralas en “Por días”.</p>` : '');
}
$('#mi-vista-toggle').addEventListener('click', (e) => {
  const b = e.target.closest('[data-v]');
  if (!b) return;
  estado.vistaMio = b.dataset.v;
  renderMiHorario();
});

/* ============================ cambios (admin) ============================ */
async function actualizarBadgeCambios() {
  try {
    const { cambios } = await api('/api/cambios');
    const b = $('#badge-cambios');
    b.textContent = cambios.length; b.hidden = !cambios.length;
    return cambios;
  } catch { return []; }
}
async function cargarCambios() {
  const cont = $('#contenedor-cambios');
  const cambios = await actualizarBadgeCambios();
  cont.innerHTML = cambios.length ? cambios.map(c => `
    <article class="feed-item" style="--h:${matiz(c.a.profesor)}">
      <h4>${esc(c.a.profesor)} ↔ ${esc(c.b.profesor)}</h4>
      <p><b>${esc(c.a.profesor)}</b> deja ${esc(c.a.clase)}<br><b>${esc(c.b.profesor)}</b> deja ${esc(c.b.clase)}</p>
      <div class="clase-acc"><button class="mini" data-cambio="aprobar" data-id="${c.id}">✅ Aprobar</button>
        <button class="mini peligro" data-cambio="rechazar" data-id="${c.id}">Rechazar</button></div>
    </article>`).join('') : `<div class="vacio"><div class="emoji">🤝</div><h3>No hay intercambios pendientes</h3></div>`;
}
$('#contenedor-cambios').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-cambio]');
  if (!b) return;
  const aprobar = b.dataset.cambio === 'aprobar';
  if (!confirm(aprobar ? '¿Aprobar el intercambio? Los horarios se actualizan ahora.' : '¿Rechazar el intercambio?')) return;
  try {
    const r = await api(`/api/cambios/${b.dataset.id}/${b.dataset.cambio}`, { method: 'POST' });
    toast(r.mensaje);
    await cargarHorarios();
    await cargarCambios();
  } catch (err) { toast(err.message, true); }
});

/* ============================= avisos y noticias ============================= */
// Avisos dirigidos: opciones (cursos, turnos, profesores) como casillas debajo de "Dirigido a".
async function cargarDestinos() {
  try { estado.destinos = await api('/api/avisos/destinos'); } catch { /* el formulario sigue sirviendo para "Todos" */ }
  renderDestinoOpciones();
}
function renderDestinoOpciones() {
  const sel = $('#aviso-destino-tipo'), cont = $('#aviso-destino-opciones');
  if (!sel || !cont) return;
  const tipo = sel.value, d = estado.destinos;
  const casilla = (valor, texto) => `<label class="chk"><input type="checkbox" name="destino" value="${esc(valor)}"><span>${esc(texto)}</span></label>`;
  let html = '';
  if (tipo === 'cursos') html = d.cursos.length ? d.cursos.map(c => casilla(c, c)).join('') : '<p class="muted">Todavía no hay cursos cargados en el horario.</p>';
  else if (tipo === 'turno') html = d.turnos.map(t => casilla(t.valor, `${t.nombre} (${t.profesores} profesores)`)).join('');
  else if (tipo === 'profesores') {
    const grupo = (titulo, lista) => lista.length ? `<div class="destino-grupo"><b>${titulo}</b>${lista.map(p => casilla(p.nombre, p.nombre + (p.cuenta ? '' : ' · sin cuenta aún'))).join('')}</div>` : '';
    html = grupo('Turno 1', d.profesores.filter(p => p.turno === 1)) + grupo('Turno 2', d.profesores.filter(p => p.turno === 2)) + grupo('Otros', d.profesores.filter(p => !p.turno));
  }
  cont.innerHTML = html;
  cont.hidden = tipo === 'todos';
}
$('#aviso-destino-tipo')?.addEventListener('change', renderDestinoOpciones);

async function cargarFeed(tipo) {
  if (tipo === 'aviso' && esAdmin()) cargarDestinos();
  const cont = $(tipo === 'aviso' ? '#lista-avisos' : '#lista-noticias');
  try {
    const { avisos } = await api(`/api/avisos?tipo=${tipo}`);
    cont.innerHTML = avisos.length ? avisos.map(a => `
      <article class="feed-item" style="--h:${matiz(a.titulo)}">
        <h4>${esc(a.titulo)}</h4>
        ${a.para ? `<span class="pill pill-destino">🎯 ${esc(a.para)}</span> ` : ''}<small>${esc(a.autor_nombre)} · ${esc(new Date(a.creado_en.replace(' ', 'T') + 'Z').toLocaleDateString('es'))}</small>
        <p>${esc(a.contenido)}</p>
        ${esAdmin() ? `<div class="clase-acc"><button class="mini peligro" data-del="${a.id}" data-tipo="${tipo}">Eliminar</button></div>` : ''}
      </article>`).join('') : `<div class="vacio"><div class="emoji">${tipo === 'aviso' ? '📭' : '🗞️'}</div><h3>Nada por acá todavía</h3></div>`;
  } catch (err) { cont.innerHTML = `<p class="err">${esc(err.message)}</p>`; }
}
$$('.form-publicar').forEach(form => form.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const body = { tipo: form.dataset.tipo, titulo: form.titulo.value, contenido: form.contenido.value };
    if (form.destino_tipo) {   // solo los avisos se pueden dirigir
      body.destino_tipo = form.destino_tipo.value;
      body.destino = $$('input[name="destino"]:checked', form).map(i => i.value);
      if (body.destino_tipo !== 'todos' && !body.destino.length) return toast('Elegí a quién va dirigido el aviso.', true);
    }
    const r = await api('/api/avisos', { method: 'POST', body });
    form.reset();
    renderDestinoOpciones();
    if (r.destinatarios === undefined) toast('Publicado');
    else if (r.destinatarios === 0) toast('Publicado, pero todavía ningún profesor con cuenta lo ve (no hay cuenta o nadie coincide).', true);
    else toast(`Publicado para ${r.destinatarios} profesor${r.destinatarios === 1 ? '' : 'es'}`);
    cargarFeed(form.dataset.tipo);
  } catch (err) { toast(err.message, true); }
}));
['#lista-avisos', '#lista-noticias'].forEach(sel => $(sel).addEventListener('click', async (e) => {
  const b = e.target.closest('[data-del]');
  if (!b || !confirm('¿Eliminar esta publicación?')) return;
  await api(`/api/avisos/${b.dataset.del}`, { method: 'DELETE' }).catch(err => toast(err.message, true));
  cargarFeed(b.dataset.tipo);
}));

/* ================================ asistencias ================================ */
// Calendario del mes. Se guarda en este navegador (igual que en la versión anterior).
function renderCalendario() {
  const hoy = new Date(), anio = hoy.getFullYear(), mes = hoy.getMonth();
  const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  $('#cal-mes-anio').textContent = `${meses[mes]} ${anio}`;
  const total = new Date(anio, mes + 1, 0).getDate();
  const primero = new Date(anio, mes, 1).getDay();
  let datos = {};
  try { datos = JSON.parse(localStorage.getItem('cuadrilla_asistencias') || '{}'); } catch { /* vacío */ }

  const sel = $('#select-dia-asistencia');
  if (!sel.options.length) for (let d = 1; d <= total; d++) sel.add(new Option(`Día ${d}`, d));

  let html = '<div></div>'.repeat(primero);
  for (let d = 1; d <= total; d++) {
    const st = datos[d];
    html += `<div class="cal-dia ${st || ''}"><span>${d}</span><small>${st === 'asistio' ? 'Presente' : st === 'falto' ? 'Ausente' : '·'}</small></div>`;
  }
  $('#calendario-dias').innerHTML = html;
}
$('#btn-guardar-asistencia').onclick = () => {
  let datos = {};
  try { datos = JSON.parse(localStorage.getItem('cuadrilla_asistencias') || '{}'); } catch { /* vacío */ }
  datos[$('#select-dia-asistencia').value] = $('#select-estado-asistencia').value;
  try { localStorage.setItem('cuadrilla_asistencias', JSON.stringify(datos)); } catch { /* sin almacenamiento */ }
  renderCalendario();
  toast('Asistencia actualizada');
};

/* ==================================== chat ==================================== */
// Markdown mínimo y seguro (se escapa todo el HTML antes): **negrita**, _cursiva_, listas y tablas.
function inlineMd(t) {
  return esc(t).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(^|[\s(])_(.+?)_(?=[\s).,!?]|$)/g, '$1<em>$2</em>');
}
function mdHtml(md) {
  const lineas = String(md).split('\n');
  let html = '', i = 0;
  while (i < lineas.length) {
    const l = lineas[i];
    if (/^\s*\|/.test(l)) {
      const filas = [];
      while (i < lineas.length && /^\s*\|/.test(lineas[i])) filas.push(lineas[i++]);
      const celdas = (f) => f.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const cuerpo = filas.filter(f => !/^\s*\|[\s:|-]+\|\s*$/.test(f));
      if (cuerpo.length) {
        const [cab, ...resto] = cuerpo;
        html += `<div class="chat-tabla"><table><thead><tr>${celdas(cab).map(c => `<th>${inlineMd(c)}</th>`).join('')}</tr></thead>` +
          `<tbody>${resto.map(f => `<tr>${celdas(f).map(c => `<td>${inlineMd(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
      }
    } else if (/^\s*[-•]\s+/.test(l)) {
      html += '<ul>';
      while (i < lineas.length && /^\s*[-•]\s+/.test(lineas[i])) html += `<li>${inlineMd(lineas[i++].replace(/^\s*[-•]\s+/, ''))}</li>`;
      html += '</ul>';
    } else if (!l.trim()) { i++; } else { html += `<p>${inlineMd(l)}</p>`; i++; }
  }
  return html;
}

const chatHistorial = [];   // { rol: 'yo' | 'bot', texto }
const chatCaja = () => $('#chat-mensajes');

function chatBurbuja(cls, { texto, html } = {}) {
  const d = document.createElement('div');
  d.className = `chat-msg ${cls}`;
  if (html !== undefined) d.innerHTML = html; else d.textContent = texto;
  chatCaja().appendChild(d);
  chatCaja().scrollTop = chatCaja().scrollHeight;
  return d;
}

function chatAtajos() {
  const base = [['📋 Ver tabla', 'ver tabla'], ['🟢 Disponibilidad', 'disponibilidad'], ['🖼️ Imagen del horario', 'generar imagen del horario'], ['📬 Mis mensajes', 'mis mensajes']];
  const extra = esProfe() ? [['📝 Entregar mi horario', 'entregar mi horario'], ['⭐ Mi horario', 'mi horario'], ['🔁 Cambiar horario', 'cambiar horario']]
    : esAdmin() ? [['🚫 Lista negra', 'lista negra'], ['💾 Hacer backup', 'hacer backup']] : [];
  $('#chat-atajos').innerHTML = [...extra, ...base].map(([t, q]) => `<button type="button" class="chip-chat" data-q="${esc(q)}">${esc(t)}</button>`).join('');
}
$('#chat-atajos').addEventListener('click', (e) => {
  const b = e.target.closest('[data-q]');
  if (b) enviarChat(b.dataset.q);
});

async function enviarChat(texto) {
  const boton = $('#chat-form button[type="submit"]');
  chatBurbuja('yo', { texto });
  const espera = chatBurbuja('bot', { texto: '…' });
  boton.disabled = true;
  try {
    const r = await api('/api/chatbot', { method: 'POST', body: { mensaje: texto, historial: chatHistorial.slice(-10) } });
    const respuesta = r.respuesta || '';
    let html = mdHtml(respuesta);
    if (r.tipo === 'imagen' && /^data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+$/.test(r.imagen_url || '')) {
      html += `<img class="chat-img" alt="Horario semanal" src="${r.imagen_url}"><a class="chat-descarga" download="horario.svg" href="${r.imagen_url}">⬇️ Descargar imagen</a>`;
    }
    espera.innerHTML = html || '…';
    chatHistorial.push({ rol: 'yo', texto }, { rol: 'bot', texto: respuesta });
    // Si acaba de entregar el horario, se le desbloquea la app.
    if (esProfe() && !estado.entrega.entregado) {
      await cargarEntrega();
      if (estado.entrega.entregado) { toast('¡Horario entregado! Ya podés usar todo el sistema.'); await cargarHorarios(); }
    }
  } catch (err) {
    espera.textContent = err.status === 401 ? 'Tu sesión venció. Recargá la página e iniciá sesión de nuevo.' : err.message;
    espera.classList.add('err');
  } finally {
    boton.disabled = false;
    chatCaja().scrollTop = chatCaja().scrollHeight;
  }
}

$('#chat-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('#chat-input');
  const texto = input.value.trim();
  if (!texto) return;
  input.value = '';
  input.style.height = '';
  enviarChat(texto);
});
// Foto de la planilla (solo profesores): se reduce, el servidor la lee con IA y el texto queda en el cuadro para revisarlo antes de enviar.
$('#btn-foto-horario').onclick = () => {
  if (esAdmin() && !$('#sel-foto-profe').value) return toast('Primero elegí a qué profesor pertenece la foto.', true);
  $('#input-foto-horario').click();
};
function reducirImagen(archivo) {
  return new Promise((ok, mal) => {
    const url = URL.createObjectURL(archivo), img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let lado = 1600, calidad = 0.82, data;
      for (let i = 0; i < 6; i++) {   // el servidor acepta hasta ~1 MB: se achica hasta que entre
        const k = Math.min(1, lado / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        data = c.toDataURL('image/jpeg', calidad);
        if (data.length < 900000) return ok(data);
        lado = Math.round(lado * 0.75); calidad = Math.max(0.5, calidad - 0.08);
      }
      mal(new Error('La foto es demasiado pesada.'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); mal(new Error('No pude abrir esa imagen.')); };
    img.src = url;
  });
}
// OCR en el navegador (Tesseract.js): sin clave ni IA. Lee texto suelto, no entiende la tabla; sirve de borrador.
async function ocrFoto(dataUrl, aviso) {
  if (!window.Tesseract) {
    await new Promise((ok, mal) => {
      const sc = document.createElement('script');
      sc.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
      sc.onload = ok; sc.onerror = () => mal(new Error('No se pudo cargar el lector.'));
      document.head.appendChild(sc);
    });
  }
  const { data } = await Tesseract.recognize(dataUrl, 'spa', {
    logger: (m) => { if (m.status === 'recognizing text') aviso.textContent = `📷 Leyendo la foto sin IA… ${Math.round(m.progress * 100)}%`; }
  });
  return data.text || '';
}
async function leerFoto(archivo) {
  if (!/^image\//.test(archivo.type)) return toast('Ese archivo no es una imagen.', true);
  if (esAdmin() && !$('#sel-foto-profe').value) return toast('Primero elegí a qué profesor pertenece la foto.', true);
  const boton = $('#btn-foto-horario');
  boton.disabled = true;
  const profe = esAdmin() ? $('#sel-foto-profe').value : '';
  const espera = chatBurbuja('bot', { texto: profe ? `📷 Leyendo la foto del horario de ${profe}…` : '📷 Leyendo la foto de tu horario…' });
  let imagen;
  try {
    imagen = await reducirImagen(archivo);
    const miniatura = chatBurbuja('yo', { html: `<img class="chat-img" alt="Foto del horario" src="${imagen}">` });   // la imagen sale de nuestro canvas: es segura
    chatCaja().insertBefore(miniatura, espera);
    // El servidor guarda la foto (el admin la ve en "Por profesor") y, si la lectura es limpia, la pasa a clases.
    const r = await api('/api/chatbot/foto', { method: 'POST', body: { imagen, profesor: profe || undefined } });
    const de = profe || 'tu horario';
    if (r.estado === 'entregado') {
      espera.innerHTML = mdHtml(profe
        ? `✅ Leí la foto y cargué el horario de **${profe}** (${r.total} clase${r.total === 1 ? '' : 's'}). Ya está en **Por profesor**.`
        : `✅ Leí la foto y entregué tu horario a la administración (${r.total} clase${r.total === 1 ? '' : 's'}). Ya aparece en su sección **Por profesor**. Escribí **ver mi horario entregado** para revisarlo.`);
    } else {
      let crudo = r.texto || '';
      if (!crudo && !r.con_ia) {   // sin IA: se intenta leer el texto en el navegador (Tesseract) solo como borrador
        espera.textContent = '📷 Foto recibida. Intentando leer el texto sin IA (puede tardar un poco la primera vez)…';
        try { crudo = await ocrFoto(imagen, espera); } catch (_) { /* sin conexión al lector: queda la foto */ }
      }
      espera.innerHTML = mdHtml(`📷 **Recibí la foto de ${profe ? 'el horario de ' + profe : 'tu horario'} y ya se la pasé a la administración**: la ve en **Por profesor**.` +
        (profe ? '' : ' Ya podés usar todo el sistema.') +
        (crudo.trim() ? `\n\nPara que quede cargado en clases revisá el texto de abajo (una clase por línea, ej. \`Lunes 07:30-09:00 3°MA liceo\`; corregí lo marcado con "?") y tocá Enviar.`
                      : `\n\nNo pude leer las clases de la foto: la administración las pasa a mano, o escribí tu horario acá en el chat.`));
      if (crudo.trim()) {
        const input = $('#chat-input');
        input.value = (profe ? `Cargar horario de ${profe}:\n` : '') + crudo.trim() + '\n';
        input.dispatchEvent(new Event('input'));
        input.focus();
      }
    }
    if (esProfe() && !estado.entrega.entregado) {
      await cargarEntrega();
      if (estado.entrega.entregado) { toast('¡Horario entregado! Ya podés usar todo el sistema.'); await cargarHorarios(); }
    }
    if (esAdmin()) { await cargarEntrega(); await cargarHorarios(); }
  } catch (err) {
    espera.textContent = err.status === 401 ? 'Tu sesión venció. Recargá la página e iniciá sesión de nuevo.' : err.message;
    espera.classList.add('err');
  }
  finally { boton.disabled = false; chatCaja().scrollTop = chatCaja().scrollHeight; }
}
$('#input-foto-horario').addEventListener('change', (e) => {
  const archivo = e.target.files[0];
  e.target.value = '';
  if (archivo) leerFoto(archivo);
});
// También se puede pegar (Ctrl+V) o arrastrar la foto al chat.
const imagenDe = (lista) => [...(lista || [])].find(f => /^image\//.test(f.type));
$('#chat-input').addEventListener('paste', (e) => {
  const f = imagenDe(e.clipboardData && e.clipboardData.files);
  if (f && !$('#btn-foto-horario').hidden) { e.preventDefault(); leerFoto(f); }
});
$('.chat-box').addEventListener('dragover', (e) => e.preventDefault());
$('.chat-box').addEventListener('drop', (e) => {
  e.preventDefault();
  const f = imagenDe(e.dataTransfer && e.dataTransfer.files);
  if (f && !$('#btn-foto-horario').hidden) leerFoto(f);
});
// El cuadro de texto admite varias líneas (para pegar el horario semanal): Enter envía, Shift+Enter baja de línea.
$('#chat-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('#chat-form').requestSubmit(); }
});
$('#chat-input').addEventListener('input', (e) => {
  e.target.style.height = 'auto';
  e.target.style.height = Math.min(e.target.scrollHeight, 220) + 'px';
});

/* ================================== backup (solo admin) ================================== */
const tamanoLegible = (b) => b < 1048576 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1048576).toFixed(1)} MB`;

async function cargarBackups() {
  const cont = $('#contenedor-backups');
  try {
    const { backups } = await api('/api/backup');
    cont.innerHTML = backups.length
      ? `<table class="preview-tabla"><thead><tr><th>Archivo</th><th>Tipo</th><th>Fecha</th><th>Tamaño</th><th></th></tr></thead><tbody>
         ${backups.map(b => `<tr><td>${esc(b.nombre)}</td><td>${esc(b.tipo)}</td><td>${esc(new Date(b.creado).toLocaleString('es'))}</td><td>${tamanoLegible(b.tamano)}</td>
           <td class="acciones-backup"><a class="mini" href="/api/backup/${encodeURIComponent(b.nombre)}/descargar">Descargar .db</a>
           <a class="mini" href="/api/backup/${encodeURIComponent(b.nombre)}/pdf">📄 PDF</a>
           <button class="mini" data-bk="restaurar" data-n="${esc(b.nombre)}">Restaurar</button>
           <button class="mini peligro" data-bk="borrar" data-n="${esc(b.nombre)}">Eliminar</button></td></tr>`).join('')}</tbody></table>`
      : '<p class="muted">Todavía no hay backups. Creá el primero con el botón de arriba.</p>';
  } catch (err) { cont.textContent = err.message; }
}
$('#btn-crear-backup').onclick = async (e) => {
  e.target.disabled = true;
  try { await api('/api/backup', { method: 'POST' }); toast('Backup creado'); await cargarBackups(); }
  catch (err) { toast(err.message, true); } finally { e.target.disabled = false; }
};
$('#contenedor-backups').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-bk]');
  if (!b) return;
  const n = b.dataset.n;
  try {
    if (b.dataset.bk === 'borrar') {
      if (!confirm(`¿Eliminar el backup ${n}?`)) return;
      await api(`/api/backup/${encodeURIComponent(n)}`, { method: 'DELETE' });
      toast('Backup eliminado'); await cargarBackups();
    } else {
      if (!confirm(`Se van a REEMPLAZAR todos los datos actuales por los de:\n${n}\n\nAntes se guarda un backup de seguridad. ¿Continuar?`)) return;
      const r = await api(`/api/backup/${encodeURIComponent(n)}/restaurar`, { method: 'POST', body: { confirmar: true } });
      toast(r.mensaje);
      setTimeout(() => location.reload(), 1200);
    }
  } catch (err) { toast(err.message, true); }
});

/* =============================== lista negra =============================== */
async function cargarListaNegra() {
  const cont = $('#contenedor-lista-negra');
  try {
    const r = await api('/api/lista-negra');
    cont.innerHTML = r.lista_negra.length
      ? `<table class="preview-tabla"><thead><tr><th>Profesor</th><th>Faltas</th><th>Última falta</th></tr></thead><tbody>
         ${r.lista_negra.map(p => `<tr><td>${esc(p.profesor_nombre)}</td><td>${p.total_faltas}</td><td>${esc(p.ultima_falta || '')}</td></tr>`).join('')}</tbody></table>`
      : `<p class="muted">Nadie alcanzó el límite de ${r.limite_faltas} faltas.</p>`;
  } catch (err) { cont.textContent = err.message; }
}

/* ================================== inicio ================================== */
(async function iniciar() {
  try {
    const { user } = await api('/api/auth/me');
    await entrar(user);
  } catch { /* sin sesión: se queda en el login */ }
})();
