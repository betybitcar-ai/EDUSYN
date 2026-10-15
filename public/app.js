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
  profesores: [],
  traslados: [],
  salones: [],
  filtroMateria: null,
  vistaMio: 'horas',
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
  if (esProfe()) $('#horarios-titulo').textContent = 'Horario de toda la institución';

  if (esAdmin()) {
    estado.profesores = (await api('/api/horarios/profesores').catch(() => ({ profesores: [] }))).profesores;
  }
  await cargarHorarios();
  if (esAdmin()) actualizarBadgeCambios();
  irA(esProfe() ? 'mi-horario' : 'horarios');
}

/* ================================ navegación ================================ */
function irA(vista) {
  $$('#sidebar-nav .nav-item').forEach(b => b.classList.toggle('is-active', b.dataset.vista === vista));
  $$('.main-area .vista').forEach(v => v.classList.toggle('is-active', v.id === `vista-${vista}`));
  if (vista === 'avisos') cargarFeed('aviso');
  if (vista === 'noticias') cargarFeed('noticia');
  if (vista === 'lista-negra') cargarListaNegra();
  if (vista === 'backup' && esAdmin()) cargarBackups();
  if (vista === 'chat') chatAtajos();
  if (vista === 'asistencias') renderCalendario();
  if (vista === 'mi-horario') renderMiHorario();
  if (vista === 'profesores') renderProfesores();
  if (vista === 'cambios') cargarCambios();
  if (vista === 'salones') renderSalones();
  if (vista === 'historial') cargarHistorial();
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
  estado.publicado = data.publicado;
  estado.publicadoEn = data.publicado_en;
  renderEstadoPublicacion();
  renderHorarios();
  if (esProfe()) renderMiHorario();
  if (esAdmin()) {
    estado.traslados = (await api('/api/horarios/traslados').catch(() => ({ traslados: [] }))).traslados;
    estado.salones = (await api('/api/horarios/salones').catch(() => ({ salones: [] }))).salones;
    renderProfesores();
  }
}

