// Rendu PDF d'un document Publisher à partir du flux librevenge (JSON produit par le moteur WebAssembly).
// 1) buildModel : flux -> pages, formes, images, cadres de texte, tableaux
// 2) renderPdf  : mise en page du texte (retour à la ligne, alignements, interlignes) + dessin PDF (pdf-lib)
import { PDFDocument, StandardFonts, rgb } from '../vendor/pdf-lib.esm.min.js';

// ---------- unités et couleurs ----------
export function len(v, def = 0) {
  if (v === undefined || v === null || v === '') return def;
  const m = /^(-?[\d.]+)\s*(in|pt|cm|mm|px|%|)$/.exec(String(v).trim());
  if (!m) return def;
  const n = parseFloat(m[1]);
  switch (m[2]) {
    case 'in': case '': return n * 72;
    case 'pt': return n;
    case 'cm': return n * 72 / 2.54;
    case 'mm': return n * 72 / 25.4;
    case 'px': return n * 0.75;
    default: return def;
  }
}
const pct = (v, def = 1) => { const m = /^(-?[\d.]+)%$/.exec(String(v ?? '')); return m ? parseFloat(m[1]) / 100 : def; };
export function color(hex, def = [0, 0, 0]) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? ''));
  if (!m) return rgb(...def);
  const n = parseInt(m[1], 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}
const b64 = s => (typeof atob === 'function'
  ? Uint8Array.from(atob(s), c => c.charCodeAt(0))
  : new Uint8Array(Buffer.from(s, 'base64')));

// ---------- 1) modèle ----------
export function buildModel(events) {
  const model = { pages: [], masters: {}, meta: {} };
  let page = null, style = {}, text = null, table = null, cell = null, para = null, spanStack = [], master = null;
  const container = () => (cell ? cell.paras : text ? text.paras : null);
  const curSpan = () => spanStack[spanStack.length - 1] || {};
  const addRun = s => {
    if (!para) { para = { props: {}, runs: [] }; const c = container(); if (c) c.push(para); else return; }
    para.runs.push({ text: s, props: curSpan() });
  };
  const target = () => (master ? master.items : page ? page.items : null);
  const push = item => { const t = target(); if (t) t.push(item); };

  for (const e of events) {
    const p = e.p || {};
    switch (e.t) {
      case 'setDocumentMetaData': model.meta = p; break;
      case 'startMasterPage': master = { w: len(p['svg:width'], 612), h: len(p['svg:height'], 792), items: [] }; model.masters[p['librevenge:master-page-name'] || 'default'] = master; break;
      case 'endMasterPage': master = null; break;
      case 'startPage': page = { w: len(p['svg:width'], 612), h: len(p['svg:height'], 792), master: p['librevenge:master-page-name'], items: [] }; model.pages.push(page); break;
      case 'endPage': page = null; break;
      case 'setStyle': style = { ...p }; break;
      case 'drawPolygon': case 'drawPolyline':
        push({ k: 'shape', kind: e.t === 'drawPolygon' ? 'polygon' : 'polyline', pts: (p['svg:points'] || []).map(q => [len(q['svg:x']), len(q['svg:y'])]), style });
        break;
      case 'drawRectangle':
        push({ k: 'shape', kind: 'rect', x: len(p['svg:x']), y: len(p['svg:y']), w: len(p['svg:width']), h: len(p['svg:height']), style });
        break;
      case 'drawEllipse':
        push({ k: 'shape', kind: 'ellipse', cx: len(p['svg:cx']), cy: len(p['svg:cy']), rx: len(p['svg:rx']), ry: len(p['svg:ry']), style });
        break;
      case 'drawPath':
        push({ k: 'shape', kind: 'path', d: pathFromVector(p['svg:d'] || []), style });
        break;
      case 'drawGraphicObject':
        if (p['office:binary-data']) push({ k: 'image', x: len(p['svg:x']), y: len(p['svg:y']), w: len(p['svg:width']), h: len(p['svg:height']), mime: p['librevenge:mime-type'], data: p['office:binary-data'] });
        break;
      case 'startTextObject':
        text = {
          k: 'text', x: len(p['svg:x']), y: len(p['svg:y']), w: len(p['svg:width']), h: len(p['svg:height']),
          pad: [len(p['fo:padding-top']), len(p['fo:padding-right']), len(p['fo:padding-left']), len(p['fo:padding-bottom'])],
          valign: p['draw:textarea-vertical-align'] || 'top', paras: [],
        };
        push(text); break;
      case 'endTextObject': text = null; para = null; break;
      case 'startTableObject':
        table = { k: 'table', x: len(p['svg:x']), y: len(p['svg:y']), w: len(p['svg:width']), h: len(p['svg:height']), cols: (p['librevenge:table-columns'] || []).map(c => len(c['style:column-width'])), rows: [] };
        push(table); break;
      case 'openTableRow': if (table) table.rows.push({ h: len(p['librevenge:row-height'] || p['style:row-height']), cells: [] }); break;
      case 'openTableCell':
        if (table && table.rows.length) {
          cell = { props: p, paras: [], col: +(p['librevenge:column'] ?? table.rows.at(-1).cells.length), colspan: +(p['table:number-columns-spanned'] || 1), rowspan: +(p['table:number-rows-spanned'] || 1) };
          table.rows.at(-1).cells.push(cell);
        }
        break;
      case 'closeTableCell': cell = null; para = null; break;
      case 'endTableObject': table = null; break;
      case 'openParagraph': { para = { props: p, runs: [] }; const c = container(); if (c) c.push(para); break; }
      case 'closeParagraph': para = null; break;
      case 'openSpan': spanStack.push(p); break;
      case 'closeSpan': spanStack.pop(); break;
      case 'insertText': addRun(e.s || ''); break;
      case 'insertSpace': addRun(' '); break;
      case 'insertTab': addRun('\t'); break;
      case 'insertLineBreak': addRun('\n'); break;
      default: break;
    }
  }
  return model;
}

