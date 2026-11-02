const express = require('express');
const db = require('../db/database');
const { getConfig, setConfig } = db;
const { requireAuth, requireRole } = require('../middleware/auth');
const lib = require('../lib/horariosLib');
const historial = require('../lib/historialLib');
const entrega = require('../lib/entregaHorarioLib');
const choques = require('../lib/choquesLib');

const router = express.Router();

// Lugar de la clase (color): amarillo = liceo, azul = UTU, verde = coordinación, '' = sin especificar.
function leerColor(body) {
  if (body.color === undefined) return { cambia: false };
  if (body.color === null || body.color === '') return { cambia: true, color: null };
  if (!lib.COLORES_VALIDOS.includes(body.color)) return { error: 'Lugar no válido (liceo, UTU o coordinación).' };
  return { cambia: true, color: body.color };
}
// Avisos (no bloquean) de traslado que afectan a esta clase.
function avisosTraslado(h) {
  if (!h.profesor_id && !h.profesor_nombre) return [];
  const clases = lib.clasesDeProfesor({ id: h.profesor_id, nombre: h.profesor_nombre });
  return lib.problemasTraslado(clases).filter(p => p.ids.includes(h.id)).map(p => p.texto);
}

// Avisos (no bloquean) de choque con lo que el profesor entregó: dos lugares a la vez, hora distinta o clase que falta.
function avisosChoque(h) {
  if (!h.profesor_id && !h.profesor_nombre) return [];
  return choques.choquesDe(choques.claveDe(h)).filter(c => c.ids.includes(h.id)).map(c => c.texto);
}

// Curso al que pertenece el horario (7°3, 3°CAD…): el admin siempre debe indicarlo.
function leerCurso(body, actual = null) {
  const crudo = body.curso !== undefined ? body.curso : (actual ? actual.curso : '');
  const curso = String(crudo || '').trim();
  if (!curso) return { error: 'Indicá para qué curso es el horario.' };
  if (curso.length > 40) return { error: 'El curso es demasiado largo (máximo 40 caracteres).' };
  return { curso };
}

// Resuelve el profesor elegido por el admin a { profesor_id, profesor_nombre, estado }.
//  - profesor_id: una cuenta de profesor
//  - profesor_nombre: alguien de la plantilla que todavía no tiene cuenta (la clase queda a su nombre
//    y se le vincula sola cuando se registre)
function resolverProfesor(profesor_id, profesor_nombre) {
  if (profesor_id === undefined && profesor_nombre === undefined) return { cambia: false };
  if (profesor_id === undefined) {
    const cuenta = lib.buscarProfesorPorNombre(profesor_nombre);
    if (cuenta) return { cambia: true, profesor_id: cuenta.id, profesor_nombre: cuenta.nombre, estado: 'ocupado' };
    const nombre = lib.nombreDePlantilla(profesor_nombre);
    if (!nombre) return { error: 'El profesor elegido no existe.' };
    return { cambia: true, profesor_id: null, profesor_nombre: nombre, estado: 'ocupado' };
  }
  if (profesor_id === null || profesor_id === '') {
    return { cambia: true, profesor_id: null, profesor_nombre: null, estado: 'disponible' };
  }
  const p = db.prepare("SELECT id, nombre FROM usuarios WHERE id = ? AND rol = 'profesor'").get(profesor_id);
  if (!p) return { error: 'El profesor elegido no existe.' };
  return { cambia: true, profesor_id: p.id, profesor_nombre: p.nombre, estado: 'ocupado' };
}

// GET /api/horarios
//  - el admin ve siempre todo (los cursos en borrador incluidos)
//  - profesores y alumnos solo ven los cursos que el admin publicó, cada uno por separado
router.get('/', requireAuth, (req, res) => {
  const { rol } = req.session.user;
  // Asigna a las cuentas de profesores las clases cargadas solo con su nombre (así "Mi horario" siempre está al día).
  lib.vincularBloquesPorNombre();
  // Los horarios personales de los profesores (origen "carga-…") no son parte del horario de los alumnos.
  // El profesor nunca espera al admin: siempre ve sus propias clases (planilla, entregadas o asignadas),
  // aunque el horario de un curso siga en borrador.
  const todas = db.prepare('SELECT * FROM horarios ORDER BY hora_inicio, dia').all();
  let horarios;
  if (rol === 'admin') horarios = todas;
  else if (rol === 'profesor') horarios = todas.filter(h => h.profesor_id === req.session.user.id || lib.claseVisibleParaAlumno(h));
  else horarios = todas.filter(lib.claseVisibleParaAlumno);
  const cursos = lib.listaCursos().filter(c => rol === 'admin' || c.publicado);
  const publicado = cursos.some(c => c.publicado);
  res.json({ horarios, cursos, publicado, publicado_en: getConfig('horario_publicado_en') });
});

