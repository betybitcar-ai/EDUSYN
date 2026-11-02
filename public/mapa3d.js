'use strict';
/* Plano 3D de la Escuela Técnica De Vecchi (UTU Artigas), con la fachada de la foto en la entrada. Lo ven todos los roles.
   Está hecho con CSS 3D (sin librerías externas). Para cambiar la distribución, editá SALONES_MAPA. */
window.Mapa3D = (() => {
  const K = 1.5;       // escala: px del plano → px en pantalla
  const ALTO = 58;     // alto de los salones
  const SEP = 150;     // separación vertical entre plantas
  const LOSA = 10;     // espesor del piso de cada planta
  const PLANTAS = ['Planta baja', 'Planta alta'];

  // Terreno del plano (px del plano oficial). El centro de este rectángulo es el centro de la escena.
  const SITIO = { x: 40, y: 65, w: 528, h: 470 };
  const CX = SITIO.x + SITIO.w / 2, CY = SITIO.y + SITIO.h / 2;
  // El plano dibuja la planta alta aparte; acá se la coloca flotando sobre la planta baja. Ajustá el desplazamiento si hace falta.
  const PLANTA_ALTA_DESPLAZAMIENTO = { dx: -326, dy: 28 };

  const PA_CENTRO = { x: (628 + 853) / 2 + PLANTA_ALTA_DESPLAZAMIENTO.dx, y: (122 + 424) / 2 + PLANTA_ALTA_DESPLAZAMIENTO.dy };

  // Colores del plano: amarillo = salones, azul = talleres, naranja = otros espacios, verde = área deportes, gris = espacios abiertos.
  const TIPOS = {
    salon:    { edificio: true, nombre: 'Salón',          h: 50,  alto: ALTO, clases: true },
    taller:   { edificio: true, nombre: 'Taller',         h: 205, alto: ALTO, clases: true },
    otros:    { edificio: true, nombre: 'Otros espacios', h: 25,  alto: ALTO, clases: false },
    deportes: { nombre: 'Área deportes',  h: 100, alto: 8,    clases: false },
    abierto:  { nombre: 'Espacio abierto', h: 40, alto: 3,    clases: false },
    entrada:  { nombre: 'Entrada',        h: 2,   alto: 3,    clases: false }
  };

  // Pisos del edificio (rectángulos en px del plano; la planta alta usa sus propias coordenadas del plano).
  const LOSAS = [
    { piso: 0, x: 182, y: 85, w: 366, h: 430 }, { piso: 0, x: 60, y: 180, w: 122, h: 180 },
    { piso: 1, x: 628, y: 122, w: 84, h: 240 }, { piso: 1, x: 686, y: 333, w: 167, h: 29 }, { piso: 1, x: 700, y: 362, w: 153, h: 62 }
  ];

  // Espacios del plano de la Escuela Técnica Maestro Carlos Martín De Vecchi. `n` es el número del plano; `alias`, otros nombres
  // con los que puede venir cargado el salón en el horario (Salón 7 = Aula 7 = 7).
  const sp = (n, nombre, tipo, piso, x, y, w, h, alias = [], id = `n${n}`) => ({ id, n, nombre, tipo, piso, x, y, w, h, alias });
  const sl = (n, num, x, y, w, h, piso, extra = [], nombre = `Salón ${num}`) =>
    sp(n, nombre, 'salon', piso, x, y, w, h, [`Salón ${num}`, `Aula ${num}`, String(num), ...extra]);
  const SALONES_MAPA = [
    // ---- Planta baja ----
    sp(23, 'Taller Belleza Capilar', 'taller', 0, 196, 97, 72, 52),
    sp(24, 'Salón Gastronomía', 'taller', 0, 268, 105, 60, 43, ['Gastronomía']),
    sl(25, 14, 328, 105, 24, 27, 0),
    sp(26, 'Sala Informática 2 (Ex ERMA)', 'salon', 0, 352, 105, 59, 27, ['Sala Informática 2', 'Sala de informática 2']),
    sl(27, 12, 411, 105, 37, 43, 0),
    sl(28, 11, 411, 148, 37, 62, 0, ['Laboratorio'], 'Salón 11 Laboratorio'),
    sl(29, 10, 411, 210, 37, 33, 0, ['Sala de informática 1', 'Sala Informática 1'], 'Salón 10 Sala de informática 1'),
    sp(30, 'Cantina', 'otros', 0, 411, 243, 37, 32),
    sp(33, 'Cancha', 'deportes', 0, 455, 147, 78, 128),
    sp(22, 'Taller Mecánica Automotriz', 'taller', 0, 60, 180, 67, 62),
    sp(21, 'Aula Automotriz', 'taller', 0, 127, 180, 71, 32),
    sp(19, 'Taller Electrotecnia', 'taller', 0, 127, 212, 71, 30),
    sp(20, 'Aula Electrotecnia', 'salon', 0, 150, 243, 32, 22),
    sp(16, 'Aula Mecánica General', 'salon', 0, 150, 265, 32, 32),
    sp(14, 'Aula Carpintería', 'salon', 0, 150, 297, 32, 36),
    sl(37, 15, 97, 333, 53, 27, 0, ['UTUlab'], 'Salón 15 UTUlab'),
    sp(38, 'Baños (patio interior)', 'otros', 0, 78, 333, 19, 27),
    sp(15, 'Taller Mecánica General', 'taller', 0, 182, 243, 103, 54),
    sp(18, 'Baño Caballeros (patio)', 'otros', 0, 285, 243, 15, 17),
    sp(17, 'Baño Damas (patio)', 'otros', 0, 285, 260, 15, 15),
    sp(13, 'Taller Carpintería', 'taller', 0, 182, 297, 103, 75),
    sl(10, 17, 248, 360, 38, 28, 0),
    sp(9, 'Baño dirección', 'otros', 0, 248, 385, 20, 13),
    sp(8, 'Dirección', 'otros', 0, 248, 398, 37, 24),
    sp(50, 'Espacio de Diálogo', 'otros', 0, 255, 422, 17, 18),
    sp(7, 'Sala Multiespacio', 'otros', 0, 255, 443, 30, 37),
    sl(11, 7, 302, 320, 41, 70, 0),
    sl(12, 8, 343, 320, 68, 70, 0),
    sp(6, 'Baños inclusivos (varones y damas)', 'otros', 0, 302, 390, 41, 32),
    sp(5, 'Baño sala de profesores', 'otros', 0, 343, 390, 29, 15),
    sp(4, 'Sala de profesores', 'otros', 0, 372, 390, 39, 32),
    sp(2, 'Adscripción', 'otros', 0, 343, 422, 54, 58),
    sp(3, 'Administración', 'otros', 0, 397, 422, 31, 58),
    sl(34, 9, 500, 318, 27, 50, 0, [], 'Salón 9 (aula móvil)'),
    sp(35, 'Baño Dama (aula móvil)', 'otros', 0, 500, 368, 27, 17),
    sp(36, 'Baño caballero (aula móvil)', 'otros', 0, 500, 385, 27, 18),
    // espacios abiertos
    sp(31, 'Patio', 'abierto', 0, 196, 148, 215, 92, [], 'p31a'),
    sp(31, 'Patio', 'abierto', 0, 428, 320, 120, 195, [], 'p31b'),
    sp(32, 'Galería', 'abierto', 0, 300, 240, 111, 80),
    sp(39, 'Estacionamiento', 'abierto', 0, 182, 372, 66, 143),
    sp(40, 'Patio Interior', 'abierto', 0, 60, 242, 90, 93),
    sp(0, 'Entrada principal', 'entrada', 0, 290, 484, 22, 10, [], 'entrada'),
    // ---- Planta alta ----
    sl(49, 6, 628, 122, 70, 73, 1),
    sp(48, 'Baño unisex', 'otros', 1, 628, 195, 32, 25),
    sl(47, 5, 628, 235, 70, 47, 1, ['Sala informática 3', 'Sala de informática 3'], 'Salón 5 Sala informática 3'),
    sl(45, '4A', 628, 282, 70, 40, 1),
    sl(46, '4B', 628, 322, 70, 40, 1),
    sp(44, 'Baño unisex', 'otros', 1, 720, 333, 16, 19, [], 'n44'),
    sl(43, 3, 700, 362, 48, 62, 1),
    sl(42, 2, 748, 362, 57, 62, 1),
    sl(41, 1, 805, 362, 48, 62, 1)
  ];

  /* ------------------------------ fachada y entorno (según la foto de la UTU) ------------------------------ */
  // La entrada del plano está sobre calle Bernabé Rivera (abajo). Todo se ubica con coordenadas del plano.
  const PX = (x) => (x - CX) * K, PZ = (y) => (y - CY) * K;
  const decorPlantaBaja = () => {
    const D = (o) => caja({ y: 0, ...o, clase: `m3d-decor ${o.clase || ''}` });
    const lista = [];
    const FRENTE = 515;                      // borde del terreno sobre la calle Bernabé Rivera
    const ENT = { izq: 284, der: 316 };      // hueco de la entrada principal
    // pilastras de ladrillo y puerta con arco en la entrada
    for (const x of [ENT.izq, ENT.der]) lista.push(D({ w: 12, h: ALTO, d: 10, x: PX(x), y: -ALTO / 2, z: PZ(FRENTE), clase: 'm3d-ladrillo' }));
    lista.push(D({ w: (ENT.der - ENT.izq) * K - 14, h: ALTO * 0.78, d: 2, x: PX((ENT.izq + ENT.der) / 2), y: -ALTO * 0.39, z: PZ(FRENTE) + 1, clase: 'm3d-puerta' }));
    // muro bajo con reja a ambos lados de la entrada, y el cartel "Juntos diseñamos el cambio"
    const tramos = [[182, ENT.izq - 6], [ENT.der + 6, 548]];
    for (const [a, b] of tramos) {
      const w = (b - a) * K, x = PX((a + b) / 2);
      lista.push(D({ w, h: 20, d: 8, x, y: -10, z: PZ(FRENTE), clase: 'm3d-muro' }));
      lista.push(D({ w, h: 26, d: 2, x, y: -33, z: PZ(FRENTE), clase: 'm3d-reja' }));
    }
    lista.push(D({ w: 200, h: 28, d: 2, x: PX(430), y: -34, z: PZ(FRENTE) + 3, clase: 'm3d-cartel', rotulo: 'JUNTOS DISEÑAMOS EL CAMBIO' }));
    // palmera y mástil con la bandera, junto a la entrada
    const zp = PZ(FRENTE - 14);
    lista.push(D({ w: 9, h: 105, d: 9, x: PX(345), y: -52, z: zp, clase: 'm3d-tronco' }));
    lista.push(D({ w: 84, h: 5, d: 22, x: PX(345), y: -108, z: zp, clase: 'm3d-fronda' }));
    lista.push(D({ w: 22, h: 5, d: 84, x: PX(345), y: -112, z: zp, clase: 'm3d-fronda' }));
    lista.push(D({ w: 3, h: 100, d: 3, x: PX(262), y: -50, z: zp, clase: 'm3d-baston' }));
    lista.push(D({ w: 26, h: 16, d: 1, x: PX(262) + 14, y: -88, z: zp, clase: 'm3d-bandera' }));
    // vereda y calles que rodean el terreno
    const ancho = SITIO.w * K;
    lista.push(D({ w: ancho, h: 4, d: (SITIO.y + SITIO.h - FRENTE) * K, x: 0, y: LOSA + 1, z: PZ((FRENTE + SITIO.y + SITIO.h) / 2), clase: 'm3d-vereda' }));
    const calle = (w, d, x, z, texto) => D({ w, h: 4, d, x, y: LOSA + 2, z, clase: 'm3d-calle', techo: `<span class="m3d-rotulo m3d-rotulo-calle">${texto}</span>` });
    lista.push(calle(ancho + 160, 60, 0, PZ(SITIO.y + SITIO.h) + 30, 'Calle Bernabé Rivera'));
    lista.push(calle(ancho + 160, 60, 0, PZ(SITIO.y) - 30, 'Calle Río Branco'));
    lista.push(calle(60, SITIO.h * K, PX(SITIO.x + SITIO.w) + 30, 0, 'Calle Gral. Rivera'));
    return lista;
  };

  const norm = (t) => normSalon(t);
  const nombresDe = (s) => [s.nombre, ...(s.alias || [])].map(norm);
  const coincide = (sala, textoSalon) => nombresDe(sala).includes(norm(textoSalon));

  const cam = { rx: -40, ry: -24, zoom: 1 };
  let construido = false, planta = '0', seleccion = null, verOcupacion = false, aspectoEdificio = true;
  const els = new Map();   // id de salón → elemento
  const pisos = [];

  /* ------------------------------ construcción 3D ------------------------------ */
  const cara = (cls, w, h, left, top, transform, contenido = '') =>
    `<div class="m3d-cara ${cls}" style="width:${w}px;height:${h}px;left:${left}px;top:${top}px;transform:${transform}">${contenido}</div>`;

  // Caja 3D de w×h×d px con su centro en (x, y, z). `rotulo` se escribe sobre el techo y los frentes.
  function caja({ w, h, d, x, y, z, clase = '', estilo = '', rotulo = '', techo = null }) {
    const el = document.createElement('div');
    el.className = `m3d-caja ${clase}`;
    el.style.cssText = `width:${w}px;height:${h}px;--tx:${x - w / 2}px;--ty:${y - h / 2}px;--tz:${z}px;${estilo}`;
    const r = rotulo ? `<span class="m3d-rotulo">${rotulo}</span>` : '';
    el.innerHTML =
      cara('f-front', w, h, 0, 0, `translateZ(${d / 2}px)`, r) +
      cara('f-back', w, h, 0, 0, `rotateY(180deg) translateZ(${d / 2}px)`, r) +
      cara('f-right', d, h, (w - d) / 2, 0, `rotateY(90deg) translateZ(${w / 2}px)`) +
      cara('f-left', d, h, (w - d) / 2, 0, `rotateY(-90deg) translateZ(${w / 2}px)`) +
      cara('f-top', w, d, 0, (h - d) / 2, `rotateX(90deg) translateZ(${h / 2}px)`, techo ?? r);
    return el;
  }

  // Lo que se escribe sobre cada espacio: el número del plano y, si entra, el nombre.
  function rotuloDe(s) {
    if (s.tipo === 'abierto' || s.tipo === 'deportes' || s.tipo === 'entrada') return esc(s.nombre);
    return s.w * s.h >= 2200 ? `<b>${s.n}</b><br>${esc(s.nombre)}` : `<b>${s.n}</b>`;
  }

  function construir() {
    const mundo = $('#m3d-mundo');
    mundo.innerHTML = '';
    els.clear(); pisos.length = 0;
    const px = (v, c) => (v - c) * K;
    PLANTAS.forEach((nombre, piso) => {
      const g = document.createElement('div');
      g.className = 'm3d-piso';
      g.dataset.piso = piso;
      const off = piso === 1 ? PLANTA_ALTA_DESPLAZAMIENTO : { dx: 0, dy: 0 };
      if (piso === 0) {   // el terreno verde bajo la planta baja
        g.appendChild(caja({ w: SITIO.w * K, h: 6, d: SITIO.h * K, x: 0, y: LOSA + 3, z: 0, clase: 'm3d-patio' }));
      }
      LOSAS.filter(l => l.piso === piso).forEach(l => g.appendChild(caja({
        w: l.w * K, h: LOSA, d: l.h * K, x: px(l.x + l.w / 2 + off.dx, CX), y: LOSA / 2, z: px(l.y + l.h / 2 + off.dy, CY), clase: 'm3d-losa'
      })));
      SALONES_MAPA.filter(s => s.piso === piso).forEach(s => {
        const alto = TIPOS[s.tipo].alto;
        const el = caja({
          w: s.w * K - 3, h: alto, d: s.h * K - 3,
          x: px(s.x + s.w / 2 + off.dx, CX), y: -alto / 2, z: px(s.y + s.h / 2 + off.dy, CY),
          clase: `m3d-sala tipo-${s.tipo}${TIPOS[s.tipo].edificio ? ' edif' : ''}`, rotulo: rotuloDe(s)
        });
        el.dataset.id = s.id;
        el.title = `${s.n ? s.n + ' · ' : ''}${s.nombre}`;
        g.appendChild(el);
        els.set(s.id, el);
      });
      if (piso === 0) decorPlantaBaja().forEach(el => g.appendChild(el));
      mundo.appendChild(g);
      pisos.push(g);
    });
  }

  /* --------------------------------- cámara ---------------------------------- */
  const limitar = (v, a, b) => Math.min(b, Math.max(a, v));
  function aplicarCamara() {
    cam.zoom = limitar(cam.zoom, 0.3, 2.4);
    cam.rx = limitar(cam.rx, -88, -10);
    $('#m3d-mundo').style.transform = `scale3d(${cam.zoom},${cam.zoom},${cam.zoom}) rotateX(${cam.rx}deg) rotateY(${cam.ry}deg)`;
  }
  function zoomAjustado() {
    const ancho = $('#m3d-escena').clientWidth || 800;
    return limitar(ancho / ((SITIO.w * K + 160) * 1.05), 0.25, 1.2);
  }
  function reiniciarCamara() {
    cam.rx = -40; cam.ry = -24; cam.zoom = zoomAjustado();
    aplicarCamara();
  }

  function aplicarPlanta() {
    const salaSel = seleccion && SALONES_MAPA.find(x => x.id === seleccion);
    pisos.forEach((g, i) => {
      const visible = planta === 'todas' || Number(planta) === i;
      const ty = planta === 'todas' ? -i * SEP + (SEP + ALTO) / 2 : ALTO / 2;
      // Al ver solo la planta alta se la centra en pantalla (su posición sobre la baja es aproximada).
      const centrar = planta !== 'todas' && i === 1;
      const tx = centrar ? -(PA_CENTRO.x - CX) * K : 0, tz = centrar ? -(PA_CENTRO.y - CY) * K : 0;
      g.style.transform = `translate3d(${tx}px, ${ty}px, ${tz}px)`;
      g.classList.toggle('oculto', !visible);
      // Con un salón elegido y ambas plantas a la vista, la otra planta se hace translúcida para no taparlo.
      g.classList.toggle('atenuado', visible && planta === 'todas' && Boolean(salaSel) && salaSel.piso !== i);
    });
    $$('#m3d-plantas [data-planta]').forEach(b => b.classList.toggle('is-on', b.dataset.planta === planta));
  }

  /* ------------------------------ ocupación ------------------------------ */
  const haySalonesCargados = () => estado.horarios.some(h => h.salon);

  function momento() {
    if (verOcupacion) return { dia: $('#m3d-ocup-dia').value, min: aMin($('#m3d-ocup-hora').value || '00:00') };
    const n = new Date();
    return { dia: NOMBRE_DIA_JS[n.getDay()], min: n.getHours() * 60 + n.getMinutes() };
  }
  const clasesDe = (sala) => estado.horarios.filter(h => h.salon && coincide(sala, h.salon));

  // → { estado: 'ocupado' | 'libre' | 'sin-datos' | 'no-aplica', clase }
  function estadoSala(sala, m = momento()) {
    if (!TIPOS[sala.tipo].clases) return { estado: 'no-aplica', clase: null };
    if (!haySalonesCargados()) return { estado: 'sin-datos', clase: null };
    const c = clasesDe(sala).find(h => h.dia === m.dia && m.min >= aMin(h.hora_inicio) && m.min < aMin(h.hora_fin));
    return c ? { estado: 'ocupado', clase: c } : { estado: 'libre', clase: null };
  }

  function pintarOcupacion() {
    const m = momento();
    SALONES_MAPA.forEach(s => {
      const el = els.get(s.id);
      el.classList.remove('est-ocupado', 'est-libre', 'est-neutro');
      if (!verOcupacion) return;
      const e = estadoSala(s, m).estado;
      el.classList.add(e === 'ocupado' ? 'est-ocupado' : e === 'libre' ? 'est-libre' : 'est-neutro');
    });
    renderLeyenda();
    renderPanel();
  }

  /* ------------------------------ selección y panel ------------------------------ */
  function seleccionar(id) {
    seleccion = id;
    els.forEach((el, k) => el.classList.toggle('sel', k === id));
    const s = SALONES_MAPA.find(x => x.id === id);
    if (s && planta !== 'todas' && Number(planta) !== s.piso) planta = String(s.piso);
    aplicarPlanta();
    renderPanel();
  }

  function deseleccionar() {
    seleccion = null;
    els.forEach(el => el.classList.remove('sel'));
    aplicarPlanta();
    renderPanel();
  }

  const ETQ_ESTADO = {
    ocupado: ['🔴', 'Ocupado'], libre: ['🟢', 'Libre'],
    'sin-datos': ['⚪', 'Todavía no hay clases con salón asignado'], 'no-aplica': ['', '']
  };

  function renderPanel() {
    const cont = $('#m3d-panel');
    const sala = seleccion && SALONES_MAPA.find(s => s.id === seleccion);
    const m = momento();
    const cuando = `${m.dia} ${String(Math.floor(m.min / 60)).padStart(2, '0')}:${String(m.min % 60).padStart(2, '0')}`;

    if (sala) {
      const e = estadoSala(sala, m);
      const clases = clasesDe(sala).slice().sort((a, b) => DIAS.indexOf(a.dia) - DIAS.indexOf(b.dia) || aMin(a.hora_inicio) - aMin(b.hora_inicio));
      let estadoHtml = '';
      if (TIPOS[sala.tipo].clases) {
        const [ico, txt] = ETQ_ESTADO[e.estado];
        const det = e.clase ? ` · ${esc(e.clase.materia)}${e.clase.curso ? ' (' + esc(e.clase.curso) + ')' : ''}${e.clase.profesor_nombre ? ' · ' + esc(e.clase.profesor_nombre) : ''} hasta las ${esc(e.clase.hora_fin)}` : '';
        estadoHtml = `<div class="m3d-estado est-${e.estado}">${ico} <b>${esc(txt)}</b>${e.estado === 'sin-datos' ? '' : ' · ' + esc(cuando)}${det}</div>`;
      }
      cont.innerHTML = `
        <button type="button" class="btn btn-ghost m3d-volver" data-accion="volver">← Todos los salones</button>
        <h3>${esc(sala.nombre)}</h3>
        <p><span class="pill pill-ok">${PLANTAS[sala.piso]}</span> <span class="pill pill-destino">${esc(TIPOS[sala.tipo].nombre)}</span>${sala.n ? ` <span class="pill pill-destino">N.º ${sala.n} del plano</span>` : ''}</p>
        ${estadoHtml}
        ${TIPOS[sala.tipo].clases ? `<h4>Clases de la semana</h4>${clases.length
          ? `<ul class="m3d-clases">${clases.map(h => `<li><b>${esc(h.dia)}</b> ${esc(h.hora_inicio)}–${esc(h.hora_fin)}<br>${esc(h.materia)}${h.curso ? ' · ' + esc(h.curso) : ''}${h.profesor_nombre ? '<br><small class="muted">' + esc(h.profesor_nombre) + '</small>' : ''}</li>`).join('')}</ul>`
          : '<p class="muted">Este salón no tiene clases asignadas en el horario.</p>'}`
          : '<p class="muted">Espacio sin clases en el horario.</p>'}`;
      return;
    }

    const conClases = SALONES_MAPA.filter(s => TIPOS[s.tipo].clases);
    const libres = conClases.filter(s => estadoSala(s, m).estado === 'libre').length;
    const sinDatos = !haySalonesCargados();
    const conocidos = new Set(SALONES_MAPA.flatMap(nombresDe));
    const fuera = [...new Set(estado.horarios.filter(h => h.salon && !conocidos.has(norm(h.salon))).map(h => h.salon.trim()))];

    cont.innerHTML = `
      <h3>Salones</h3>
      <p class="muted">${sinDatos
        ? 'Todavía no hay clases con salón asignado, por eso no se puede saber cuáles están libres.'
        : `<b>${libres}</b> de ${conClases.length} salones y talleres libres · ${esc(cuando)}`}</p>
      ${PLANTAS.map((nombre, piso) => `
        <h4>${nombre}</h4>
        <div class="m3d-lista">${SALONES_MAPA.filter(s => s.piso === piso && !['abierto', 'entrada'].includes(s.tipo)).sort((a, b) => a.n - b.n).map(s => {
          const e = estadoSala(s, m).estado;
          const marca = !TIPOS[s.tipo].clases || e === 'sin-datos' ? '' : (e === 'ocupado' ? '🔴' : '🟢');
          return `<button type="button" class="m3d-item" data-sala="${esc(s.id)}"><span class="m3d-punto" style="--h:${TIPOS[s.tipo].h}"></span><span class="m3d-num">${s.n}</span>${esc(s.nombre)}${marca ? ` <span class="m3d-marca">${marca}</span>` : ''}</button>`;
        }).join('')}</div>`).join('')}
      ${fuera.length ? `<p class="muted m3d-fuera">Salones con clases que todavía no están en el mapa: ${fuera.slice(0, 8).map(esc).join(', ')}${fuera.length > 8 ? '…' : ''}.</p>` : ''}`;
  }

  function renderLeyenda() {
    const l = $('#m3d-leyenda');
    if (!verOcupacion && aspectoEdificio) { l.innerHTML = '<span>🏫 Aspecto del edificio real. Para distinguir salones, talleres y otros espacios por color (como en el plano), tocá “Colores por tipo”.</span>'; return; }
    l.innerHTML = verOcupacion
      ? '<span><i class="m3d-chip" style="--h:140;--s:55%"></i>Libre</span><span><i class="m3d-chip" style="--h:2;--s:72%"></i>Ocupado</span><span><i class="m3d-chip" style="--h:48;--s:6%"></i>Sin clases / sin datos</span>'
      : Object.values(TIPOS).map(t => `<span><i class="m3d-chip" style="--h:${t.h}"></i>${esc(t.nombre)}</span>`).join('');
  }

  /* ------------------------------ interacción ------------------------------ */
  function enlazar() {
    const esc3d = $('#m3d-escena');
    const punteros = new Map();
    let arrastre = false, inicio = null, distPrev = 0;
    const distancia = () => { const p = [...punteros.values()]; return p.length === 2 ? Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) : 0; };

    esc3d.addEventListener('pointerdown', (e) => {
      punteros.set(e.pointerId, { x: e.clientX, y: e.clientY });
      inicio = { x: e.clientX, y: e.clientY };
      arrastre = false;
      distPrev = distancia();
    });
    window.addEventListener('pointermove', (e) => {
      const p = punteros.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (punteros.size === 2) {                       // pellizco para acercar/alejar
        const d = distancia();
        if (distPrev) { cam.zoom *= d / distPrev; aplicarCamara(); }
        distPrev = d; arrastre = true;
        return;
      }
      if (!arrastre && Math.hypot(e.clientX - inicio.x, e.clientY - inicio.y) < 5) return;
      arrastre = true;
      cam.ry += dx * 0.45;
      cam.rx -= dy * 0.3;
      aplicarCamara();
    });
    const soltar = (e) => { punteros.delete(e.pointerId); distPrev = 0; };
    window.addEventListener('pointerup', soltar);
    window.addEventListener('pointercancel', soltar);

    esc3d.addEventListener('click', (e) => {
      if (arrastre) { arrastre = false; return; }
      const s = e.target.closest('.m3d-sala');
      if (s) seleccionar(s.dataset.id);
    });
    esc3d.addEventListener('wheel', (e) => {
      e.preventDefault();
      cam.zoom *= e.deltaY < 0 ? 1.1 : 0.9;
      aplicarCamara();
    }, { passive: false });
    esc3d.addEventListener('keydown', (e) => {
      const acciones = {
        ArrowLeft: () => { cam.ry -= 8; }, ArrowRight: () => { cam.ry += 8; },
        ArrowUp: () => { cam.rx -= 6; }, ArrowDown: () => { cam.rx += 6; },
        '+': () => { cam.zoom *= 1.12; }, '=': () => { cam.zoom *= 1.12; }, '-': () => { cam.zoom *= 0.89; },
        Escape: () => deseleccionar()
      };
      if (!acciones[e.key]) return;
      e.preventDefault(); acciones[e.key](); aplicarCamara();
    });

    $('#m3d-zoom-mas').onclick = () => { cam.zoom *= 1.2; aplicarCamara(); };
    $('#m3d-zoom-menos').onclick = () => { cam.zoom /= 1.2; aplicarCamara(); };
    $('#m3d-reset').onclick = reiniciarCamara;
    $('#m3d-estilo').onclick = () => {
      aspectoEdificio = !aspectoEdificio;
      $('#m3d-mundo').classList.toggle('vista-edificio', aspectoEdificio);
      $('#m3d-estilo').textContent = aspectoEdificio ? '🎨 Colores por tipo' : '🏫 Aspecto del edificio';
      renderLeyenda();
    };
    $('#m3d-plantas').addEventListener('click', (e) => {
      const b = e.target.closest('[data-planta]');
      if (!b) return;
      planta = b.dataset.planta;
      aplicarPlanta();
    });

    $('#m3d-panel').addEventListener('click', (e) => {
      const item = e.target.closest('[data-sala]');
      if (item) return seleccionar(item.dataset.sala);
      if (e.target.closest('[data-accion="volver"]')) deseleccionar();
    });

    // Ocupación: por defecto el día y la hora de ahora.
    const dia = $('#m3d-ocup-dia'), hora = $('#m3d-ocup-hora');
    dia.innerHTML = DIAS.map(d => `<option>${d}</option>`).join('');
    const n = new Date();
    dia.value = DIAS.includes(NOMBRE_DIA_JS[n.getDay()]) ? NOMBRE_DIA_JS[n.getDay()] : 'Lunes';
    hora.value = `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`;
    $('#m3d-ocup-on').addEventListener('change', (e) => {
      verOcupacion = e.target.checked;
      dia.disabled = hora.disabled = !verOcupacion;
      if (verOcupacion && !haySalonesCargados()) toast('Todavía no hay clases con salón asignado: no se puede mostrar la ocupación.', true);
      pintarOcupacion();
    });
    dia.addEventListener('change', pintarOcupacion);
    hora.addEventListener('input', pintarOcupacion);
  }

  function abrir() {
    if (!construido) {
      construir();
      $('#m3d-mundo').classList.toggle('vista-edificio', aspectoEdificio);
      enlazar();
      construido = true;
      reiniciarCamara();
    }
    aplicarPlanta();
    aplicarCamara();
    pintarOcupacion();
  }

  return { abrir, SALONES_MAPA, _estadoSala: estadoSala };
})();
