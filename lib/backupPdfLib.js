// Informe en PDF con el contenido de un backup (para leer o archivar; no sirve para restaurar: para eso está el archivo .db).
const { DatabaseSync } = require('node:sqlite');
const { Pdf, W, M } = require('./pdfLib');

const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const LUGAR = { amarillo: 'Liceo', azul: 'UTU', verde: 'Coordinación' };
const ordenDia = (d) => { const i = DIAS.indexOf(d); return i < 0 ? 99 : i; };
const tabla = (bk, nombre) => { try { return bk.prepare(`SELECT * FROM ${nombre}`).all(); } catch { return []; } };

function generarPdfBackup(ruta, nombreArchivo) {
  const bk = new DatabaseSync(ruta, { readOnly: true });
  let usuarios, horarios, lista, ausencias, avisos, publicado;
  try {
    usuarios = bk.prepare('SELECT id, nombre, email, rol FROM usuarios ORDER BY rol, nombre COLLATE NOCASE').all();   // sin contraseñas
    horarios = tabla(bk, 'horarios');
    lista = tabla(bk, 'lista_negra');
    ausencias = tabla(bk, 'ausencias');
    avisos = tabla(bk, 'avisos');
    // Cada curso se publica por separado: se cuenta cuántos están publicados (los backups viejos solo tienen el interruptor global).
    publicado = (() => {
      try {
        const n = bk.prepare('SELECT COUNT(*) AS n FROM cursos_horario WHERE publicado = 1').get().n;
        if (n > 0) return n;
      } catch { /* backup anterior a los horarios por curso */ }
      try { return bk.prepare("SELECT valor FROM config WHERE clave = 'horario_publicado'").get()?.valor === '1'; } catch { return false; }
    })();
  } finally { bk.close(); }

  const pdf = new Pdf(`Cuadrilla - ${nombreArchivo}`);
  const ordenar = (a, b) => ordenDia(a.dia) - ordenDia(b.dia) || a.hora_inicio.localeCompare(b.hora_inicio);

  pdf.texto('Cuadrilla - Informe de backup', { size: 20, bold: true, color: '0.1 0.18 0.35' }); pdf.y -= 22;
  pdf.linea(`Archivo: ${nombreArchivo}`);
  pdf.linea(`Informe generado: ${new Date().toLocaleString('es-UY', { timeZone: 'America/Montevideo' })}`);
  pdf.linea(`Horario publicado: ${typeof publicado === 'number' ? publicado + ' curso' + (publicado === 1 ? '' : 's') + ' publicado' + (publicado === 1 ? '' : 's') : (publicado ? 'si' : 'no (borrador)')}`);
  pdf.linea('Este PDF es para leer y archivar. Para restaurar los datos usá el archivo .db del mismo backup.', { color: '0.4 0.4 0.4', size: 9 });

  pdf.titulo1('Resumen');
  const cuenta = (r) => usuarios.filter(u => u.rol === r).length;
  for (const [k, v] of [['Administradores', cuenta('admin')], ['Profesores', cuenta('profesor')], ['Alumnos', cuenta('alumno')], ['Clases cargadas', horarios.length], ['Avisos', avisos.length], ['Ausencias registradas', ausencias.length], ['Profesores en lista negra', lista.length]]) {
    pdf.linea(`${k}: ${v}`);
  }

  pdf.titulo1('Horario general (grilla)');
  const grilla = horarios.filter(h => !String(h.origen || '').startsWith('carga-')).sort(ordenar);
  if (!grilla.length) pdf.linea('No hay clases en la grilla.', { color: '0.4 0.4 0.4' });
  const cabecera = () => pdf.fila([['Día', M, 55], ['Hora', M + 58, 70], ['Materia', M + 132, 130], ['Curso', M + 266, 50], ['Salón', M + 320, 70], ['Profesor', M + 394, 120]], { bold: true, fondo: '0.9 0.92 0.96' });
  let diaActual = null;
  for (const h of grilla) {
    if (h.dia !== diaActual) { diaActual = h.dia; pdf.espacio(50); cabecera(); }
    pdf.fila([[h.dia, M, 55], [`${h.hora_inicio}-${h.hora_fin}`, M + 58, 70], [h.materia, M + 132, 130], [h.curso || '', M + 266, 50], [h.salon || '-', M + 320, 70], [h.profesor_nombre || '(libre)', M + 394, 120]]);
  }

  pdf.titulo1('Horario de cada profesor');
  const porProfe = new Map();
  for (const h of horarios) {
    if (!h.profesor_nombre) continue;
    if (!porProfe.has(h.profesor_nombre)) porProfe.set(h.profesor_nombre, []);
    porProfe.get(h.profesor_nombre).push(h);
  }
  if (!porProfe.size) pdf.linea('Ningún profesor tiene clases.', { color: '0.4 0.4 0.4' });
  for (const [nombre, clases] of [...porProfe].sort((a, b) => a[0].localeCompare(b[0], 'es'))) {
    pdf.espacio(60);
    pdf.titulo2(`${nombre}  (${clases.length} clase${clases.length === 1 ? '' : 's'})`);
    pdf.fila([['Día', M, 55], ['Hora', M + 58, 70], ['Curso / materia', M + 132, 170], ['Lugar', M + 306, 70]], { bold: true, fondo: '0.9 0.92 0.96' });
    for (const h of clases.sort(ordenar)) pdf.fila([[h.dia, M, 55], [`${h.hora_inicio}-${h.hora_fin}`, M + 58, 70], [h.curso || h.materia, M + 132, 170], [LUGAR[h.color] || '-', M + 306, 70]]);
  }

  pdf.titulo1('Usuarios');
  pdf.fila([['Nombre', M, 190], ['Correo', M + 195, 220], ['Rol', M + 420, 80]], { bold: true, fondo: '0.9 0.92 0.96' });
  for (const u of usuarios) pdf.fila([[u.nombre, M, 190], [u.email, M + 195, 220], [u.rol, M + 420, 80]]);

  if (lista.length) {
    pdf.titulo1('Lista negra');
    for (const l of lista) pdf.linea(`${l.profesor_nombre} - desde ${String(l.fecha_ingreso).slice(0, 10)} - ${l.motivo}`);
  }
  return pdf.buffer();
}

module.exports = { generarPdfBackup };
