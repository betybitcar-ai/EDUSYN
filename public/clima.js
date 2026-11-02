'use strict';
/* Clima de Artigas: pantalla completa + mini widget en la barra lateral. Lo usan todos los roles. */
window.Clima = (() => {
  const REFRESCO_MS = 10 * 60 * 1000;
  let datos = null;
  let error = '';
  let timer = null;
  let cargando = null;

  async function cargar() {
    if (cargando) return cargando;
    cargando = api('/api/clima')
      .then(d => { datos = d; error = ''; })
      .catch(e => { error = e.message; })
      .finally(() => { cargando = null; renderMini(); renderVista(); });
    return cargando;
  }

  function renderMini() {
    const ico = $('#clima-mini-ico'), temp = $('#clima-mini-temp'), desc = $('#clima-mini-desc');
    if (!ico) return;
    if (datos) {
      ico.textContent = datos.actual.icono;
      temp.textContent = datos.actual.temperatura != null ? `${datos.actual.temperatura}°` : '--°';
      desc.textContent = `Artigas · ${datos.actual.texto}`;
    } else {
      ico.textContent = '🌡️';
      temp.textContent = '--°';
      desc.textContent = error ? 'Clima no disponible' : 'Artigas';
    }
  }

  // 'YYYY-MM-DD' → fecha local (sin el corrimiento de zona horaria que causa new Date('YYYY-MM-DD')).
  function fechaLocal(iso) {
    const [a, m, d] = String(iso).split('-').map(Number);
    return new Date(a, (m || 1) - 1, d || 1);
  }
  function etiquetaDia(iso, i) {
    if (i === 0) return 'Hoy';
    if (i === 1) return 'Mañana';
    return NOMBRE_DIA_JS[fechaLocal(iso).getDay()];
  }
  function fechaCorta(iso) {
    const f = fechaLocal(iso);
    return `${f.getDate()}/${String(f.getMonth() + 1).padStart(2, '0')}`;
  }
  const num = (v, suf = '') => (v == null ? '–' : `${v}${suf}`);

  // Consejo breve según el clima de hoy.
  function consejo(d) {
    const hoy = d.dias[0] || {}, a = d.actual;
    const prob = hoy.prob_lluvia ?? 0;
    if (prob >= 60 || (a.lluvia_mm || 0) > 0.2) return '☔ Hay probabilidad alta de lluvia: llevá paraguas o piloto.';
    if (a.temperatura != null && a.temperatura <= 8) return '🧥 Hace frío: abrigate bien para el liceo y la UTU.';
    if (a.temperatura != null && a.temperatura >= 32) return '🥵 Hace mucho calor: tomá agua y buscá la sombra en los recreos.';
    if ((a.viento_kmh || 0) >= 40) return '💨 Viento fuerte: cuidado con las puertas y los papeles en los patios.';
    if (prob >= 30) return '🌂 Puede llover: por las dudas, llevá algo para la lluvia.';
    return '🙂 Buen día para estar en la institución.';
  }

  function renderVista() {
    const cont = $('#clima-contenido');
    if (!cont) return;
    if (!datos) {
      cont.innerHTML = error
        ? `<div class="vacio"><div class="emoji">📡</div><h3>No pudimos traer el clima</h3><p class="muted">${esc(error)}</p></div>`
        : '<div class="card">Cargando…</div>';
      return;
    }
    const a = datos.actual;
    const hora = datos.actualizado ? String(datos.actualizado).slice(11, 16) : '';
    $('#clima-sub').textContent = `${datos.ciudad}${hora ? ' · actualizado a las ' + hora : ''}${datos.desactualizado ? ' · sin conexión: mostrando el último dato guardado' : ''}`;
    cont.innerHTML = `
      <div class="clima-hero ${a.es_dia ? 'dia' : 'noche'}">
        <div class="clima-hero-principal">
          <span class="clima-hero-ico" aria-hidden="true">${a.icono}</span>
          <div>
            <div class="clima-hero-temp">${num(a.temperatura, '°C')}</div>
            <div class="clima-hero-texto">${esc(a.texto)}</div>
            <div class="clima-hero-sens">Sensación térmica ${num(a.sensacion, '°C')}</div>
          </div>
        </div>
        <div class="clima-datos">
          <div class="clima-dato"><span>💧</span><b>${num(a.humedad, '%')}</b><small>Humedad</small></div>
          <div class="clima-dato"><span>🌬️</span><b>${num(a.viento_kmh, ' km/h')}${a.viento_dir ? ' ' + esc(a.viento_dir) : ''}</b><small>Viento</small></div>
          <div class="clima-dato"><span>🌧️</span><b>${num(a.lluvia_mm, ' mm')}</b><small>Lluvia ahora</small></div>
          <div class="clima-dato"><span>☔</span><b>${num(datos.dias[0]?.prob_lluvia, '%')}</b><small>Lluvia hoy</small></div>
        </div>
      </div>
      <p class="clima-consejo">${esc(consejo(datos))}</p>
      <h3 class="clima-titulo">Próximos días</h3>
      <div class="clima-dias">
        ${datos.dias.map((d, i) => `
          <article class="card clima-dia${i === 0 ? ' es-hoy' : ''}">
            <h4>${esc(etiquetaDia(d.fecha, i))}</h4>
            <small class="muted">${esc(fechaCorta(d.fecha))}</small>
            <div class="clima-dia-ico" aria-hidden="true">${d.icono}</div>
            <div class="clima-dia-texto">${esc(d.texto)}</div>
            <div class="clima-dia-temps"><b>${num(d.max, '°')}</b><span>${num(d.min, '°')}</span></div>
            <small class="muted">☔ ${num(d.prob_lluvia, '%')}${d.lluvia_mm ? ' · ' + d.lluvia_mm + ' mm' : ''}</small>
          </article>`).join('')}
      </div>
      <p class="muted clima-fuente">Datos: Open-Meteo · se actualizan cada 10 minutos.</p>`;
  }

  function iniciar() {
    renderMini();
    cargar();
    clearInterval(timer);
    timer = setInterval(cargar, REFRESCO_MS);
  }

  function abrir() {
    renderVista();
    cargar();
  }

  document.addEventListener('click', (e) => {
    if (e.target.closest('#clima-mini')) irA('clima');
    if (e.target.closest('#btn-clima-recargar')) {
      const b = $('#btn-clima-recargar');
      b.disabled = true;
      cargar().finally(() => { b.disabled = false; toast(error ? error : 'Clima actualizado.', Boolean(error)); });
    }
  });

  return { iniciar, abrir, _estado: () => ({ datos, error }) };
})();