function pathFromVector(v) {
  let d = '';
  for (const s of v) {
    const a = s['librevenge:path-action'];
    const x = len(s['svg:x']), y = len(s['svg:y']);
    if (a === 'M' || a === 'L') d += `${a}${x} ${y} `;
    else if (a === 'C') d += `C${len(s['svg:x1'])} ${len(s['svg:y1'])} ${len(s['svg:x2'])} ${len(s['svg:y2'])} ${x} ${y} `;
    else if (a === 'Q') d += `Q${len(s['svg:x1'])} ${len(s['svg:y1'])} ${x} ${y} `;
    else if (a === 'Z') d += 'Z ';
  }
  return d.trim();
}

// ---------- polices ----------
const SERIF = /(times|garamond|georgia|antiqua|palatino|cambria|century|bookman|baskerville|goudy|minion|caslon|perpetua|constantia|didot|bodoni|rockwell|serif|roman|book)/i;
const MONO = /(courier|consolas|mono|lucida console|typewriter)/i;
const SYMBOL = /(wingdings|webdings|symbol|dingbat)/i;
function fontKey(name = '', bold, italic) {
  const fam = MONO.test(name) ? 'Courier' : SERIF.test(name) && !/sans/i.test(name) ? 'Times' : 'Helvetica';
  const map = {
    Helvetica: ['Helvetica', 'HelveticaBold', 'HelveticaOblique', 'HelveticaBoldOblique'],
    Times: ['TimesRoman', 'TimesRomanBold', 'TimesRomanItalic', 'TimesRomanBoldItalic'],
    Courier: ['Courier', 'CourierBold', 'CourierOblique', 'CourierBoldOblique'],
  };
  return map[fam][(bold ? 1 : 0) + (italic ? 2 : 0)];
}

