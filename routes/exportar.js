// Descarga del horario en Excel (.xlsx). El PDF se genera en el navegador (imprimir → "Guardar como PDF").
//  - admin:    ?alcance=todo | curso&curso=7°3 | profesor&id=7 (o &nombre=…)
//  - profesor: ?alcance=mio (solo su horario; no depende de la publicación)
//  - alumno:   ?alcance=todo | curso&curso=7°3 (solo cuando el admin lo publicó; sin los horarios personales de los profesores)
const express = require('express');
const db = require('../db/database');
const { requireRole } = require('../middleware/auth');
const lib = require('../lib/horariosLib');
const { crearXlsx } = require('../lib/xlsxLib');

const router = express.Router();
const LUGAR = { amarillo: 'Liceo', azul: 'UTU', verde: 'Coordinación' };

function hojaLista(clases) {
  const filas = [['Día', 'Desde', 'Hasta', 'Curso', 'Materia', 'Profesor', 'Salón', 'Lugar']];
  for (const h of clases) filas.push([h.dia, h.hora_inicio, h.hora_fin, h.curso || '', h.materia, h.profesor_nombre || 'Sin profesor', h.salon || '', LUGAR[h.color] || '']);
  return { nombre: 'Lista', filas, anchos: [12, 8, 8, 12, 28, 26, 14, 14] };
}

// Grilla: una fila por franja horaria, una columna por día.
function hojaGrilla(clases, nombre, texto) {
  const dias = lib.DIAS.slice(0, clases.some(h => h.dia === 'Sábado') ? 6 : 5);
  const franjas = [...new Map(clases.map(h => [`${h.hora_inicio}–${h.hora_fin}`, h])).values()]
    .sort((a, b) => lib.aMinutos(a.hora_inicio) - lib.aMinutos(b.hora_inicio) || lib.aMinutos(a.hora_fin) - lib.aMinutos(b.hora_fin))
    .map(h => [h.hora_inicio, h.hora_fin]);
  const filas = [['Horario', ...dias]];
  for (const [ini, fin] of franjas) {
    filas.push([`${ini} – ${fin}`, ...dias.map(d => clases.filter(h => h.dia === d && h.hora_inicio === ini && h.hora_fin === fin).map(texto).join('\n'))]);
  }
  return { nombre, filas, anchos: [14, ...dias.map(() => 26)], primeraColNegrita: true };
}

const conCurso = (h) => `${h.materia}${h.profesor_nombre ? ' · ' + h.profesor_nombre : ''}${h.salon ? ' · ' + h.salon : ''}`;
const conProfesor = (h) => `${h.curso && h.curso !== h.materia ? h.curso + ' · ' : ''}${h.materia}${h.salon ? ' · ' + h.salon : ''}${h.color ? ' (' + LUGAR[h.color] + ')' : ''}`;
const slug = (t) => lib.normalizar(t).replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') || 'horario';

router.get('/excel', requireRole('admin', 'profesor', 'alumno'), (req, res) => {
  const { rol, id } = req.session.user;
  const alcance = String(req.query.alcance || (rol === 'admin' ? 'todo' : 'mio'));
  lib.vincularBloquesPorNombre();
  let hojas, archivo;
  // Lo que ve cada rol en la grilla general: el alumno no recibe los horarios personales de los profesores (origen "carga-…").
  // El alumno solo recibe los cursos que la administración ya publicó (cada curso se publica por separado).
  const grilla = () => lib.horariosOrdenados().filter(h => rol !== 'alumno' || lib.claseVisibleParaAlumno(h));

  if (rol === 'alumno') {
    if (!['todo', 'curso'].includes(alcance)) return res.status(403).json({ error: 'Los alumnos solo pueden descargar el horario general o el de un curso.' });
    if (!lib.listaCursos().some(c => c.publicado)) return res.status(403).json({ error: 'El horario todavía no fue publicado por la administración.' });
    if (alcance === 'curso' && !lib.cursoPublicado(String(req.query.curso || ''))) return res.status(403).json({ error: 'El horario de ese curso todavía no fue publicado por la administración.' });
  }

  if (rol === 'profesor') {
    if (alcance !== 'mio') return res.status(403).json({ error: 'Los profesores solo pueden descargar su propio horario.' });
    const mias = lib.clasesDeProfesor({ id });
    if (!mias.length) return res.status(404).json({ error: 'Todavía no tenés clases asignadas.' });
    hojas = [hojaGrilla(mias, 'Mi horario', conProfesor), hojaLista(mias)];
    archivo = `mi-horario-${slug(req.session.user.nombre)}`;
  } else if (alcance === 'curso') {
    const curso = String(req.query.curso || '').trim();
    const clases = grilla().filter(h => h.curso && lib.normalizar(h.curso) === lib.normalizar(curso));
    if (!curso || !clases.length) return res.status(404).json({ error: 'No hay clases para ese curso.' });
    hojas = [hojaGrilla(clases, `Curso ${curso}`, conCurso), hojaLista(clases)];
    archivo = `horario-curso-${slug(curso)}`;
  } else if (alcance === 'profesor') {
    const pid = Number(req.query.id) || null;
    let nombre = String(req.query.nombre || '').trim();
    if (pid) {
      const p = db.prepare("SELECT nombre FROM usuarios WHERE id = ? AND rol = 'profesor'").get(pid);
      if (!p) return res.status(404).json({ error: 'Profesor no encontrado.' });
      nombre = p.nombre;
    } else if (!nombre || !lib.nombreDePlantilla(nombre)) return res.status(400).json({ error: 'Indicá un profesor válido.' });
    const clases = lib.clasesDeProfesor({ id: pid, nombre });
    if (!clases.length) return res.status(404).json({ error: `${nombre} todavía no tiene clases asignadas.` });
    hojas = [hojaGrilla(clases, nombre, conProfesor), hojaLista(clases)];
    archivo = `horario-${slug(nombre)}`;
  } else if (alcance === 'todo') {
    const clases = grilla();
    if (!clases.length) return res.status(404).json({ error: 'No hay clases cargadas.' });
    hojas = [hojaLista(clases)];
    archivo = 'horario-completo';
  } else {
    return res.status(400).json({ error: 'Alcance no válido.' });
  }

  res.set({
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="${archivo}.xlsx"`,
    'Cache-Control': 'no-store'
  });
  res.send(crearXlsx(hojas));
});

module.exports = router;
