// Generador mínimo de PDF (solo texto, Helvetica, A4 vertical) sin librerías externas.
const W = 595, H = 842, M = 40;

// Helvetica (WinAnsi): los acentos y la ñ salen bien; lo que no entra en Latin-1 (emojis) se cambia por "?".
const latin1 = (t) => Buffer.from(String(t ?? '').replace(/[–—]/g, '-').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[^\x20-\xff]/g, '?'), 'latin1');
const esc = (t) => latin1(t).toString('latin1').replace(/[\\()]/g, '\\$&');
// Ancho aproximado de Helvetica (0.5 em por carácter, un poco más para mayúsculas) para recortar texto largo.
const ancho = (t, size) => String(t).length * size * 0.52;
const recortar = (t, max, size) => { t = String(t ?? ''); while (t.length > 1 && ancho(t, size) > max) t = t.slice(0, -1); return t; };

class Pdf {
  constructor(titulo) { this.paginas = []; this.titulo = titulo; this.y = 0; this.nueva(); }
  nueva() { this.paginas.push([]); this.y = H - M; }
  _op(s) { this.paginas[this.paginas.length - 1].push(s); }
  espacio(alto) { if (this.y - alto < M + 14) this.nueva(); }
  texto(t, { size = 10, bold = false, x = M, color = '0 0 0', max = W - M - x } = {}) {
    this._op(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${color} rg ${x} ${this.y.toFixed(1)} Td (${esc(recortar(t, max, size))}) Tj ET`);
  }
  linea(t, o = {}) { const size = o.size || 10; this.espacio(size + 6); this.texto(t, o); this.y -= size + 5; }
  titulo1(t) { this.espacio(40); this.y -= 6; this.texto(t, { size: 15, bold: true, color: '0.1 0.18 0.35' }); this.y -= 8; this._op(`0.1 0.18 0.35 RG 1 w ${M} ${this.y} m ${W - M} ${this.y} l S`); this.y -= 14; }
  titulo2(t) { this.espacio(30); this.y -= 4; this.texto(t, { size: 11.5, bold: true }); this.y -= 15; }
  // Fila de tabla: cols = [[texto, x, ancho]]
  fila(cols, { bold = false, fondo = null } = {}) {
    this.espacio(16);
    if (fondo) this._op(`${fondo} rg ${M - 3} ${(this.y - 4).toFixed(1)} ${W - 2 * M + 6} 14 re f`);
    for (const [t, x, w] of cols) this.texto(t, { size: 9, bold, x, max: w });
    this.y -= 14;
  }
  buffer() {
    const objs = [];                       // cada objeto es un Buffer
    const add = (b) => { objs.push(Buffer.isBuffer(b) ? b : Buffer.from(b, 'latin1')); return objs.length; };
    const cat = add(''), pages = add(''), f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'), f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const kids = [];
    const total = this.paginas.length;
    this.paginas.forEach((ops, i) => {
      const pie = `BT /F1 8 Tf 0.5 0.5 0.5 rg ${M} 22 Td (${esc(this.titulo)}) Tj ET BT /F1 8 Tf 0.5 0.5 0.5 rg ${W - M - 60} 22 Td (${esc(`Pagina ${i + 1} de ${total}`)}) Tj ET`;
      const cont = Buffer.from([...ops, pie].join('\n'), 'latin1');
      const c = add(Buffer.concat([Buffer.from(`<< /Length ${cont.length} >>\nstream\n`, 'latin1'), cont, Buffer.from('\nendstream', 'latin1')]));
      kids.push(add(`<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${c} 0 R >>`));
    });
    objs[cat - 1] = Buffer.from(`<< /Type /Catalog /Pages ${pages} 0 R >>`, 'latin1');
    objs[pages - 1] = Buffer.from(`<< /Type /Pages /Kids [${kids.map(k => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`, 'latin1');
    const partes = [Buffer.from('%PDF-1.4\n', 'latin1')], offs = [];
    let pos = partes[0].length;
    objs.forEach((o, i) => {
      offs.push(pos);
      const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, 'latin1'), o, Buffer.from('\nendobj\n', 'latin1')]);
      partes.push(b); pos += b.length;
    });
    const xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size ${objs.length + 1} /Root ${cat} 0 R >>\nstartxref\n${pos}\n%%EOF`;
    partes.push(Buffer.from(xref, 'latin1'));
    return Buffer.concat(partes);
  }
}

module.exports = { Pdf, W, H, M };