class Fonts {
  constructor(doc) { this.doc = doc; this.cache = new Map(); this.ok = new Map(); this.replaced = 0; }
  async get(key) { if (!this.cache.has(key)) this.cache.set(key, await this.doc.embedFont(StandardFonts[key])); return this.cache.get(key); }
  // Les polices standard PDF ne couvrent que WinAnsi : les caractères hors jeu sont remplacés.
  safe(font, s, symbolFont) {
    if (symbolFont) return s.replace(/\S/g, '•');
    let out = '';
    for (const ch of s.normalize('NFC')) {
      const k = font.name + ch;
      if (!this.ok.has(k)) { try { font.encodeText(ch); this.ok.set(k, true); } catch { this.ok.set(k, false); } }
      if (this.ok.get(k)) out += ch;
      else { out += ch === ' ' ? ' ' : /[‐-―]/.test(ch) ? '-' : /[‘’]/.test(ch) ? "'" : /[“”]/.test(ch) ? '"' : '?'; if (ch !== ' ') this.replaced++; }
    }
    return out;
  }
}

// ---------- 2) mise en page du texte ----------
async function layoutParas(paras, width, fonts) {
  const lines = [];
  for (const para of paras) {
    const pp = para.props || {};
    const align = pp['fo:text-align'] || 'left';
    const lhMult = pct(pp['fo:line-height'], NaN);
    const lhAbs = /in|pt|cm|mm$/.test(pp['fo:line-height'] || '') ? len(pp['fo:line-height']) : 0;
    // libmspub renvoie parfois des marges aberrantes (ex. 4697in) : toute valeur plus grande que le cadre est ignorée
    const sane = v => (Math.abs(v) >= width ? 0 : v);
    let indent = sane(len(pp['fo:text-indent'])), ml = sane(len(pp['fo:margin-left'])), mr = sane(len(pp['fo:margin-right']));
    if (ml + mr >= width * 0.9) { ml = 0; mr = 0; }
    const words = [];
    for (const r of para.runs) {
      const sp = r.props || {};
      const size = len(sp['fo:font-size'], 10) || 10;
      const bold = sp['fo:font-weight'] === 'bold', italic = sp['fo:font-style'] === 'italic';
      const font = await fonts.get(fontKey(sp['style:font-name'], bold, italic));
      const sym = SYMBOL.test(sp['style:font-name'] || '');
      const st = { font, size, color: sp['fo:color'], underline: sp['style:text-underline-type'] && sp['style:text-underline-type'] !== 'none' };
      for (const tok of r.text.replace(/\r/g, '').replace(/\t/g, '    ').split(/(\n| +)/)) {
        if (tok === '') continue;
        if (tok === '\n') { words.push({ br: true, st }); continue; }
        const text = fonts.safe(font, tok, sym);
        words.push({ text, space: /^ +$/.test(tok), st, w: font.widthOfTextAtSize(text, size) });
      }
    }
    const maxW = Math.max(1, width - ml - mr);
    let line = { words: [], w: 0, size: 0 }, first = true;
    const avail = () => maxW - (first ? indent : 0);
    const flush = (last) => {
      while (line.words.length && line.words.at(-1).space) line.w -= line.words.pop().w;
      const size = line.size || (para.runs[0] ? len(para.runs[0].props?.['fo:font-size'], 10) : 10);
      const h = lhAbs || size * (Number.isFinite(lhMult) ? lhMult : 1) * 1.17;
      lines.push({ ...line, size, h, align, last, x0: ml + (first ? indent : 0), maxW: avail() });
      line = { words: [], w: 0, size: 0 }; first = false;
    };
    if (lines.length || para !== paras[0]) lines.push({ spacer: len(pp['fo:margin-top']) });
    for (const w of words) {
      if (w.br) { line.size = Math.max(line.size, w.st.size); flush(true); continue; }
      if (w.space && line.words.length === 0) continue;
      if (!w.space && line.w + w.w > avail() && line.words.length) flush(false);
      if (!w.space && w.w > avail()) { // mot plus long que la ligne : coupe au caractère
        let chunk = '';
        for (const ch of w.text) {
          const t = chunk + ch;
          if (w.st.font.widthOfTextAtSize(t, w.st.size) > avail() && chunk) { line.words.push({ ...w, text: chunk, w: w.st.font.widthOfTextAtSize(chunk, w.st.size) }); line.size = Math.max(line.size, w.st.size); flush(false); chunk = ch; }
          else chunk = t;
        }
        w.text = chunk; w.w = w.st.font.widthOfTextAtSize(chunk, w.st.size);
      }
      line.words.push(w); line.w += w.w; line.size = Math.max(line.size, w.st.size);
    }
    flush(true);
    lines.push({ spacer: len(pp['fo:margin-bottom']) });
  }
  return lines;
}