function renderEstadoPublicacion() {
  const pill = $('#estado-pill');
  pill.textContent = estado.publicado ? 'Publicado' : 'En borrador';
  pill.className = `pill ${estado.publicado ? 'pill-publicado' : 'pill-borrador'}`;
  let detalle = '';
  if (esAdmin()) {
    detalle = estado.publicado
      ? `Profesores y alumnos ya lo ven${estado.publicadoEn ? ' · desde ' + new Date(estado.publicadoEn).toLocaleString('es') : ''}.`
      : 'Borrador: solo vos lo ves. Al publicarlo, cada profesor ve su propio horario y los alumnos la grilla.';
  } else if (esProfe()) {
    detalle = estado.publicado ? 'Publicado por la administración.' : 'La administración todavía no lo publicó.';
  }
  $('#estado-detalle').textContent = detalle;
  const btn = $('#btn-publicar');
  btn.textContent = estado.publicado ? '🔒 Volver a borrador' : '📢 Publicar a alumnos';
  btn.className = `btn ${estado.publicado ? 'btn-secondary' : 'btn-primary'}`;
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
            data-busca="${esc((h.materia + ' ' + (h.profesor_nombre || '') + ' ' + (h.salon || '')).toLowerCase())}">
      <span class="clase-hora">${esc(h.hora_inicio)} – ${esc(h.hora_fin)}</span>
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
  const generales = horariosGenerales();
  const sinContenido = (!esAdmin() && !estado.publicado) || !generales.length;
  $('.toolbar').hidden = sinContenido;

  if (!esAdmin() && !estado.publicado) {
    cont.style.setProperty('--cols', 1);
    cont.innerHTML = `<div class="vacio"><div class="emoji">🛠️</div><h3>El horario todavía se está armando</h3>
      <p class="muted">Cuando la administración lo publique, lo vas a ver acá${esProfe() ? ', y tu horario personal en “Mi horario”' : ' con todos sus colores'}.</p></div>`;
    $('#leyenda').innerHTML = '';
    return;
  }
  if (!generales.length) {
    cont.style.setProperty('--cols', 1);
    cont.innerHTML = `<div class="vacio"><div class="emoji">🗓️</div><h3>No hay clases cargadas</h3>
      <p class="muted">${esAdmin() ? 'Creá una clase con “+ Nueva clase”.' : 'Todavía no hay clases.'}</p></div>`;
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
  const quiere = !estado.publicado;
  const sinProf = horariosGenerales().filter(h => !h.profesor_id && !h.profesor_nombre).length;
  const traslados = estado.traslados.length ? `\n\nOjo: ${estado.traslados.length} traslado(s) liceo↔UTU con poco margen (miralos en “Por profesor”).` : '';
  const aviso = (sinProf ? `\n\nOjo: ${sinProf} clase(s) todavía no tienen profesor.` : '') + traslados;
  if (!confirm(quiere ? `¿Publicar el horario? Cada profesor va a ver su propio horario en “Mi horario” y los alumnos la grilla.${aviso}` : '¿Volver a borrador? Profesores y alumnos dejarán de verlo.')) return;
  try {
    const r = await api('/api/horarios/publicar', { method: 'POST', body: { publicado: quiere } });
    toast(quiere ? `¡Horario publicado! Se avisó a ${r.profesores_avisados} profesor${r.profesores_avisados === 1 ? '' : 'es'}.` : 'El horario volvió a borrador');
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
$('#btn-nueva-clase').onclick = () => abrirModal();
$('#clase-cancelar').onclick = () => modal.close();

$('#form-clase').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pid = $('#clase-profesor').value;
  const cuerpo = {
    dia: $('#clase-dia').value, materia: $('#clase-materia').value,
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
  if (!estado.publicado) {
    $('#mi-resumen').textContent = '';
    $('#mi-hoy').innerHTML = '';
    $('#tabla-mio').hidden = true;
    const c = $('#grilla-mio'); c.hidden = false; c.style.setProperty('--cols', 1);
    c.innerHTML = `<div class="vacio"><div class="emoji">🛠️</div><h3>Tu horario todavía no está publicado</h3>
      <p class="muted">Cuando la administración publique el horario, tus clases te van a aparecer acá.</p></div>`;
    return;
  }
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
      <p class="muted">La administración te va a asignar tus clases, o podés tomar una libre desde “Horario”.</p></div>`;
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

/* ---------- admin: horario de cada profesor ---------- */
let profSeleccion = '';
function renderProfesores() {
  if (!esAdmin()) return;
  const sel = $('#prof-select');
  const conteo = (p) => estado.horarios.filter(h => claveProfesor(h) === (p.id ? String(p.id) : `n:${p.nombre}`)).length;
  const opcion = (p) => `<option value="${p.id ? p.id : 'n:' + esc(p.nombre)}">${esc(p.nombre)} (${conteo(p)} clases)${p.cuenta ? '' : ' · sin cuenta aún'}</option>`;
  const grupo = (titulo, lista) => lista.length ? `<optgroup label="${titulo}">${lista.map(opcion).join('')}</optgroup>` : '';
  sel.innerHTML = grupo('Turno 1', estado.profesores.filter(p => p.turno === 1)) + grupo('Turno 2', estado.profesores.filter(p => p.turno === 2)) +
    grupo('Otros', estado.profesores.filter(p => !p.turno));
  if (!profSeleccion || ![...sel.options].some(o => o.value === profSeleccion)) profSeleccion = sel.options[0]?.value || '';
  sel.value = profSeleccion;

  const tabla = $('#prof-tabla'), grilla = $('#prof-grilla');
  const avisos = estado.traslados.filter(t => t.clave === profSeleccion);
  $('#prof-avisos').innerHTML = avisos.map(t => `<div class="aviso-traslado">⚠️ ${esc(t.texto)}</div>`).join('');
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

/* ---------- imprimir / guardar como PDF ---------- */
// Arma una hoja por profesor en #zona-impresion y abre el diálogo de impresión (ahí se elige "Guardar como PDF").
function imprimirHorarios(lista) {
  const conClases = lista.filter(x => x.clases.length);
  if (!conClases.length) return toast('No hay clases para imprimir.', true);
  const fecha = new Date().toLocaleDateString('es');
  $('#zona-impresion').innerHTML = conClases.map(({ nombre, clases }) => {
    const horas = clases.reduce((a, h) => a + (aMin(h.hora_fin) - aMin(h.hora_inicio)) / 60, 0);
    return `<section class="hoja">
      <h1>${esc(nombre)}</h1>
      <p class="hoja-sub">Cuadrilla · Horario semanal · ${clases.length} clases · ${horas.toFixed(1).replace('.0', '')} h semanales · ${fecha}</p>
      ${tablaHorasHtml(clases)}
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
        <b>${esc(h.materia)}</b>${exacto ? '' : `<small>${esc(sinCero(h.hora_inicio))} a ${esc(sinCero(h.hora_fin))}</small>`}${mostrarProfesor ? (h.profesor_nombre ? `<small>👤 ${esc(h.profesor_nombre)}</small>` : '') : (h.salon ? `<small>📍 ${esc(h.salon)}</small>` : '')}</td>`;
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
async function cargarFeed(tipo) {
  const cont = $(tipo === 'aviso' ? '#lista-avisos' : '#lista-noticias');
  try {
    const { avisos } = await api(`/api/avisos?tipo=${tipo}`);
    cont.innerHTML = avisos.length ? avisos.map(a => `
      <article class="feed-item" style="--h:${matiz(a.titulo)}">
        <h4>${esc(a.titulo)}</h4>
        <small>${esc(a.autor_nombre)} · ${esc(new Date(a.creado_en.replace(' ', 'T') + 'Z').toLocaleDateString('es'))}</small>
        <p>${esc(a.contenido)}</p>
        ${esAdmin() ? `<div class="clase-acc"><button class="mini peligro" data-del="${a.id}" data-tipo="${tipo}">Eliminar</button></div>` : ''}
      </article>`).join('') : `<div class="vacio"><div class="emoji">${tipo === 'aviso' ? '📭' : '🗞️'}</div><h3>Nada por acá todavía</h3></div>`;
  } catch (err) { cont.innerHTML = `<p class="err">${esc(err.message)}</p>`; }
}
$$('.form-publicar').forEach(form => form.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/api/avisos', { method: 'POST', body: { tipo: form.dataset.tipo, titulo: form.titulo.value, contenido: form.contenido.value } });
    form.reset();
    toast('Publicado');
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
  return esc(t).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(^|[\s(])_(.+?)_(?=[\s).,!?]|$)/g, '$1<em>$2</em>');
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
  const extra = esProfe() ? [['⭐ Mi horario', 'mi horario'], ['🔁 Cambiar horario', 'cambiar horario']]
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
  enviarChat(texto);
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
           <td class="acciones-backup"><a class="mini" href="/api/backup/${encodeURIComponent(b.nombre)}/descargar">Descargar</a>
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
