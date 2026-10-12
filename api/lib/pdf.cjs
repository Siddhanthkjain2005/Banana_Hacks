'use strict';

const zlib = require('node:zlib');

const MM = 72 / 25.4;
const PAPER = { a4: { width: 210, height: 297 }, letter: { width: 215.9, height: 279.4 } };
// Windows-1252 code points outside Latin-1 that the standard fonts can draw.
const WIN_ANSI = { '€': 0x80, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97 };
const FALLBACK = { '→': '->', '≤': '<=', '≥': '>=', '≈': '~', 'Δ': 'd', '✓': 'v' };

const num = value => (Math.round(value * 1000) / 1000).toString();
const rgb = color => {
  const [r, g, b] = typeof color === 'string' ? [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16)) : color;
  return `${num(r / 255)} ${num(g / 255)} ${num(b / 255)}`;
};

/** Encode text as a PDF literal string in WinAnsiEncoding. */
function pdfString(text) {
  let out = '(';
  for (const ch of String(text)) {
    const replacement = FALLBACK[ch];
    if (replacement) { out += replacement; continue; }
    const code = ch.codePointAt(0), byte = WIN_ANSI[ch] ?? (code >= 32 && code <= 126 || code >= 0xa0 && code <= 0xff ? code : 63);
    out += byte === 40 || byte === 41 || byte === 92 ? `\\${String.fromCharCode(byte)}` : byte > 126 ? `\\${byte.toString(8).padStart(3, '0')}` : String.fromCharCode(byte);
  }
  return out + ')';
}

/** Approximate Helvetica advance widths, used only for wrapping and alignment. */
function textWidth(text, size, bold = false) {
  let units = 0;
  for (const ch of String(text)) {
    units += ' '.includes(ch) ? 278 : 'ijl|.,:;!\''.includes(ch) ? 240 : 'fIrt()[]-'.includes(ch) ? 320 : 'mwMW'.includes(ch) ? 860
      : /[0-9]/.test(ch) ? 556 : /[A-Z]/.test(ch) ? 680 : 540;
  }
  return units / 1000 * size * (bold ? 1.06 : 1) / MM;
}

function wrap(text, maxWidth, size, bold = false) {
  const lines = [];
  for (const paragraph of String(text).split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && textWidth(next, size, bold) > maxWidth) { lines.push(line); line = word; } else line = next;
    }
    lines.push(line);
  }
  return lines;
}

/** A small vector PDF builder with millimetre units and a top-left origin. */
class PdfDocument {
  constructor({ paper = 'a4', title = 'Document' } = {}) {
    this.size = PAPER[paper] || PAPER.a4; this.title = title; this.pages = [];
  }
  addPage() {
    const ops = [], h = this.size.height;
    const style = ({ fill, stroke, lineWidth = .3, dash } = {}) => `${fill ? `${rgb(fill)} rg ` : ''}${stroke ? `${rgb(stroke)} RG ${num(lineWidth * MM)} w ` : ''}${dash ? `[${dash.map(d => num(d * MM)).join(' ')}] 0 d ` : ''}`;
    const paint = ({ fill, stroke }) => fill && stroke ? 'B' : fill ? 'f' : 'S';
    const page = {
      width: this.size.width, height: h,
      rect(x, y, w, hh, options = {}) { ops.push(`q ${style(options)}${num(x * MM)} ${num((h - y - hh) * MM)} ${num(w * MM)} ${num(hh * MM)} re ${paint(options)} Q`); return page; },
      line(x1, y1, x2, y2, options = {}) { ops.push(`q ${style({ stroke: '#161b18', ...options })}${num(x1 * MM)} ${num((h - y1) * MM)} m ${num(x2 * MM)} ${num((h - y2) * MM)} l S Q`); return page; },
      text(x, y, value, { size = 10, bold = false, color = '#161b18', align = 'left' } = {}) {
        const width = textWidth(value, size, bold), left = align === 'right' ? x - width : align === 'center' ? x - width / 2 : x;
        ops.push(`q ${rgb(color)} rg BT /${bold ? 'F2' : 'F1'} ${num(size)} Tf ${num(left * MM)} ${num((h - y) * MM)} Td ${pdfString(value)} Tj ET Q`);
        return page;
      },
      /** Wrapped paragraph; returns the y position below it. */
      paragraph(x, y, value, maxWidth, { size = 10, bold = false, color, leading = 1.35 } = {}) {
        const step = size * leading / MM;
        wrap(value, maxWidth, size, bold).forEach((line, i) => page.text(x, y + i * step, line, { size, bold, color }));
        return y + wrap(value, maxWidth, size, bold).length * step;
      },
      ops,
    };
    this.pages.push(page);
    return page;
  }
  toBuffer() {
    const objects = [], add = body => { objects.push(body); return objects.length; };
    const catalog = add(null), pagesId = add(null);
    const regular = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const bold = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const kids = this.pages.map(page => {
      const stream = zlib.deflateSync(Buffer.from(page.ops.join('\n'), 'latin1'));
      const content = add(Buffer.concat([Buffer.from(`<< /Length ${stream.length} /Filter /FlateDecode >>\nstream\n`, 'latin1'), stream, Buffer.from('\nendstream', 'latin1')]));
      return add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${num(this.size.width * MM)} ${num(this.size.height * MM)}] /Resources << /Font << /F1 ${regular} 0 R /F2 ${bold} 0 R >> >> /Contents ${content} 0 R >>`);
    });
    objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
    objects[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map(k => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
    const info = add(`<< /Title ${pdfString(this.title)} /Producer (ReThread geometry API) >>`);
    const chunks = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')], offsets = [];
    let length = chunks[0].length;
    objects.forEach((body, i) => {
      offsets.push(length);
      const chunk = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, 'latin1'), Buffer.isBuffer(body) ? body : Buffer.from(body, 'latin1'), Buffer.from('\nendobj\n', 'latin1')]);
      chunks.push(chunk); length += chunk.length;
    });
    const xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f\r\n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n\r\n`).join('')}`;
    chunks.push(Buffer.from(`${xref}trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${length}\n%%EOF\n`, 'latin1'));
    return Buffer.concat(chunks);
  }
}

module.exports = { PdfDocument, pdfString, textWidth, wrap, PAPER };