function drawLines(page, lines, box, pageH, valign) {
  const total = lines.reduce((s, l) => s + (l.spacer ?? l.h), 0);
  let y = box.y + (valign === 'middle' ? Math.max(0, (box.h - total) / 2) : valign === 'bottom' ? Math.max(0, box.h - total) : 0);
  for (const l of lines) {
    if (l.spacer !== undefined) { y += l.spacer; continue; }
    const base = y + l.size * 0.92 + (l.h - l.size * 1.17) / 2;
    const slack = l.maxW - l.w;
    let x = box.x + l.x0 + (l.align === 'center' ? slack / 2 : (l.align === 'end' || l.align === 'right') ? slack : 0);
    const spaces = l.words.filter(w => w.space).length;
    const extra = l.align === 'justify' && !l.last && spaces ? slack / spaces : 0;
    for (const w of l.words) {
      if (!w.space && w.text) {
        page.drawText(w.text, { x, y: pageH - base, size: w.st.size, font: w.st.font, color: color(w.st.color) });
        if (w.st.underline) page.drawLine({ start: { x, y: pageH - base - w.st.size * 0.12 }, end: { x: x + w.w, y: pageH - base - w.st.size * 0.12 }, thickness: Math.max(0.5, w.st.size / 16), color: color(w.st.color) });
      }
      x += w.w + (w.space ? extra : 0);
    }
    y += l.h;
  }
}

// ---------- 3) dessin ----------
async function embedImage(doc, mime, bytes, convertImage, report, w, h) {
  try {
    if (/png/.test(mime)) return await doc.embedPng(bytes);
    if (/jpe?g/.test(mime)) return await doc.embedJpg(bytes);
    if (convertImage) { const png = await convertImage(mime, bytes, w, h); if (png) return await doc.embedPng(png); }
  } catch { /* image illisible : signalée ci-dessous */ }
  report.imagesSkipped++;
  return null;
}