// GET /api/horarios/mios - horario personal del profesor logueado
router.get('/mios', requireRole('profesor'), (req, res) => {
  lib.vincularBloquesPorNombre(req.session.user);
  // El profesor ve siempre su horario: no depende de que el admin publique la grilla de los alumnos.
  const horarios = db.prepare('SELECT * FROM horarios WHERE profesor_id = ? ORDER BY hora_inicio').all(req.session.user.id);
  res.json({ horarios, publicado: lib.listaCursos().some(c => c.publicado) });
});

// GET /api/horarios/entrega - entrega obligatoria del horario semanal
//  - profesor: si ya entregó el suyo
//  - admin: quién entregó y quién falta
router.get('/entrega', requireRole('profesor', 'admin'), (req, res) => {
  const u = req.session.user;
  res.json(u.rol === 'admin' ? entrega.resumenAdmin() : entrega.estadoEntrega(u.id));
});

// GET /api/horarios/entrega/foto/:id - la foto del horario que subió (o subieron por) un profesor.
// La ve el admin y el propio profesor; es una imagen validada al subirla (jpeg/png/webp).
router.get('/entrega/foto/:id', requireRole('profesor', 'admin'), (req, res) => {
  const id = Number(req.params.id);
  const u = req.session.user;
  if (!Number.isInteger(id) || (u.rol !== 'admin' && u.id !== id)) return res.status(403).json({ error: 'No podés ver esa foto.' });
  const f = entrega.fotoDe(id);
  const m = f && /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(f.imagen);
  if (!m) return res.status(404).json({ error: 'No hay foto.' });
  res.set({ 'Content-Type': m[1], 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' });
  res.send(Buffer.from(m[2], 'base64'));
});

// POST /api/horarios/entrega/recordar - el admin avisa a quienes todavía no entregaron
router.post('/entrega/recordar', requireRole('admin'), (req, res) => {
  const faltan = entrega.resumenAdmin().profesores.filter(p => !p.entregado);
  const ins = db.prepare(`INSERT INTO mensajes (remitente_id, remitente_nombre, destinatario_id, destinatario_nombre, contenido, tipo)
                          VALUES (NULL, 'Sistema Cuadrilla', ?, ?, ?, 'sistema')`);
  for (const p of faltan) ins.run(p.id, p.nombre, 'Recordatorio: tenés que entregar tu horario semanal (es obligatorio). Escribile **entregar mi horario** al Asistente.');
  historial.registrar(req.session.user, 'entrega', `Recordó la entrega del horario a ${faltan.length} profesor${faltan.length === 1 ? '' : 'es'}`);
  res.json({ avisados: faltan.length });
});

// GET /api/horarios/profesores - para el selector del admin
router.get('/profesores', requireRole('admin'), (req, res) => {
  res.json({ profesores: lib.profesoresParaSelector() });
});

// GET /api/horarios/profesor?id=7  |  ?nombre=Mauro%20Ipar - el admin ve el horario de cualquier profesor
router.get('/profesor', requireRole('admin'), (req, res) => {
  const id = Number(req.query.id) || null;
  let nombre = String(req.query.nombre || '').trim() || null;
  if (id) {
    const p = db.prepare("SELECT id, nombre FROM usuarios WHERE id = ? AND rol = 'profesor'").get(id);
    if (!p) return res.status(404).json({ error: 'Profesor no encontrado.' });
    nombre = p.nombre;
  } else if (!nombre || !lib.nombreDePlantilla(nombre)) {
    return res.status(400).json({ error: 'Indicá un profesor válido.' });
  }
  lib.vincularBloquesPorNombre();
  res.json({ profesor: nombre, horarios: lib.clasesDeProfesor({ id, nombre }), publicado: lib.listaCursos().some(c => c.publicado) });
});

// GET /api/horarios/salones - lista de salones (admin). Con ?dia=Lunes&hora=09:00 indica cuáles están libres a esa hora.
router.get('/salones', requireRole('admin'), (req, res) => {
  const { dia, hora } = req.query;
  if (dia === undefined && hora === undefined) return res.json({ salones: lib.listaSalones() });
  const d = lib.normalizarDia(dia), h = lib.normalizarHora(hora);
  if (!d || !h) return res.status(400).json({ error: 'Indicá un día y una hora válidos (HH:MM).' });
  res.json({ dia: d, hora: h, salones: lib.estadoSalones(d, h) });
});

// GET /api/horarios/traslados - clases seguidas en liceo y UTU con poco margen (admin)
router.get('/traslados', requireRole('admin'), (req, res) => {
  lib.vincularBloquesPorNombre();
  res.json({ traslados: lib.traslados(), minimo: Number(process.env.TRASLADO_MINUTOS) || 30 });
});

// GET /api/horarios/choques - lo que entregó cada profesor contra la grilla del admin (admin)
router.get('/choques', requireRole('admin'), (req, res) => {
  res.json(choques.detectarChoques());
});

// GET /api/horarios/cursos - los cursos con horario propio y si cada uno está publicado (admin)
router.get('/cursos', requireRole('admin'), (req, res) => {
  res.json({ cursos: lib.listaCursos() });
});

// POST /api/horarios/cursos { curso } - el admin abre el horario de un curso nuevo (queda en borrador)
router.post('/cursos', requireRole('admin'), (req, res) => {
  const cur = leerCurso({ curso: req.body && req.body.curso });
  if (cur.error) return res.status(400).json({ error: cur.error.replace('para qué curso es el horario', 'el nombre del curso') });
  if (lib.listaCursos().some(c => lib.normalizar(c.curso) === lib.normalizar(cur.curso)))
    return res.status(409).json({ error: `Ya existe el horario del curso ${cur.curso}.` });
  lib.asegurarCurso(cur.curso);
  lib.fijarPublicacionCurso(cur.curso, false);
  historial.registrar(req.session.user, 'crear', `Abrió el horario del curso ${cur.curso}`);
  res.status(201).json({ cursos: lib.listaCursos() });
});

// DELETE /api/horarios/cursos/:curso - quita un curso vacío (sin clases)
router.delete('/cursos/:curso', requireRole('admin'), (req, res) => {
  const curso = lib.limpiarCurso(req.params.curso);
  const n = db.prepare('SELECT COUNT(*) AS n FROM horarios WHERE curso = ? COLLATE NOCASE').get(curso).n;
  if (n > 0) return res.status(409).json({ error: `El curso ${curso} todavía tiene ${n} clase${n === 1 ? '' : 's'}: eliminalas primero.` });
  db.prepare('DELETE FROM cursos_horario WHERE curso = ?').run(curso);
  res.json({ cursos: lib.listaCursos() });
});

// POST /api/horarios/publicar { curso, publicado: true|false } - publica o vuelve a borrador UN curso
router.post('/publicar', requireRole('admin'), (req, res) => {
  const cur = leerCurso({ curso: req.body && req.body.curso });
  if (cur.error) return res.status(400).json({ error: 'Indicá qué curso querés publicar.' });
  const curso = cur.curso;
  const quiere = req.body && req.body.publicado === true;
  const existe = lib.listaCursos().some(c => lib.normalizar(c.curso) === lib.normalizar(curso));
  if (!existe) return res.status(404).json({ error: `No existe el horario del curso ${curso}.` });
  const clasesCurso = db.prepare("SELECT * FROM horarios WHERE curso = ? COLLATE NOCASE AND origen NOT LIKE 'carga-%'").all(curso);
  if (quiere && clasesCurso.length === 0) return res.status(400).json({ error: `El curso ${curso} todavía no tiene clases para publicar.` });
  lib.fijarPublicacionCurso(curso, quiere);
  let avisados = 0;
  if (quiere) {
    setConfig('horario_publicado_en', new Date().toISOString());
    lib.vincularBloquesPorNombre();
    // Cada profesor con clases en ESTE curso recibe un aviso y las ve en "Mi horario".
    const ins = db.prepare(`INSERT INTO mensajes (remitente_id, remitente_nombre, destinatario_id, destinatario_nombre, contenido, tipo)
                            VALUES (NULL, 'Sistema Cuadrilla', ?, ?, ?, 'sistema')`);
    const conteo = new Map();
    for (const h of db.prepare("SELECT profesor_id FROM horarios WHERE curso = ? COLLATE NOCASE AND origen NOT LIKE 'carga-%' AND profesor_id IS NOT NULL").all(curso))
      conteo.set(h.profesor_id, (conteo.get(h.profesor_id) || 0) + 1);
    for (const [pid, n] of conteo) {
      const u = db.prepare('SELECT nombre FROM usuarios WHERE id = ?').get(pid);
      if (!u) continue;
      ins.run(pid, u.nombre, `Se publicó el horario de ${curso}: ya podés ver tus ${n} clase${n === 1 ? '' : 's'} de ese curso en "Mi horario".`);
      avisados++;
    }
  }
  historial.registrar(req.session.user, 'publicar', quiere ? `Publicó el horario de ${curso} (avisó a ${avisados} profesor${avisados === 1 ? '' : 'es'})` : `Volvió a borrador el horario de ${curso}`);
  const sinProfesor = clasesCurso.filter(h => !h.profesor_id && !h.profesor_nombre).length;
  res.json({ curso, publicado: quiere, publicado_en: getConfig('horario_publicado_en'), profesores_avisados: avisados, sin_profesor: sinProfesor, cursos: lib.listaCursos() });
});

// POST /api/horarios - admin crea un bloque
router.post('/', requireRole('admin'), (req, res) => {
  const v = lib.validarBloque(req.body || {});
  if (v.error) return res.status(400).json({ error: v.error });
  const prof = resolverProfesor(req.body.profesor_id, req.body.profesor_nombre);
  if (prof.error) return res.status(400).json({ error: prof.error });
  const col = leerColor(req.body);
  if (col.error) return res.status(400).json({ error: col.error });
  const cur = leerCurso(req.body);
  if (cur.error) return res.status(400).json({ error: cur.error });

  // Cada curso tiene su propio horario: la clase queda en el borrador de SU curso (un curso sin publicar es borrador).
  const b = { ...v.bloque, profesor_id: prof.profesor_id ?? null, profesor_nombre: prof.profesor_nombre ?? null };
  const choque = lib.buscarConflicto(b);
  if (choque) return res.status(409).json({ error: choque });

  const info = db.prepare(`
    INSERT INTO horarios (dia, hora_inicio, hora_fin, materia, salon, estado, profesor_id, profesor_nombre, creado_por, color, curso)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(b.dia, b.hora_inicio, b.hora_fin, b.materia, b.salon,
         prof.estado || 'disponible', prof.profesor_id ?? null, prof.profesor_nombre ?? null, req.session.user.id, col.color ?? null, cur.curso);
  const creado = db.prepare('SELECT * FROM horarios WHERE id = ?').get(info.lastInsertRowid);
  lib.avisarCambioClase(null, creado);
  historial.registrar(req.session.user, 'crear', `Creó ${historial.resumenClase(creado)}`);
  res.status(201).json({ horario: creado, avisos: [...avisosTraslado(creado), ...avisosChoque(creado)] });
});

// PUT /api/horarios/:id - admin edita un bloque (incluye asignar/quitar profesor)
router.put('/:id', requireRole('admin'), (req, res) => {
  const actual = db.prepare('SELECT * FROM horarios WHERE id = ?').get(req.params.id);
  if (!actual) return res.status(404).json({ error: 'Horario no encontrado.' });

  const v = lib.validarBloque({ ...actual, ...req.body });
  if (v.error) return res.status(400).json({ error: v.error });
  const prof = resolverProfesor(req.body.profesor_id, req.body.profesor_nombre);
  if (prof.error) return res.status(400).json({ error: prof.error });
  const col = leerColor(req.body);
  if (col.error) return res.status(400).json({ error: col.error });
  const cur = leerCurso(req.body, actual);
  if (cur.error) return res.status(400).json({ error: cur.error });
  // Los horarios de cada curso van separados: una clase no se pasa a otro curso (se elimina y se crea en el otro).
  if (actual.curso && lib.normalizar(cur.curso) !== lib.normalizar(actual.curso))
    return res.status(400).json({ error: `Esta clase es del curso ${actual.curso}. Para ponerla en ${cur.curso}, eliminala y creala en el horario de ese curso.` });

  const nuevo = {
    ...v.bloque,
    profesor_id: prof.cambia ? prof.profesor_id : actual.profesor_id,
    profesor_nombre: prof.cambia ? prof.profesor_nombre : actual.profesor_nombre,
    estado: prof.cambia ? prof.estado : actual.estado
  };
  const choque = lib.buscarConflicto(nuevo, actual.id);
  if (choque) return res.status(409).json({ error: choque });

  db.prepare(`UPDATE horarios SET dia=?, hora_inicio=?, hora_fin=?, materia=?, salon=?,
              profesor_id=?, profesor_nombre=?, estado=?, color=?, curso=? WHERE id=?`)
    .run(nuevo.dia, nuevo.hora_inicio, nuevo.hora_fin, nuevo.materia, nuevo.salon,
         nuevo.profesor_id, nuevo.profesor_nombre, nuevo.estado, col.cambia ? col.color : actual.color, actual.curso || cur.curso, actual.id);
  const editado = db.prepare('SELECT * FROM horarios WHERE id = ?').get(actual.id);
  lib.avisarCambioClase(actual, editado);
  const resumen = historial.resumenEdicion(actual, editado);
  if (resumen) historial.registrar(req.session.user, 'editar', resumen);
  res.json({ horario: editado, avisos: [...avisosTraslado(editado), ...avisosChoque(editado)] });
});

router.delete('/:id', requireRole('admin'), (req, res) => {
  const previa = db.prepare('SELECT * FROM horarios WHERE id = ?').get(req.params.id);
  const info = db.prepare('DELETE FROM horarios WHERE id = ?').run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'Horario no encontrado.' });
  lib.avisarCambioClase(previa, null);
  if (previa) historial.registrar(req.session.user, 'borrar', `Eliminó ${historial.resumenClase(previa)}`);
  res.json({ mensaje: 'Horario eliminado correctamente.' });
});

// Un profesor toma un bloque libre
router.post('/:id/reclamar', requireRole('profesor'), (req, res) => {
  if (!entrega.yaEntrego(req.session.user.id)) return res.status(403).json({ error: 'Primero tenés que entregar tu horario semanal (es obligatorio): escribile "entregar mi horario" al Asistente.', codigo: 'horario_pendiente' });
  const h = db.prepare('SELECT * FROM horarios WHERE id = ?').get(req.params.id);
  if (!h) return res.status(404).json({ error: 'Horario no encontrado.' });
  if (h.estado !== 'disponible') return res.status(409).json({ error: 'Este horario ya está ocupado.' });
  const choque = lib.buscarConflicto({ ...h, profesor_id: req.session.user.id }, h.id);
  if (choque) return res.status(409).json({ error: choque });
  db.prepare("UPDATE horarios SET estado='ocupado', profesor_id=?, profesor_nombre=? WHERE id=?")
    .run(req.session.user.id, req.session.user.nombre, h.id);
  historial.registrar(req.session.user, 'tomar', `Tomó ${historial.resumenClase(h)}`.replace('sin profesor', req.session.user.nombre));
  res.json({ horario: db.prepare('SELECT * FROM horarios WHERE id = ?').get(h.id) });
});

// Libera el profesor asignado (el propio profesor o un admin)
router.post('/:id/liberar', requireRole('profesor', 'admin'), (req, res) => {
  const h = db.prepare('SELECT * FROM horarios WHERE id = ?').get(req.params.id);
  if (!h) return res.status(404).json({ error: 'Horario no encontrado.' });
  const { id, rol } = req.session.user;
  if (rol !== 'admin' && h.profesor_id !== id) {
    return res.status(403).json({ error: 'Solo el profesor asignado o un admin pueden liberar este horario.' });
  }
  db.prepare("UPDATE horarios SET estado='disponible', profesor_id=NULL, profesor_nombre=NULL WHERE id=?").run(h.id);
  const liberado = db.prepare('SELECT * FROM horarios WHERE id = ?').get(h.id);
  historial.registrar(req.session.user, 'liberar', `Liberó ${historial.resumenClase(h)}`);
  if (rol === 'admin') lib.avisarCambioClase(h, liberado);   // si lo libera el propio profesor no hace falta avisarle
  res.json({ horario: liberado });
});

module.exports = router;
