const express = require('express');
const db = require('../db/database');
const { getConfig, setConfig } = db;
const { requireAuth, requireRole } = require('../middleware/auth');
const lib = require('../lib/horariosLib');
const historial = require('../lib/historialLib');

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

const publicado = () => getConfig('horario_publicado', '0') === '1';

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
//  - el admin ve siempre la grilla completa (borrador incluido)
//  - profesores y alumnos solo la ven cuando el admin la publicó
router.get('/', requireAuth, (req, res) => {
  const { rol } = req.session.user;
  // Asigna a las cuentas de profesores las clases cargadas solo con su nombre (así "Mi horario" siempre está al día).
  lib.vincularBloquesPorNombre();
  const pub = publicado();
  const puedeVer = rol === 'admin' || pub;
  // Los horarios personales de los profesores (origen "carga-…") no son parte del horario de los alumnos.
  const horarios = puedeVer
    ? db.prepare('SELECT * FROM horarios ORDER BY hora_inicio, dia').all()
        .filter(h => rol !== 'alumno' || !String(h.origen || '').startsWith('carga-'))
    : [];
  res.json({ horarios, publicado: pub, publicado_en: getConfig('horario_publicado_en') });
});

// GET /api/horarios/mios - horario personal del profesor logueado
router.get('/mios', requireRole('profesor'), (req, res) => {
  lib.vincularBloquesPorNombre(req.session.user);
  // Hasta que el admin publica, el profesor no ve su horario (puede seguir cambiando).
  const horarios = publicado()
    ? db.prepare('SELECT * FROM horarios WHERE profesor_id = ? ORDER BY hora_inicio').all(req.session.user.id)
    : [];
  res.json({ horarios, publicado: publicado() });
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
  res.json({ profesor: nombre, horarios: lib.clasesDeProfesor({ id, nombre }), publicado: publicado() });
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

// POST /api/horarios/publicar { publicado: true|false }
router.post('/publicar', requireRole('admin'), (req, res) => {
  const quiere = req.body && req.body.publicado === true;
  if (quiere) {
    const total = db.prepare('SELECT COUNT(*) AS n FROM horarios').get().n;
    if (total === 0) return res.status(400).json({ error: 'No hay clases cargadas para publicar.' });
  }
  setConfig('horario_publicado', quiere ? '1' : '0');
  let avisados = 0;
  if (quiere) {
    setConfig('horario_publicado_en', new Date().toISOString());
    lib.vincularBloquesPorNombre();
    // Cada profesor con clases recibe un aviso y ve su propio horario en "Mi horario".
    const ins = db.prepare(`INSERT INTO mensajes (remitente_id, remitente_nombre, destinatario_id, destinatario_nombre, contenido, tipo)
                            VALUES (NULL, 'Sistema Cuadrilla', ?, ?, ?, 'sistema')`);
    const conClases = db.prepare(`SELECT profesor_id AS id, COUNT(*) AS n FROM horarios WHERE profesor_id IS NOT NULL GROUP BY profesor_id`).all();
    for (const c of conClases) {
      const u = db.prepare('SELECT nombre FROM usuarios WHERE id = ?').get(c.id);
      if (!u) continue;
      ins.run(c.id, u.nombre, `Se publicó el horario: ya podés ver tus ${c.n} clase${c.n === 1 ? '' : 's'} en "Mi horario".`);
      avisados++;
    }
  }
  historial.registrar(req.session.user, 'publicar', quiere ? `Publicó el horario (avisó a ${avisados} profesor${avisados === 1 ? '' : 'es'})` : 'Volvió el horario a borrador');
  const sinProfesor = db.prepare("SELECT COUNT(*) AS n FROM horarios WHERE profesor_id IS NULL AND profesor_nombre IS NULL").get().n;
  res.json({ publicado: quiere, publicado_en: getConfig('horario_publicado_en'), profesores_avisados: avisados, sin_profesor: sinProfesor });
});

// POST /api/horarios - admin crea un bloque
router.post('/', requireRole('admin'), (req, res) => {
  const v = lib.validarBloque(req.body || {});
  if (v.error) return res.status(400).json({ error: v.error });
  const prof = resolverProfesor(req.body.profesor_id, req.body.profesor_nombre);
  if (prof.error) return res.status(400).json({ error: prof.error });
  const col = leerColor(req.body);
  if (col.error) return res.status(400).json({ error: col.error });

  const b = { ...v.bloque, profesor_id: prof.profesor_id ?? null, profesor_nombre: prof.profesor_nombre ?? null };
  const choque = lib.buscarConflicto(b);
  if (choque) return res.status(409).json({ error: choque });

  const info = db.prepare(`
    INSERT INTO horarios (dia, hora_inicio, hora_fin, materia, salon, estado, profesor_id, profesor_nombre, creado_por, color)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(b.dia, b.hora_inicio, b.hora_fin, b.materia, b.salon,
         prof.estado || 'disponible', prof.profesor_id ?? null, prof.profesor_nombre ?? null, req.session.user.id, col.color ?? null);
  const creado = db.prepare('SELECT * FROM horarios WHERE id = ?').get(info.lastInsertRowid);
  lib.avisarCambioClase(null, creado);
  historial.registrar(req.session.user, 'crear', `Creó ${historial.resumenClase(creado)}`);
  res.status(201).json({ horario: creado, avisos: avisosTraslado(creado) });
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

  const nuevo = {
    ...v.bloque,
    profesor_id: prof.cambia ? prof.profesor_id : actual.profesor_id,
    profesor_nombre: prof.cambia ? prof.profesor_nombre : actual.profesor_nombre,
    estado: prof.cambia ? prof.estado : actual.estado
  };
  const choque = lib.buscarConflicto(nuevo, actual.id);
  if (choque) return res.status(409).json({ error: choque });

  db.prepare(`UPDATE horarios SET dia=?, hora_inicio=?, hora_fin=?, materia=?, salon=?,
              profesor_id=?, profesor_nombre=?, estado=?, color=? WHERE id=?`)
    .run(nuevo.dia, nuevo.hora_inicio, nuevo.hora_fin, nuevo.materia, nuevo.salon,
         nuevo.profesor_id, nuevo.profesor_nombre, nuevo.estado, col.cambia ? col.color : actual.color, actual.id);
  const editado = db.prepare('SELECT * FROM horarios WHERE id = ?').get(actual.id);
  lib.avisarCambioClase(actual, editado);
  const resumen = historial.resumenEdicion(actual, editado);
  if (resumen) historial.registrar(req.session.user, 'editar', resumen);
  res.json({ horario: editado, avisos: avisosTraslado(editado) });
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