function svgPathOf(item) {
  if (item.kind === 'path') return item.d;
  if (item.kind === 'rect') return `M${item.x} ${item.y} h${item.w} v${item.h} h${-item.w} Z`;
  if (!item.pts?.length) return '';
  return item.pts.map((q, i) => `${i ? 'L' : 'M'}${q[0]} ${q[1]}`).join(' ') + (item.kind === 'polygon' ? ' Z' : '');
}
function bbox(item) {
  if (item.kind === 'rect') return { x: item.x, y: item.y, w: item.w, h: item.h };
  if (item.kind === 'ellipse') return { x: item.cx - item.rx, y: item.cy - item.ry, w: 2 * item.rx, h: 2 * item.ry };
  const nums = (item.pts || []).flat().length ? item.pts : (item.d.match(/-?[\d.]+/g) || []).map(Number).reduce((a, n, i, arr) => (i % 2 ? a : a.concat([[n, arr[i + 1]]])), []);
  const xs = nums.map(q => q[0]), ys = nums.map(q => q[1]);
  if (!xs.length) return null;
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

async function drawShape(doc, page, item, pageH, convertImage, report) {
  const s = item.style || {};
  const opacity = pct(s['draw:opacity'], 1);
  const strokeW = s['draw:stroke'] && s['draw:stroke'] !== 'none' ? Math.max(0.25, len(s['svg:stroke-width'], 0.75)) : 0;
  const fillImage = s['draw:fill-image'];
  const fill = s['draw:fill'] === 'solid' && item.kind !== 'polyline';
  if (fillImage) {
    const box = bbox(item);
    const img = box && await embedImage(doc, s['librevenge:mime-type'] || '', b64(fillImage), convertImage, report, box.w, box.h);
    if (img && box.w > 0 && box.h > 0) { page.drawImage(img, { x: box.x, y: pageH - box.y - box.h, width: box.w, height: box.h, opacity }); report.images++; }
  }
  if (!fill && !strokeW) return;
  const opts = {
    color: fill ? color(s['draw:fill-color'], [1, 1, 1]) : undefined, opacity: fill ? opacity : undefined,
    borderColor: strokeW ? color(s['svg:stroke-color']) : undefined, borderWidth: strokeW || undefined, borderOpacity: strokeW ? opacity : undefined,
  };
  if (item.kind === 'ellipse') page.drawEllipse({ x: item.cx, y: pageH - item.cy, xScale: item.rx, yScale: item.ry, ...opts });
  else { const d = svgPathOf(item); if (d) page.drawSvgPath(d, { x: 0, y: pageH, ...opts }); }
}

async function drawTable(page, t, pageH, fonts) {
  const cols = t.cols.length ? t.cols : [t.w];
  const colX = cols.reduce((a, w) => a.concat(a.at(-1) + w), [t.x]);
  let y = t.y;
  const rowY = t.rows.map(r => { const v = y; y += r.h || 14; return v; });
  rowY.push(y);
  for (const [ri, r] of t.rows.entries()) {
    for (const c of r.cells) {
      const x0 = colX[Math.min(c.col, cols.length - 1)], x1 = colX[Math.min(c.col + c.colspan, cols.length)];
      const y0 = rowY[ri], y1 = rowY[Math.min(ri + c.rowspan, t.rows.length)];
      const cp = c.props || {};
      if (cp['fo:background-color']) page.drawRectangle({ x: x0, y: pageH - y1, width: x1 - x0, height: y1 - y0, color: color(cp['fo:background-color'], [1, 1, 1]) });
      for (const [side, a, b] of [['top', [x0, y0], [x1, y0]], ['bottom', [x0, y1], [x1, y1]], ['left', [x0, y0], [x0, y1]], ['right', [x1, y0], [x1, y1]]]) {
        const m = /([\d.]+(?:in|pt|cm|mm))\s+\w+\s+(#[0-9a-f]{6})/i.exec(cp[`fo:border-${side}`] || cp['fo:border'] || '');
        if (m) page.drawLine({ start: { x: a[0], y: pageH - a[1] }, end: { x: b[0], y: pageH - b[1] }, thickness: Math.max(0.25, len(m[1])), color: color(m[2]) });
      }
      const pad = 2.9;
      const lines = await layoutParas(c.paras, x1 - x0 - 2 * pad, fonts);
      drawLines(page, lines, { x: x0 + pad, y: y0 + pad, w: x1 - x0 - 2 * pad, h: y1 - y0 - 2 * pad }, pageH, cp['style:vertical-align'] || 'top');
    }
  }
}

export async function renderPdf(model, { convertImage, title } = {}) {
  const report = { pages: model.pages.length, texts: 0, tables: 0, shapes: 0, images: 0, imagesSkipped: 0, charsReplaced: 0 };
  if (!model.pages.length) throw new Error('Aucune page trouvée dans ce fichier.');
  const doc = await PDFDocument.create();
  doc.setProducer('PubToPDF (libmspub)');
  doc.setCreator('PubToPDF');
  if (title) doc.setTitle(title);
  const fonts = new Fonts(doc);
  for (const pg of model.pages) {
    const page = doc.addPage([pg.w, pg.h]);
    const items = [...((pg.master && model.masters[pg.master]?.items) || []), ...pg.items];
    for (const it of items) {
      if (it.k === 'shape') { report.shapes++; await drawShape(doc, page, it, pg.h, convertImage, report); }
      else if (it.k === 'image') {
        const img = await embedImage(doc, it.mime || '', b64(it.data), convertImage, report, it.w, it.h);
        if (img) { page.drawImage(img, { x: it.x, y: pg.h - it.y - it.h, width: it.w, height: it.h }); report.images++; }
      } else if (it.k === 'text') {
        report.texts++;
        const [pt, pr, pl, pb] = it.pad;
        const box = { x: it.x + pl, y: it.y + pt, w: it.w - pl - pr, h: it.h - pt - pb };
        drawLines(page, await layoutParas(it.paras, box.w, fonts), box, pg.h, it.valign);
      } else if (it.k === 'table') { report.tables++; await drawTable(page, it, pg.h, fonts); }
    }
  }
  report.charsReplaced = fonts.replaced;
  return { bytes: await doc.save(), report };
}
