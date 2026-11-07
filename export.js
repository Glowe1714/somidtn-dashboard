/* SoMidTN Dashboard: downloads built in the browser from the dashboard's own data.
   Tables: CSV and Excel. Reports: Word, PDF and PowerPoint. Nothing is sent anywhere. */
(() => {
  const enc = new TextEncoder();
  const X = (s) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const longDate = () => new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const slug = (s) => String(s || 'table').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'table';
  const dash_ = (v) => (v == null || v === '' ? '—' : String(v));

  /* ---------- saving ---------- */
  const inClaude = () => !!(window.claude && typeof window.claude.use === 'function');
  let dlP = null;
  const downloads = () => { if (!dlP && inClaude()) dlP = window.claude.use('downloads').catch(() => null); return dlP || Promise.resolve(null); };
  let toastMsg = '', toastTimer = null;
  dash.draw('sm_toast', (el) => { el.textContent = toastMsg; });
  function toast(msg) {
    toastMsg = String(msg || '');
    dash.draw('sm_toast');
    document.querySelectorAll('.sm-toast').forEach((t) => t.classList.remove('is-off'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => document.querySelectorAll('.sm-toast').forEach((t) => t.classList.add('is-off')), 6000);
  }
  async function save(filename, blob) {
    const dl = await downloads();
    if (dl) {
      try { await dl.save({ filename, data: blob }); } catch (e) { if (!e || e.code !== 'declined') toast('Could not save ' + filename + (e && e.message ? ': ' + e.message : '.')); }
      return;
    }
    if (inClaude()) { toast('Downloads are not available in this view.'); return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename; a.rel = 'noopener';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  /* ---------- zip (stored, no compression) for Office files ---------- */
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (b) => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  function zip(files, mime) {
    const out = [], cen = [];
    let off = 0;
    const d = new Date();
    const dt = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xFFFF;
    const dd = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF;
    files.forEach((f) => {
      const name = enc.encode(f.name), data = typeof f.data === 'string' ? enc.encode(f.data) : f.data, crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
      lh.setUint16(10, dt, true); lh.setUint16(12, dd, true); lh.setUint32(14, crc, true);
      lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      out.push(new Uint8Array(lh.buffer), name, data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
      ch.setUint16(12, dt, true); ch.setUint16(14, dd, true); ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true);
      ch.setUint16(28, name.length, true); ch.setUint16(30, 0, true); ch.setUint16(32, 0, true); ch.setUint16(34, 0, true); ch.setUint16(36, 0, true);
      ch.setUint32(38, 0, true); ch.setUint32(42, off, true);
      cen.push(new Uint8Array(ch.buffer), name);
      off += 30 + name.length + data.length;
    });
    const size = cen.reduce((s, p) => s + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, size, true); end.setUint32(16, off, true);
    return new Blob([...out, ...cen, new Uint8Array(end.buffer)], { type: mime });
  }
  const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';

  /* ---------- CSV and Excel ---------- */
  const csv = (rows) => '﻿' + rows.map((r) => r.map((v) => { const s = String(v == null ? '' : v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(',')).join('\r\n');
  const colName = (i) => { let s = ''; i += 1; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  const asNumber = (v) => {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    const s = String(v == null ? '' : v).trim().replace(/−/g, '-');
    if (!/^[+-]?\$?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$/.test(s)) return null;
    const n = Number(s.replace(/[$,+]/g, ''));
    return isFinite(n) ? n : null;
  };
  function xlsx(sheets) {
    const used = new Set();
    const names = sheets.map((s, i) => {
      let n = String(s.name || 'Sheet' + (i + 1)).replace(/[[\]*?/\\:]/g, ' ').trim().slice(0, 31) || 'Sheet' + (i + 1);
      let k = 2; while (used.has(n.toLowerCase())) n = n.slice(0, 27) + ' ' + k++;
      used.add(n.toLowerCase()); return n;
    });
    const files = [
      { name: '[Content_Types].xml', data: XML + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' + sheets.map((s, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('') + '</Types>' },
      { name: '_rels/.rels', data: XML + '<Relationships xmlns="' + PKG + '"><Relationship Id="rId1" Type="' + REL + '/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
      { name: 'xl/workbook.xml', data: XML + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="' + REL + '"><sheets>' + names.map((n, i) => '<sheet name="' + X(n) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('') + '</sheets></workbook>' },
      { name: 'xl/_rels/workbook.xml.rels', data: XML + '<Relationships xmlns="' + PKG + '">' + sheets.map((s, i) => '<Relationship Id="rId' + (i + 1) + '" Type="' + REL + '/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('') + '<Relationship Id="rId' + (sheets.length + 1) + '" Type="' + REL + '/styles" Target="styles.xml"/></Relationships>' },
      { name: 'xl/styles.xml', data: XML + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>' },
    ];
    sheets.forEach((s, si) => {
      const widths = [];
      s.rows.forEach((r) => r.forEach((v, c) => { widths[c] = Math.max(widths[c] || 8, Math.min(60, String(v == null ? '' : v).length + 2)); }));
      const cols = widths.length ? '<cols>' + widths.map((w, c) => '<col min="' + (c + 1) + '" max="' + (c + 1) + '" width="' + w + '" customWidth="1"/>').join('') + '</cols>' : '';
      const body = s.rows.map((r, ri) => '<row r="' + (ri + 1) + '">' + r.map((v, c) => {
        const ref = colName(c) + (ri + 1), head = ri === 0;
        const n = head ? null : asNumber(v);
        if (n != null) return '<c r="' + ref + '"><v>' + n + '</v></c>';
        if (v == null || v === '') return '';
        return '<c r="' + ref + '" t="inlineStr"' + (head ? ' s="1"' : '') + '><is><t xml:space="preserve">' + X(v) + '</t></is></c>';
      }).join('') + '</row>').join('');
      files.push({ name: 'xl/worksheets/sheet' + (si + 1) + '.xml', data: XML + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' + cols + '<sheetData>' + body + '</sheetData></worksheet>' });
    });
    return zip(files, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  }

  /* ---------- Word ---------- */
  function docx(blocks) {
    const run = (text, o = {}) => '<w:r><w:rPr>' + (o.b ? '<w:b/>' : '') + (o.i ? '<w:i/>' : '') + (o.color ? '<w:color w:val="' + o.color + '"/>' : '') + '<w:sz w:val="' + (o.sz || 21) + '"/><w:szCs w:val="' + (o.sz || 21) + '"/></w:rPr><w:t xml:space="preserve">' + X(text) + '</w:t></w:r>';
    const tab = '<w:r><w:tab/></w:r>';
    const para = (inner, o = {}) => '<w:p><w:pPr>' + (o.keep ? '<w:keepNext/>' : '') + '<w:spacing w:before="' + (o.before || 0) + '" w:after="' + (o.after == null ? 120 : o.after) + '"/>' + (o.ind ? '<w:ind w:left="' + o.ind + '" w:hanging="' + o.ind + '"/>' : '') + '</w:pPr>' + inner + '</w:p>';
    const TOTAL = 10080;
    const border = (k) => '<w:' + k + ' w:val="single" w:sz="4" w:space="0" w:color="A6A6A6"/>';
    const parts = [], imgs = [];
    blocks.forEach((b) => {
      if (b.t === 'image') {
        const k = imgs.length + 1; imgs.push(b.bytes);
        const wIn = Math.min(7, b.w / 2 / 96), hIn = wIn * b.h / b.w, cx = Math.round(wIn * 914400), cy = Math.round(hIn * 914400);
        parts.push('<w:p><w:pPr><w:spacing w:before="60" w:after="160"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="' + cx + '" cy="' + cy + '"/><wp:docPr id="' + k + '" name="Chart ' + k + '"/>'
          + '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">'
          + '<pic:nvPicPr><pic:cNvPr id="' + k + '" name="chart' + k + '.jpeg"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdImg' + k + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>'
          + '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>');
        return;
      }
      if (b.t === 'title') parts.push(para(run(b.text, { b: true, sz: 40, color: '1F3864' }), { after: 80 }));
      else if (b.t === 'subtitle') parts.push(para(run(b.text, { sz: 19, color: '595959' }), { after: 240 }));
      else if (b.t === 'h1') parts.push(para(run(b.text, { b: true, sz: 30, color: '1F3864' }), { before: 280, after: 120, keep: true }));
      else if (b.t === 'h2') parts.push(para(run(b.text, { b: true, sz: 24 }), { before: 180, after: 80, keep: true }));
      else if (b.t === 'p') parts.push(para(run(b.text)));
      else if (b.t === 'note') parts.push(para(run(b.text, { sz: 17, i: true, color: '595959' })));
      else if (b.t === 'bullets' || b.t === 'numbered') {
        b.items.forEach((it, i) => {
          const lead = run(b.t === 'numbered' ? (i + 1) + '.' : '•') + tab;
          const body = typeof it === 'string' ? run(it) : run(it.lead, { b: true }) + run(it.text) + (it.src ? run(' (' + it.src + ')', { i: true, color: '595959', sz: 18 }) : '');
          parts.push(para(lead + body, { ind: 360, after: 60 }));
        });
      } else if (b.t === 'table') {
        const w = b.widths || b.head.map(() => 1), ws = w.reduce((s, v) => s + v, 0);
        const cw = w.map((v) => Math.floor(TOTAL * v / ws));
        const cell = (txt, i, head) => '<w:tc><w:tcPr><w:tcW w:w="' + cw[i] + '" w:type="dxa"/>' + (head ? '<w:shd w:val="clear" w:color="auto" w:fill="D9E2F3"/>' : '') + '</w:tcPr><w:p><w:pPr><w:spacing w:before="20" w:after="20"/></w:pPr>' + run(dash_(txt), { sz: 17, b: head }) + '</w:p></w:tc>';
        parts.push('<w:tbl><w:tblPr><w:tblW w:w="' + TOTAL + '" w:type="dxa"/><w:tblBorders>' + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(border).join('') + '</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>' + cw.map((v) => '<w:gridCol w:w="' + v + '"/>').join('') + '</w:tblGrid>'
          + '<w:tr><w:trPr><w:tblHeader/></w:trPr>' + b.head.map((x, i) => cell(x, i, true)).join('') + '</w:tr>'
          + b.rows.map((r) => '<w:tr><w:trPr><w:cantSplit/></w:trPr>' + b.head.map((_, i) => cell(r[i], i, false)).join('') + '</w:tr>').join('') + '</w:tbl>');
        parts.push(para('', { after: 60 }));
      }
    });
    const doc = XML + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="' + REL + '" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>' + parts.join('') + '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>';
    return zip([
      { name: '[Content_Types].xml', data: XML + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>' },
      { name: '_rels/.rels', data: XML + '<Relationships xmlns="' + PKG + '"><Relationship Id="rId1" Type="' + REL + '/officeDocument" Target="word/document.xml"/></Relationships>' },
      { name: 'word/_rels/document.xml.rels', data: XML + '<Relationships xmlns="' + PKG + '">' + imgs.map((_, i) => '<Relationship Id="rIdImg' + (i + 1) + '" Type="' + REL + '/image" Target="media/chart' + (i + 1) + '.jpeg"/>').join('') + '</Relationships>' },
      { name: 'word/document.xml', data: doc },
      ...imgs.map((bytes, i) => ({ name: 'word/media/chart' + (i + 1) + '.jpeg', data: bytes })),
    ], 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  }

  /* ---------- PDF (Helvetica, Letter) ---------- */
  const HELV = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
  const HELVB = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];
  const WIN = { 0x2013: 0x96, 0x2014: 0x97, 0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2026: 0x85, 0x20AC: 0x80, 0x2212: 0x2D, 0x00A0: 0x20, 0x2192: 0x3E };
  const winText = (s) => {
    let o = '';
    for (const ch of String(s == null ? '' : s)) {
      const c = ch.codePointAt(0);
      if (c >= 32 && c < 127) o += ch;
      else if (WIN[c] != null) o += String.fromCharCode(WIN[c]);
      else if (c >= 0xA1 && c <= 0xFF) o += ch;
      else if (c === 0x2197 || c === 0x200B) o += '';
      else if (c === 9 || c === 10 || c === 13) o += ' ';
      else o += '?';
    }
    return o;
  };
  const charW = (c, bold) => (c >= 32 && c <= 126 ? (bold ? HELVB : HELV)[c - 32] : c === 0x97 ? 1000 : c === 0x95 ? 350 : c === 0x91 || c === 0x92 ? 222 : c === 0x93 || c === 0x94 ? 333 : 556);
  const textW = (s, size, bold) => { let w = 0; for (let i = 0; i < s.length; i++) w += charW(s.charCodeAt(i), bold); return (w * size) / 1000; };
  function wrap(s, size, bold, maxW) {
    const lines = []; let cur = '';
    s.split(/ +/).forEach((word) => {
      if (!word) return;
      const t = cur ? cur + ' ' + word : word;
      if (textW(t, size, bold) <= maxW) { cur = t; return; }
      if (cur) lines.push(cur);
      while (textW(word, size, bold) > maxW && word.length > 1) {
        let k = 1; while (k < word.length && textW(word.slice(0, k + 1), size, bold) <= maxW) k++;
        lines.push(word.slice(0, k)); word = word.slice(k);
      }
      cur = word;
    });
    if (cur) lines.push(cur);
    return lines.length ? lines : [''];
  }
  function pdf(blocks, footer) {
    const W = 612, H = 792, M = 54, CW = W - 2 * M;
    const pages = []; let ops = null, y = 0;
    const newPage = () => { ops = []; pages.push(ops); y = H - M; };
    const room = (h) => { if (!ops || y - h < M + 24) newPage(); };
    const esc = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
    const txt = (s, x, yy, size, bold, rgb) => ops.push((rgb || [0.1, 0.1, 0.1]).join(' ') + ' rg BT /' + (bold ? 'F2' : 'F1') + ' ' + size + ' Tf ' + x.toFixed(2) + ' ' + yy.toFixed(2) + ' Td (' + esc(s) + ') Tj ET');
    const para = (str, size, bold, rgb, indent = 0) => wrap(winText(str), size, bold, CW - indent).forEach((ln) => { room(size * 1.35); y -= size * 1.35; txt(ln, M + indent, y, size, bold, rgb); });
    const BLUE = [0.12, 0.22, 0.39], GREY = [0.35, 0.35, 0.35];
    const images = [];
    newPage();
    blocks.forEach((b) => {
      if (b.t === 'image') {
        let dw = Math.min(CW, (b.w / 2) * 0.75), dh = dw * b.h / b.w;
        const maxH = H - 2 * M - 70;
        if (dh > maxH) { dh = maxH; dw = dh * b.w / b.h; }
        room(dh + 12);
        const name = 'Im' + (images.length + 1);
        images.push({ b, page: pages.length - 1, name });
        ops.push('q ' + dw.toFixed(2) + ' 0 0 ' + dh.toFixed(2) + ' ' + M + ' ' + (y - dh).toFixed(2) + ' cm /' + name + ' Do Q');
        y -= dh + 12;
        return;
      }
      if (b.t === 'title') { para(b.text, 20, true, BLUE); y -= 4; }
      else if (b.t === 'subtitle') { para(b.text, 9.5, false, GREY); y -= 10; }
      else if (b.t === 'h1') { room(70); y -= 10; para(b.text, 14, true, BLUE); y -= 4; }
      else if (b.t === 'h2') { room(50); y -= 6; para(b.text, 11.5, true); y -= 2; }
      else if (b.t === 'p') { para(b.text, 10, false); y -= 4; }
      else if (b.t === 'note') { para(b.text, 8.5, false, GREY); y -= 4; }
      else if (b.t === 'bullets' || b.t === 'numbered') {
        b.items.forEach((it, i) => {
          const str = typeof it === 'string' ? it : it.lead + it.text + (it.src ? ' (' + it.src + ')' : '');
          wrap(winText(str), 10, false, CW - 16).forEach((ln, k) => {
            room(13); y -= 13;
            if (k === 0) txt(b.t === 'numbered' ? (i + 1) + '.' : winText('•'), M + 2, y, 10, false);
            txt(ln, M + 16, y, 10, false);
          });
          y -= 3;
        });
        y -= 3;
      } else if (b.t === 'table') {
        const wts = b.widths || b.head.map(() => 1), sum = wts.reduce((s, v) => s + v, 0);
        const cw = wts.map((v) => (CW * v) / sum), size = 8, lh = 10, pad = 3;
        const prep = (r, bold) => { const L = b.head.map((_, i) => wrap(winText(dash_(r[i])), size, bold, cw[i] - 2 * pad)); return { L, hgt: Math.max(...L.map((l) => l.length)) * lh + 2 * pad, bold }; };
        const paint = (row) => {
          if (row.bold) ops.push('0.85 0.89 0.95 rg ' + M + ' ' + (y - row.hgt).toFixed(2) + ' ' + CW.toFixed(2) + ' ' + row.hgt.toFixed(2) + ' re f');
          ops.push('0.65 0.65 0.65 RG 0.5 w ' + M + ' ' + (y - row.hgt).toFixed(2) + ' ' + CW.toFixed(2) + ' ' + row.hgt.toFixed(2) + ' re S');
          let x = M;
          row.L.forEach((cl, i) => {
            if (i) ops.push('0.65 0.65 0.65 RG ' + x.toFixed(2) + ' ' + y.toFixed(2) + ' m ' + x.toFixed(2) + ' ' + (y - row.hgt).toFixed(2) + ' l S');
            cl.forEach((ln, k) => txt(ln, x + pad, y - pad - (k + 1) * lh + 2, size, row.bold));
            x += cw[i];
          });
          y -= row.hgt;
        };
        const head = prep(b.head, true);
        room(head.hgt + 24); paint(head);
        b.rows.forEach((r) => { const row = prep(r, false); if (y - row.hgt < M + 24) { newPage(); paint(head); } paint(row); });
        y -= 10;
      }
    });
    const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'];
    const latin1 = (u) => { let o = ''; for (let i = 0; i < u.length; i += 8192) o += String.fromCharCode.apply(null, u.subarray(i, i + 8192)); return o; };
    images.forEach((im) => {
      objs.push('<< /Type /XObject /Subtype /Image /Width ' + im.b.w + ' /Height ' + im.b.h + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + im.b.bytes.length + ' >>\nstream\n' + latin1(im.b.bytes) + '\nendstream');
      im.obj = objs.length;
    });
    const kids = [];
    pages.forEach((p, i) => {
      const foot = '0.4 0.4 0.4 rg BT /F1 7.5 Tf ' + M + ' 30 Td (' + esc(winText(footer)) + ') Tj ET 0.4 0.4 0.4 rg BT /F1 7.5 Tf ' + (W - M - 52) + ' 30 Td (' + esc('Page ' + (i + 1) + ' of ' + pages.length) + ') Tj ET';
      const stream = p.join('\n') + '\n' + foot;
      objs.push('<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream');
      const pim = images.filter((im) => im.page === i);
      objs.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + W + ' ' + H + '] /Resources << /Font << /F1 3 0 R /F2 4 0 R >>' + (pim.length ? ' /XObject << ' + pim.map((im) => '/' + im.name + ' ' + im.obj + ' 0 R').join(' ') + ' >>' : '') + ' >> /Contents ' + objs.length + ' 0 R >>');
      kids.push(objs.length);
    });
    objs[1] = '<< /Type /Pages /Kids [' + kids.map((k) => k + ' 0 R').join(' ') + '] /Count ' + kids.length + ' >>';
    let out = '%PDF-1.4\n%âãÏÓ\n';
    const offs = [];
    objs.forEach((o, i) => { offs.push(out.length); out += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; });
    const xref = out.length;
    out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n' + offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
    out += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
    const bytes = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xFF;
    return new Blob([bytes], { type: 'application/pdf' });
  }

  /* ---------- PowerPoint (16:9) ---------- */
  const E = (inch) => Math.round(inch * 914400);
  const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="' + REL + '" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
  const TREE = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
  function pptx(slides) {
    const rpr = (o) => '<a:rPr lang="en-US" sz="' + Math.round((o.size || 14) * 100) + '"' + (o.bold ? ' b="1"' : '') + (o.italic ? ' i="1"' : '') + ' dirty="0"><a:solidFill><a:srgbClr val="' + (o.color || '222222') + '"/></a:solidFill><a:latin typeface="Calibri"/></a:rPr>';
    const paraX = (p) => '<a:p><a:pPr algn="' + (p.align || 'l') + '"' + (p.bullet ? ' marL="228600" indent="-228600"' : '') + '><a:spcAft><a:spcPts val="' + Math.round((p.after == null ? 4 : p.after) * 100) + '"/></a:spcAft>' + (p.bullet ? '<a:buFont typeface="Arial"/><a:buChar char="•"/>' : '<a:buNone/>') + '</a:pPr>'
      + (p.runs || [p]).map((r) => '<a:r>' + rpr(r) + '<a:t>' + X(r.text) + '</a:t></a:r>').join('') + '</a:p>';
    const slideXml = (s) => {
      let id = 2;
      const shapes = s.map((e) => {
        const n = id++;
        const xf = '<a:xfrm><a:off x="' + E(e.x) + '" y="' + E(e.y) + '"/><a:ext cx="' + E(e.w) + '" cy="' + E(e.h || 0.4) + '"/></a:xfrm>';
        if (e.k === 'rect') return '<p:sp><p:nvSpPr><p:cNvPr id="' + n + '" name="Shape ' + n + '"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>' + xf + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="' + e.fill + '"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr></p:sp>';
        if (e.k === 'text') return '<p:sp><p:nvSpPr><p:cNvPr id="' + n + '" name="Text ' + n + '"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>' + xf + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' + (e.fill ? '<a:solidFill><a:srgbClr val="' + e.fill + '"/></a:solidFill>' : '<a:noFill/>') + (e.line ? '<a:ln w="9525"><a:solidFill><a:srgbClr val="' + e.line + '"/></a:solidFill></a:ln>' : '') + '</p:spPr><p:txBody><a:bodyPr wrap="square" lIns="' + E(e.pad == null ? 0.08 : e.pad) + '" tIns="' + E(0.05) + '" rIns="' + E(e.pad == null ? 0.08 : e.pad) + '" bIns="' + E(0.05) + '" anchor="' + (e.anchor || 't') + '"><a:normAutofit/></a:bodyPr><a:lstStyle/>' + e.paras.map(paraX).join('') + '</p:txBody></p:sp>';
        if (e.k === 'table') {
          const wts = e.widths || e.head.map(() => 1), sum = wts.reduce((a, b) => a + b, 0);
          const cell = (t, head, odd) => '<a:tc><a:txBody><a:bodyPr/><a:lstStyle/>' + paraX({ text: dash_(t), size: e.size || 11, bold: head, color: head ? 'FFFFFF' : '222222', after: 0 }) + '</a:txBody><a:tcPr marL="' + E(0.06) + '" marR="' + E(0.06) + '" marT="' + E(0.03) + '" marB="' + E(0.03) + '">' + ['lnL', 'lnR', 'lnT', 'lnB'].map((k) => '<a:' + k + ' w="6350"><a:solidFill><a:srgbClr val="BFBFBF"/></a:solidFill></a:' + k + '>').join('') + '<a:solidFill><a:srgbClr val="' + (head ? '1F3864' : odd ? 'F2F5FA' : 'FFFFFF') + '"/></a:solidFill></a:tcPr></a:tc>';
          const rh = E((e.size || 11) / 72 * 1.9);
          return '<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="' + n + '" name="Table ' + n + '"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="' + E(e.x) + '" y="' + E(e.y) + '"/><a:ext cx="' + E(e.w) + '" cy="' + rh * (e.rows.length + 1) + '"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1" bandRow="1"/><a:tblGrid>' + wts.map((v) => '<a:gridCol w="' + E((e.w * v) / sum) + '"/>').join('') + '</a:tblGrid>'
            + '<a:tr h="' + rh + '">' + e.head.map((t) => cell(t, true)).join('') + '</a:tr>'
            + e.rows.map((r, ri) => '<a:tr h="' + rh + '">' + e.head.map((_, i) => cell(r[i], false, ri % 2 === 1)).join('') + '</a:tr>').join('') + '</a:tbl></a:graphicData></a:graphic></p:graphicFrame>';
        }
        return '';
      }).join('');
      return XML + '<p:sld ' + NS + '><p:cSld><p:spTree>' + TREE + shapes + '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>';
    };
    const theme = XML + '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="SoMidTN"><a:themeElements><a:clrScheme name="SoMidTN"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F3864"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="2A6FDB"/></a:accent1><a:accent2><a:srgbClr val="E07B39"/></a:accent2><a:accent3><a:srgbClr val="3AA676"/></a:accent3><a:accent4><a:srgbClr val="9B59B6"/></a:accent4><a:accent5><a:srgbClr val="C0392B"/></a:accent5><a:accent6><a:srgbClr val="16A085"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="SoMidTN"><a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="SoMidTN"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>';
    const master = XML + '<p:sldMaster ' + NS + '><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>' + TREE + '</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="3200"/></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>';
    const layout = XML + '<p:sldLayout ' + NS + ' type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>' + TREE + '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>';
    const n = slides.length;
    const files = [
      { name: '[Content_Types].xml', data: XML + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>' + slides.map((s, i) => '<Override PartName="/ppt/slides/slide' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>').join('') + '</Types>' },
      { name: '_rels/.rels', data: XML + '<Relationships xmlns="' + PKG + '"><Relationship Id="rId1" Type="' + REL + '/officeDocument" Target="ppt/presentation.xml"/></Relationships>' },
      { name: 'ppt/presentation.xml', data: XML + '<p:presentation ' + NS + ' saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>' + slides.map((s, i) => '<p:sldId id="' + (256 + i) + '" r:id="rId' + (i + 2) + '"/>').join('') + '</p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>' },
      { name: 'ppt/_rels/presentation.xml.rels', data: XML + '<Relationships xmlns="' + PKG + '"><Relationship Id="rId1" Type="' + REL + '/slideMaster" Target="slideMasters/slideMaster1.xml"/>' + slides.map((s, i) => '<Relationship Id="rId' + (i + 2) + '" Type="' + REL + '/slide" Target="slides/slide' + (i + 1) + '.xml"/>').join('') + '<Relationship Id="rId' + (n + 2) + '" Type="' + REL + '/theme" Target="theme/theme1.xml"/></Relationships>' },
      { name: 'ppt/slideMasters/slideMaster1.xml', data: master },
      { name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', data: XML + '<Relationships xmlns="' + PKG + '"><Relationship Id="rId1" Type="' + REL + '/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="' + REL + '/theme" Target="../theme/theme1.xml"/></Relationships>' },
      { name: 'ppt/slideLayouts/slideLayout1.xml', data: layout },
      { name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', data: XML + '<Relationships xmlns="' + PKG + '"><Relationship Id="rId1" Type="' + REL + '/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>' },
      { name: 'ppt/theme/theme1.xml', data: theme },
    ];
    slides.forEach((s, i) => {
      files.push({ name: 'ppt/slides/slide' + (i + 1) + '.xml', data: slideXml(s) });
      files.push({ name: 'ppt/slides/_rels/slide' + (i + 1) + '.xml.rels', data: XML + '<Relationships xmlns="' + PKG + '"><Relationship Id="rId1" Type="' + REL + '/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>' });
    });
    return zip(files, 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
  }

  /* ---------- report content (straight from the dashboard's data) ---------- */
  const S = () => window.SM;
  const SOURCES_NOTE = 'Sources: BLS (LAUS unemployment, QCEW jobs, wages and business counts), Census ACS 5-year, BEA, Tennessee WARN notices, TNECD and news announcements tracked on the dashboard, EconVitals and FRED. Figures are as shown on the SoMidTN Dashboard on the date above; each carries its own period. Focus areas and steps are suggestions for review, not adopted policy. Compiled by Greg Lowe from public sources; not an official TNECD publication.';
  async function strategyData() {
    const s = S();
    await s.ready(['sp_facts', 'sp_counties', 'sp_clusters', 'programs', 'projects', 'warn', 'markets_tape', 'sp_employers']);
    const f = s.spF();
    if (!f) throw new Error('The Strategic plan data has not finished loading. Please try again in a moment.');
    return { s, f, sp: s.rowsOf('sp_counties') || [], cl: s.rowsOf('sp_clusters') || [], Q: s.spSwotData(), steps: s.spPlanSteps() || [], meas: s.spMeasureRows() || [], emp: (s.rowsOf('sp_employers') || []).filter((e) => e.shown) };
  }
  const ORDER = { 'Retain & expand': 0, 'Build on wins': 1, 'Market the workforce': 2, 'Prepare sites & product': 3 };
  const focusSort = (a, b) => ORDER[a.focus] - ORDER[b.focus] || (b.warn_workers - a.warn_workers) || ((a.mfg_chg_pct ?? 0) - (b.mfg_chg_pct ?? 0));
  function kpiRows(d) {
    const { s, f } = d;
    return [
      ['Region unemployment', f.rate != null ? s.f1(f.rate) + '%' : '—', (f.month || '') + (f.tn_rate != null ? '; Tennessee ' + s.f1(f.tn_rate) + '%' : '')],
      ['Manufacturing jobs', f.mfg_jobs != null ? s.int(f.mfg_jobs) : '—', (f.mfg_chg_pct != null ? s.sgn(f.mfg_chg_pct) + '% from a year earlier; ' : '') + (f.quarter || '')],
      ['Counties losing factory jobs', f.mfg_down + ' of ' + f.mfg_reporting, 'Tennessee ' + (f.tn_mfg_chg_pct != null ? s.sgn(f.tn_mfg_chg_pct) + '%' : '—') + ' over the same year'],
      ['Private business locations', f.estabs ? s.int(f.estabs) : '—', (f.estabs_chg_pct != null ? s.sgn(f.estabs_chg_pct) + '% from a year earlier; ' : '') + 'up in ' + f.estabs_up + ' of ' + f.estabs_reporting + ' counties'],
      ['Workers in WARN notices (24 months)', s.int(f.warn_workers), f.warn_notices + ' notice' + (f.warn_notices === 1 ? '' : 's')],
      ['Jobs in announced projects (24 months)', s.int(f.proj_jobs), f.proj_count + ' projects, $' + s.f1(f.proj_invest_m) + 'M, in ' + f.proj_counties + ' of 13 counties'],
    ];
  }
  async function strategyBlocks() {
    const d = await strategyData(), { s, f, sp, cl, Q, steps, meas, emp } = d;
    const B = [];
    B.push({ t: 'title', text: 'Strategic Plan: Business Retention, Expansion and Recruitment' });
    B.push({ t: 'subtitle', text: 'Southern Middle Tennessee, 13 counties. Generated ' + longDate() + ' from the SoMidTN Dashboard. Plan start: ' + s.dayFmt(s.planStart) + '.' });
    B.push({ t: 'h1', text: 'Where the region stands' });
    B.push({ t: 'table', head: ['Measure', 'Value', 'Detail'], widths: [3, 1.4, 4], rows: kpiRows(d) });
    if (Q) Object.entries(Q).forEach(([q, items]) => { B.push({ t: 'h2', text: q }); B.push({ t: 'bullets', items: items.length ? items.map((it) => ({ lead: '', text: it.text, src: it.src })) : ['Nothing flagged by the current data.'] }); });
    B.push({ t: 'h1', text: 'Action plan' });
    B.push({ t: 'table', head: ['#', 'Step', 'Phase and due date', 'What to do'], widths: [0.4, 2.2, 1.8, 6], rows: steps.map((st, i) => [String(i + 1), st.title, st.phase + ', due ' + st.due_label, st.text]) });
    B.push({ t: 'h1', text: 'County focus' });
    B.push({ t: 'note', text: 'Retain & expand: a WARN notice in the last 24 months, factory jobs down 5% or more from a year earlier, or manufacturing at 3 or more times the national share with jobs falling. Build on wins: announced projects in the last 24 months with 100 or more stated jobs. Market the workforce: unemployment at or above Tennessee. Prepare sites & product: none of these.' });
    B.push({ t: 'table', head: ['County', 'Focus', 'Why', 'Suggested first move'], widths: [1.1, 1.3, 3.2, 3.2], rows: sp.slice().sort(focusSort).map((r) => [r.county, r.focus, r.why || 'No flags', r.first_move]) });
    B.push({ t: 'h1', text: 'Retention and expansion watch list' });
    const top = (c) => emp.filter((e) => e.county === c).sort((a, b) => (b.employees ?? -1) - (a.employees ?? -1)).slice(0, 3).map((e) => e.company + (e.employees != null ? ' (' + s.int(e.employees) + ')' : '')).join('; ');
    B.push({ t: 'table', head: ['County', 'Largest disclosed manufacturing subsectors (jobs)', 'Largest listed employers', 'Factory jobs vs a year earlier', 'WARN notices (24 months)'], widths: [1, 3, 2.4, 1.4, 2.4], rows: sp.filter((r) => r.f_retention).sort((a, b) => (b.warn_workers - a.warn_workers) || ((a.mfg_chg_pct ?? 0) - (b.mfg_chg_pct ?? 0))).map((r) => [r.county, r.top_subsectors || 'Withheld by BLS', top(r.county) || 'None listed yet', r.mfg_chg_pct != null ? s.sgn(r.mfg_chg_pct) + '% (' + s.sgnInt(r.mfg_chg) + ')' : '—', r.warn_list || 'None']) });
    B.push({ t: 'h1', text: 'Recruitment targets: clusters the region already has' });
    B.push({ t: 'table', head: ['Cluster', 'Jobs', 'Counties', 'Largest in', 'Avg weekly pay'], widths: [3, 1, 1, 3, 1.4], rows: cl.slice(0, 8).map((r) => [r.subsector, s.int(r.jobs), String(r.counties), r.largest, r.wage_wk != null ? s.usd(r.wage_wk) : '—']) });
    B.push({ t: 'note', text: 'BLS QCEW, disclosed figures only, so totals are lower bounds.' });
    const wins = (s.rowsOf('projects') || []).filter((r) => String(r.announced || '') >= f.window_start).sort((a, b) => (a.announced < b.announced ? 1 : -1));
    if (wins.length) { B.push({ t: 'h2', text: 'Recent wins to build on' }); B.push({ t: 'table', head: ['Project', 'County', 'Sector', 'Jobs', 'Investment', 'Announced'], widths: [2.4, 1, 2.4, 0.8, 1, 1.2], rows: wins.map((r) => [r.project, r.county, r.sector, r.jobs != null ? s.int(r.jobs) : 'Not stated', r.investment_m != null ? '$' + s.f1(r.investment_m) + 'M' : 'Not stated', s.dayFmt(r.announced)]) }); }
    B.push({ t: 'h1', text: 'Measures to track' });
    B.push({ t: 'table', head: ['Measure', 'Now', 'As of', 'Goal'], widths: [3.2, 1.6, 1.4, 2.4], rows: meas });
    const progs = (s.rowsOf('programs') || []).filter((r) => ['Sites & infrastructure', 'Workforce', 'Energy & utilities'].includes(r.topic) && (!r.deadline || r.deadline >= s.todayStr())).sort((a, b) => ((a.deadline || '9999') < (b.deadline || '9999') ? -1 : 1));
    if (progs.length) { B.push({ t: 'h1', text: 'Funding and programs to use' }); B.push({ t: 'table', head: ['Program', 'Agency', 'Deadline', 'Amount', 'Link'], widths: [2.4, 1, 1.1, 2.4, 2.4], rows: progs.map((r) => [r.program, r.agency, r.deadline ? s.dayFmt(r.deadline) : 'None listed', r.amount_label, r.source_url]) }); }
    B.push({ t: 'note', text: SOURCES_NOTE });
    return B;
  }
  async function countyBlocks() {
    const s = S(), c = s.selCounty();
    await s.ready(['counties', 'labor_latest', 'pop_county', 'income_county', 'gdp_county', 'biz_county', 'edu_county', 'permits_latest', 'mfg_county', 'mfg_gdp', 'ag_county', 'acs_county', 'sp_counties', 'sp_facts', 'projects', 'warn', 'sp_employers', 'awards']);
    const one = (id) => (s.rowsOf(id) || []).find((r) => r.county === c) || {};
    const p = one('counties');
    if (!p.county) throw new Error('The county profile has not finished loading. Please try again in a moment.');
    const l = one('labor_latest'), po = one('pop_county'), inc = one('income_county'), g = one('gdp_county'), b = one('biz_county'), ed = one('edu_county'), bp = one('permits_latest'), m = one('mfg_county'), mg = one('mfg_gdp'), ag = one('ag_county'), a = one('acs_county'), st = one('sp_counties');
    const acs = a.period ? (/ACS/.test(a.period) ? String(a.period) : 'ACS 5-year ' + a.period) : 'ACS 5-year';
    const v = (x, fmt) => (x == null ? '—' : fmt(x));
    const B = [];
    B.push({ t: 'title', text: c + ' County Profile' });
    B.push({ t: 'subtitle', text: 'Southern Middle Tennessee. Seat: ' + (p.seat || '—') + '. ' + (p.tier_label || '') + '. Generated ' + longDate() + ' from the SoMidTN Dashboard.' });
    B.push({ t: 'h1', text: 'Key numbers' });
    B.push({ t: 'table', head: ['Measure', 'Value', 'Period'], widths: [3, 2, 2], rows: [
      ['Unemployment rate', v(l.rate, (x) => s.f1(x) + '%'), l.month || '—'],
      ['Labor force', v(l.lf, s.int), l.month || '—'],
      ['Population', v(po.pop, s.int), po.year ? String(po.year) : '—'],
      ['Population growth since ' + (po.base_year || '—'), v(po.chg_since_base_pct, (x) => s.sgn(x) + '%'), po.year ? (po.base_year || '') + '–' + po.year : '—'],
      ['Median household income', v(inc.mhi, (x) => '$' + s.int(x)), inc.year ? String(inc.year) : '—'],
      ['Poverty rate', v(inc.poverty, (x) => s.f1(x) + '%'), inc.year ? String(inc.year) : '—'],
      ['Per-capita income', v(inc.pcpi, (x) => '$' + s.int(x)), inc.pcpi_year ? String(inc.pcpi_year) : '—'],
      ['Real GDP (2017 dollars)', v(g.gdp_b, (x) => '$' + s.f2(x) + 'B'), g.year ? String(g.year) : '—'],
      ['Private business establishments', v(b.est, s.int), b.quarter || '—'],
      ['Manufacturing jobs', v(m.mfg_jobs, s.int) + (m.mfg_jobs_chg_pct != null ? ' (' + s.sgn(m.mfg_jobs_chg_pct) + '% from a year earlier)' : ''), m.quarter || '—'],
      ['Manufacturing share of private jobs', v(m.mfg_share_pct, (x) => s.f1(x) + '%'), m.quarter || '—'],
      ['Manufacturing location quotient', v(m.mfg_lq, s.f2), m.quarter || '—'],
      ['Manufacturing share of GDP', mg.withheld ? 'Withheld by BEA' : v(mg.mfg_share_pct, (x) => s.f1(x) + '%'), mg.year ? String(mg.year) : '—'],
      ["Adults with a bachelor's degree or more", v(ed.bach_pct, (x) => s.f1(x) + '%'), acs],
      ['Labor force participation', v(a.lfpr_pct, (x) => s.f1(x) + '%'), acs],
      ['Median age', v(a.median_age, s.f1), acs],
      ['Average commute (minutes)', v(a.commute_min, s.f1), acs],
      ['Households with broadband', v(a.broadband_pct, (x) => s.f1(x) + '%'), acs],
      ['Median home value', v(a.home_value, (x) => '$' + s.int(x)), acs],
      ['Housing units permitted', v(bp.units, s.int), bp.year ? String(bp.year) : '—'],
      ['Farm sales', v(ag.sales_m, (x) => '$' + s.f1(x) + 'M'), ag.year ? 'Census of Agriculture ' + ag.year : '—'],
    ] });
    if (st.focus) {
      B.push({ t: 'h1', text: 'Strategic focus' });
      B.push({ t: 'p', text: 'Focus: ' + st.focus + '. Why: ' + (st.why || 'no flags') + '.' });
      B.push({ t: 'p', text: 'Suggested first move: ' + st.first_move + '.' });
    }
    B.push({ t: 'h1', text: 'Place and assets' });
    B.push({ t: 'table', head: ['Item', 'Details'], widths: [1.6, 6], rows: [['Corridor', p.corridor], ['Top industrial site', p.top_park], ['Power provider', p.power], ['Anchor employers', p.anchors], ['Challenges', p.challenges]].filter((r) => r[1]) });
    B.push({ t: 'h1', text: 'Leaders and contacts' });
    B.push({ t: 'table', head: ['Role', 'Details'], widths: [1.6, 6], rows: [['County mayor', p.county_mayor], ['Economic development', p.ed_leader], ['City leaders', p.city_leaders], ['State legislators', p.state_legislators]].filter((r) => r[1]) });
    const emp = (s.rowsOf('sp_employers') || []).filter((e) => e.shown && e.county === c).sort((x, y) => (y.employees ?? -1) - (x.employees ?? -1));
    if (emp.length) { B.push({ t: 'h1', text: 'Major employers' }); B.push({ t: 'table', head: ['Company', 'Industry', 'Employees', 'Status', 'Source'], widths: [2.2, 2.2, 1, 2, 2.2], rows: emp.map((e) => [e.company, e.industry, e.employees != null ? s.int(e.employees) : (e.employees_note || '—'), e.status, e.source_url]) }); }
    const cut = (s.spF() || {}).window_start || '0000';
    const pr = (s.rowsOf('projects') || []).filter((r) => r.county === c && String(r.announced || '') >= cut);
    if (pr.length) { B.push({ t: 'h1', text: 'Announced projects (last 24 months)' }); B.push({ t: 'table', head: ['Project', 'Sector', 'Jobs', 'Investment', 'Announced'], widths: [2.4, 2.4, 0.8, 1, 1.2], rows: pr.map((r) => [r.project, r.sector, r.jobs != null ? s.int(r.jobs) : 'Not stated', r.investment_m != null ? '$' + s.f1(r.investment_m) + 'M' : 'Not stated', s.dayFmt(r.announced)]) }); }
    const aw = (s.rowsOf('awards') || []).filter((r) => String(r.county).split(/,\s*/).includes(c));
    if (aw.length) { B.push({ t: 'h1', text: 'State awards (2026)' }); B.push({ t: 'table', head: ['Recipient', 'Program', 'Amount', 'Purpose', 'Announced'], widths: [2.2, 1.8, 1, 3.2, 1.2], rows: aw.map((r) => [r.recipient, r.program, r.amount_label, r.purpose, s.dayFmt(r.announced)]) }); }
    const w = (s.rowsOf('warn') || []).filter((r) => r.county === c && String(r.notice_date || '') >= cut);
    if (w.length) { B.push({ t: 'h1', text: 'WARN notices (last 24 months)' }); B.push({ t: 'table', head: ['Company', 'City', 'Workers', 'Action', 'Notice date', 'Effective'], widths: [2.2, 1.2, 0.8, 1.2, 1.2, 1.2], rows: w.map((r) => [r.company, r.city, String(r.workers), r.action, s.dayFmt(r.notice_date), r.effective_date ? s.dayFmt(r.effective_date) : '—']) }); }
    B.push({ t: 'note', text: 'Profile checked ' + (p.profile_checked || '—') + '; contacts checked ' + (p.contacts_checked || '—') + '. ' + SOURCES_NOTE });
    return { B, c };
  }
  async function strategySlides() {
    const d = await strategyData(), { s, f, sp, cl, Q, steps, meas } = d;
    const NAVY = '1F3864', MUTED = '595959';
    const head = (t, sub) => [
      { k: 'rect', x: 0, y: 0, w: 13.333, h: 0.12, fill: NAVY },
      { k: 'text', x: 0.5, y: 0.3, w: 12.3, h: 0.7, paras: [{ text: t, size: 26, bold: true, color: NAVY }] },
      ...(sub ? [{ k: 'text', x: 0.5, y: 0.95, w: 12.3, h: 0.4, paras: [{ text: sub, size: 12, color: MUTED }] }] : []),
      { k: 'text', x: 0.5, y: 7.05, w: 12.3, h: 0.35, paras: [{ text: 'SoMidTN Dashboard, ' + longDate() + '. Compiled by Greg Lowe from public sources; not an official TNECD publication.', size: 9, color: '8C8C8C' }] },
    ];
    const slides = [];
    slides.push([
      { k: 'rect', x: 0, y: 0, w: 13.333, h: 7.5, fill: NAVY },
      { k: 'text', x: 0.8, y: 2.2, w: 11.7, h: 1.5, paras: [{ text: 'Strategic Plan: Business Retention, Expansion and Recruitment', size: 38, bold: true, color: 'FFFFFF' }] },
      { k: 'text', x: 0.8, y: 3.9, w: 11.7, h: 0.6, paras: [{ text: 'Southern Middle Tennessee, 13 counties', size: 20, color: 'D9E2F3' }] },
      { k: 'text', x: 0.8, y: 4.6, w: 11.7, h: 0.9, paras: [{ text: 'Generated ' + longDate() + ' from the SoMidTN Dashboard. Plan start: ' + s.dayFmt(s.planStart) + '.', size: 14, color: 'D9E2F3' }, { text: 'Compiled by Greg Lowe from public sources; not an official TNECD publication.', size: 12, color: 'B4C6E7' }] },
    ]);
    const kp = kpiRows(d);
    slides.push([...head('Where the region stands', 'Latest figures on the dashboard; each shows its own period'), ...kp.flatMap((r, i) => {
      const x = 0.5 + (i % 3) * 4.15, y = 1.6 + Math.floor(i / 3) * 2.6;
      return [{ k: 'text', x, y, w: 3.95, h: 2.35, fill: 'F2F5FA', line: 'D9E2F3', pad: 0.18, paras: [{ text: r[0], size: 13, color: MUTED }, { text: r[1], size: 32, bold: true, color: NAVY, after: 6 }, { text: r[2], size: 11, color: MUTED }] }];
    })]);
    if (Q) {
      const cols = { Strengths: '3AA676', Weaknesses: 'C0392B', Opportunities: '2A6FDB', Threats: 'E07B39' };
      slides.push([...head('Strengths, weaknesses, opportunities and threats'), ...Object.entries(Q).flatMap(([q, items], i) => {
        const x = 0.5 + (i % 2) * 6.2, y = 1.3 + Math.floor(i / 2) * 2.85;
        const paras = [{ text: q, size: 15, bold: true, color: NAVY, after: 4 }, ...(items.length ? items.slice(0, 4) : [{ text: 'Nothing flagged by the current data.' }]).map((it) => ({ text: it.text.length > 210 ? it.text.slice(0, 207) + '…' : it.text, size: 10.5, bullet: true, after: 3 }))];
        return [{ k: 'rect', x, y, w: 6.0, h: 0.07, fill: cols[q] }, { k: 'text', x, y: y + 0.1, w: 6.0, h: 2.65, line: 'E3E0D8', pad: 0.14, paras }];
      })]);
    }
    if (steps.length) slides.push([...head('Action plan', 'Plan start ' + s.dayFmt(s.planStart) + '; target dates are fixed from that day'), { k: 'table', x: 0.5, y: 1.5, w: 12.3, size: 10, widths: [0.35, 2.4, 1.9, 7.6], head: ['#', 'Step', 'Due', 'What to do'], rows: steps.map((st, i) => [String(i + 1), st.title, st.phase + ', ' + st.due_label, st.text.length > 230 ? st.text.slice(0, 227) + '…' : st.text]) }]);
    const sorted = sp.slice().sort(focusSort);
    [sorted.slice(0, 7), sorted.slice(7)].forEach((part, i) => { if (part.length) slides.push([...head('County focus' + (i ? ' (continued)' : ''), 'Click-through details are on the dashboard Strategic plan tab'), { k: 'table', x: 0.5, y: 1.5, w: 12.3, size: 11, widths: [1.3, 1.9, 9.1], head: ['County', 'Focus', 'Suggested first move'], rows: part.map((r) => [r.county, r.focus, r.first_move]) }]); });
    const bars = (title, sub, rows, fmt, ref) => {
      const els = [...head(title, sub)];
      const x0 = 0.5, lw = 1.6, top = 1.55, bw = 12.3 - lw, rowH = Math.min(0.42, 5.2 / Math.max(rows.length, 1));
      const vals = rows.map((r) => r.v).concat(ref ? [ref.v] : []);
      const lo = Math.min(0, ...vals), hi = Math.max(0, ...vals), span = hi - lo || 1;
      const padL = lo < 0 ? 1.05 : 0.1, padR = hi > 0 ? 1.05 : 0.1; // room for the value labels
      const X0 = (val) => x0 + lw + padL + ((val - lo) / span) * (bw - padL - padR);
      rows.forEach((r, i) => {
        const y = top + i * rowH, a = X0(Math.min(0, r.v)), z = X0(Math.max(0, r.v));
        els.push({ k: 'text', x: x0, y, w: lw - 0.1, h: rowH, anchor: 'ctr', pad: 0.02, paras: [{ text: r.label, size: 11, align: 'r', color: '333333' }] });
        els.push({ k: 'rect', x: a, y: y + rowH * 0.18, w: Math.max(0.02, z - a), h: rowH * 0.64, fill: r.v < 0 ? 'C0392B' : '2A6FDB' });
        els.push({ k: 'text', x: r.v < 0 ? a - 1.0 : z + 0.05, y, w: 0.95, h: rowH, anchor: 'ctr', pad: 0.02, paras: [{ text: fmt(r.v), size: 10, color: '333333', align: r.v < 0 ? 'r' : 'l' }] });
      });
      if (lo < 0) els.push({ k: 'rect', x: X0(0) - 0.01, y: top - 0.05, w: 0.02, h: rows.length * rowH + 0.1, fill: '7F7F7F' });
      if (ref) { const xr = X0(ref.v); els.push({ k: 'rect', x: xr - 0.01, y: top - 0.15, w: 0.02, h: rows.length * rowH + 0.25, fill: 'E07B39' }); els.push({ k: 'text', x: xr - 1.5, y: top - 0.5, w: 3, h: 0.35, paras: [{ text: ref.label, size: 10, color: 'E07B39', align: 'ctr' }] }); }
      return els;
    };
    const mf = sp.filter((r) => r.mfg_chg_pct != null).sort((a, b) => a.mfg_chg_pct - b.mfg_chg_pct).map((r) => ({ label: r.county, v: r.mfg_chg_pct }));
    if (mf.length) slides.push(bars('Factory jobs, change from a year earlier', 'Percent, ' + (f.quarter || '') + ' (BLS QCEW). Counties BLS withholds are not shown.', mf, (x) => s.sgn(x) + '%'));
    const ur = sp.filter((r) => r.rate != null).sort((a, b) => b.rate - a.rate).map((r) => ({ label: r.county, v: r.rate }));
    if (ur.length) slides.push(bars('Unemployment rate by county', 'Percent, ' + (f.month || '') + ' (BLS LAUS, not seasonally adjusted)', ur, (x) => s.f1(x) + '%', f.tn_rate != null ? { v: f.tn_rate, label: 'Tennessee ' + s.f1(f.tn_rate) + '%' } : null));
    if (cl.length) slides.push([...head('Recruitment targets: clusters the region already has', 'BLS QCEW, disclosed figures only (lower bounds)'), { k: 'table', x: 0.5, y: 1.5, w: 12.3, size: 12, widths: [3.4, 1.1, 1.1, 4, 1.6], head: ['Cluster', 'Jobs', 'Counties', 'Largest in', 'Avg weekly pay'], rows: cl.slice(0, 8).map((r) => [r.subsector, s.int(r.jobs), String(r.counties), r.largest, r.wage_wk != null ? s.usd(r.wage_wk) : '—']) }]);
    if (meas.length) slides.push([...head('Measures to track', 'Current values update with each data refresh'), { k: 'table', x: 0.5, y: 1.5, w: 12.3, size: 12, widths: [4.2, 2.4, 1.8, 3.6], head: ['Measure', 'Now', 'As of', 'Goal'], rows: meas }]);
    slides.push([...head('Sources and notes'), { k: 'text', x: 0.5, y: 1.4, w: 12.3, h: 5.2, paras: [{ text: SOURCES_NOTE, size: 14, color: '333333' }] }]);
    return slides;
  }

  /* ---------- buttons ---------- */
  const busy = (btn, on) => { if (!btn) return; btn.disabled = on; btn.classList.toggle('is-busy', on); };
  async function runReport(kind, fmt, btn) {
    busy(btn, true);
    try {
      if (kind === 'strategy') {
        const name = 'SoMidTN-Strategic-Plan-' + today();
        if (fmt === 'pptx') await save(name + '.pptx', pptx(await strategySlides()));
        else { const B = await strategyBlocks(); await save(name + '.' + fmt, fmt === 'pdf' ? pdf(B, 'SoMidTN Dashboard: Strategic Plan, ' + longDate()) : docx(B)); }
      } else if (kind === 'county') {
        const { B, c } = await countyBlocks();
        const name = 'SoMidTN-' + c + '-County-Profile-' + today();
        await save(name + '.' + fmt, fmt === 'pdf' ? pdf(B, 'SoMidTN Dashboard: ' + c + ' County Profile, ' + longDate()) : docx(B));
      }
    } catch (e) { toast(String(e && e.message ? e.message : e)); console.error(e); }
    busy(btn, false);
  }
  /* ---------- section (card) and tab downloads ---------- */
  const clean = (t) => String(t == null ? '' : t).replace(/[↗​]/g, '').replace(/\bRead more( \(\d+ more\))?|\bShow less\b/g, '').replace(/\s+/g, ' ').trim();
  const isShown = (el) => !!(el && el.getClientRects().length);
  const tabName = (sec) => { const t = document.querySelector('.sm-tab[data-tab="' + sec.id + '"]'); return t ? clean(t.textContent) : sec.id; };
  const idsIn = (root) => {
    const set = new Set();
    const add = (e) => String(e.dataset.source || '').split(/\s+/).forEach((x) => { if (x) set.add(x); });
    if (root.dataset && root.dataset.source) add(root);
    root.querySelectorAll('[data-source]').forEach(add);
    return [...set];
  };
  const rowsFor = (id) => { const d = dash.data(id); if (!d || d.status !== 'ok' || d.data == null) return null; return Array.isArray(d.data) ? d.data : [d.data]; };
  const cellVal = (v) => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : v);
  const toGrid = (rows, lead) => {
    const keys = [];
    rows.forEach((r) => { if (r && typeof r === 'object') Object.keys(r).forEach((k) => { if (!keys.includes(k)) keys.push(k); }); });
    return [(lead ? [lead[0]] : []).concat(keys), ...rows.map((r) => (lead ? [lead[1]] : []).concat(keys.map((k) => cellVal(r && r[k]))))];
  };
  const tableGrid = (table) => {
    const rows = [];
    table.querySelectorAll('tr').forEach((tr) => {
      const cells = [...tr.children].filter((c) => c.tagName === 'TH' || c.tagName === 'TD');
      if (cells.length) rows.push(cells.map((c) => { const a = c.querySelector('a[href]'); const t = clean(c.textContent); return a && /^Source/.test(t) ? a.href : t; }));
    });
    return rows;
  };
  async function runCard(fmt, btn) {
    busy(btn, true);
    try {
      const card = btn.closest('.sm-card');
      if (!card) return;
      const title = clean((card.querySelector('h3, h2') || {}).textContent) || 'section';
      const ids = idsIn(card);
      if (ids.length) await S().ready(ids);
      const tables = [...card.querySelectorAll('table')].filter(isShown);
      const data = ids.map((id) => ({ id, rows: rowsFor(id) })).filter((d) => d.rows && d.rows.length);
      const name = 'SoMidTN-' + slug(title) + '-' + today();
      if (fmt === 'csv') {
        let grid = null;
        if (tables.length) grid = tableGrid(tables[0]);
        else if (data.length === 1) grid = toGrid(data[0].rows);
        else if (data.length) {
          const keys = ['dataset'];
          data.forEach((d) => d.rows.forEach((r) => { if (r && typeof r === 'object') Object.keys(r).forEach((k) => { if (!keys.includes(k)) keys.push(k); }); }));
          grid = [keys, ...data.flatMap((d) => d.rows.map((r) => keys.map((k) => (k === 'dataset' ? d.id : cellVal(r && r[k])))))];
        }
        if (!grid) { toast('This section has no data to download yet.'); return; }
        await save(name + '.csv', new Blob([csv(grid)], { type: 'text/csv' }));
      } else {
        const sheets = tables.map((t, i) => ({ name: tables.length > 1 ? title.slice(0, 26) + ' ' + (i + 1) : title, rows: tableGrid(t) }))
          .concat(data.map((d) => ({ name: 'data ' + d.id, rows: toGrid(d.rows) })));
        if (!sheets.length) { toast('This section has no data to download yet.'); return; }
        await save(name + '.xlsx', xlsx(sheets));
      }
    } catch (e) { toast(String(e && e.message ? e.message : e)); console.error(e); }
    finally { busy(btn, false); }
  }
  async function runTabExcel(btn) {
    busy(btn, true);
    try {
      const sec = btn.closest('.sm-page');
      if (!sec) return;
      const name = tabName(sec), ids = idsIn(sec);
      if (ids.length) await S().ready(ids);
      const data = ids.map((id) => ({ id, rows: rowsFor(id) })).filter((d) => d.rows && d.rows.length);
      if (!data.length) { toast('This tab has no data to download yet.'); return; }
      const about = [['SoMidTN Dashboard', name], ['Generated', longDate()], ['What this is', 'Each sheet is one data source used on this tab, exactly as the dashboard loaded it. Each row carries its own dates; sources are named on the dashboard.'], ['Compiled by', 'Greg Lowe from public sources; not an official TNECD publication.'], ['', ''], ['Sheet', 'Rows']].concat(data.map((d) => [d.id, d.rows.length]));
      await save('SoMidTN-' + slug(name) + '-data-' + today() + '.xlsx', xlsx([{ name: 'About', rows: about }].concat(data.map((d) => ({ name: d.id, rows: toGrid(d.rows) })))));
    } catch (e) { toast(String(e && e.message ? e.message : e)); console.error(e); }
    finally { busy(btn, false); }
  }
  // A chart (SVG) as a JPEG picture for Word and PDF, drawn with the colors it has on screen.
  async function svgImage(svg) {
    const r = svg.getBoundingClientRect(), w = Math.round(r.width), hh = Math.round(r.height);
    if (w < 120 || hh < 60) return null;
    const clone = svg.cloneNode(true);
    const PROPS = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray', 'opacity', 'font-family', 'font-size', 'font-weight', 'text-anchor', 'dominant-baseline', 'visibility', 'display', 'color'];
    const copy = (from, to) => { const cs = getComputedStyle(from); PROPS.forEach((k) => { const v = cs.getPropertyValue(k); if (v) to.style.setProperty(k, v); }); };
    copy(svg, clone);
    const src = svg.querySelectorAll('*'), dst = clone.querySelectorAll('*');
    src.forEach((el, i) => { if (dst[i]) copy(el, dst[i]); });
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', w); clone.setAttribute('height', hh);
    if (!clone.getAttribute('viewBox')) clone.setAttribute('viewBox', '0 0 ' + w + ' ' + hh);
    const xml = new XMLSerializer().serializeToString(clone);
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('chart picture failed')); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml); });
    const k = 2, c = document.createElement('canvas');
    c.width = w * k; c.height = hh * k;
    const g = c.getContext('2d');
    let bg = 'rgb(255, 255, 255)';
    for (let e = svg; e; e = e.parentElement) { const v = getComputedStyle(e).backgroundColor; if (v && v !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(v)) { bg = v; break; } }
    g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
    const bin = atob(c.toDataURL('image/jpeg', 0.9).split(',')[1]), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { t: 'image', bytes, w: c.width, h: c.height };
  }
  async function tabBlocks(sec) {
    const name = tabName(sec), ids = idsIn(sec);
    if (ids.length) await S().ready(ids);
    await new Promise((r) => setTimeout(r, 400));
    const B = [{ t: 'title', text: 'SoMidTN Dashboard: ' + name }, { t: 'subtitle', text: 'Southern Middle Tennessee, 13 counties. Snapshot of the ' + name + ' tab as shown on ' + longDate() + '. Compiled by Greg Lowe from public sources; not an official TNECD publication.' }];
    sec.querySelectorAll(':scope > .sm-note').forEach((n) => { const t = isShown(n) && clean(n.innerText); if (t) B.push({ t: 'note', text: t }); });
    const kpiRow = (k) => { const part = (sel) => clean((k.querySelector(sel) || {}).innerText); const lab = part('.sm-kpi-label'); return lab ? [lab, part('.sm-kpi-value'), part('.sm-kpi-sub')] : [clean(k.innerText), '', '']; };
    const kpis = [...sec.querySelectorAll('.sm-kpi')].filter((k) => isShown(k) && !k.closest('.sm-card')).map(kpiRow);
    if (kpis.length) { B.push({ t: 'h1', text: 'Key numbers' }); B.push({ t: 'table', head: ['Measure', 'Value', 'Detail'], widths: [3, 1.6, 4], rows: kpis }); }
    for (const card of sec.querySelectorAll('.sm-card')) {
      if (!isShown(card)) continue;
      const hd = card.querySelector('h3, h2');
      B.push({ t: 'h1', text: hd ? clean(hd.innerText) : 'Section' });
      card.querySelectorAll(':scope > .sm-note').forEach((n) => { const t = isShown(n) && clean(n.innerText); if (t) B.push({ t: 'note', text: t }); });
      const ck = [...card.querySelectorAll('.sm-kpi')].filter(isShown).map(kpiRow);
      if (ck.length) B.push({ t: 'table', head: ['Measure', 'Value', 'Detail'], widths: [3, 1.6, 4], rows: ck });
      for (const t of card.querySelectorAll('table')) {
        if (!isShown(t)) continue;
        const g = tableGrid(t);
        if (g.length < 2) continue;
        const body = g.slice(1);
        B.push({ t: 'table', head: g[0], rows: body.slice(0, 150) });
        if (body.length > 150) B.push({ t: 'note', text: 'First 150 of ' + body.length + ' rows. The full table is in the Excel download.' });
      }
      const lis = [...card.querySelectorAll('li')].filter((li) => isShown(li) && !li.closest('table') && !(li.parentElement && li.parentElement.closest('li')));
      if (lis.length) {
        B.push({ t: 'bullets', items: lis.slice(0, 60).map((li) => clean(li.innerText).slice(0, 700)) });
        if (lis.length > 60) B.push({ t: 'note', text: 'First 60 of ' + lis.length + ' items.' });
      }
      const tiles = [...card.querySelectorAll('.sm-cards > *')].filter(isShown);
      if (tiles.length) B.push({ t: 'bullets', items: tiles.slice(0, 60).map((x) => clean(x.innerText).slice(0, 700)) });
      for (const dl of card.querySelectorAll('dl')) {
        if (!isShown(dl)) continue;
        const rows = [];
        dl.querySelectorAll('dt').forEach((dt) => { const dd = dt.nextElementSibling; rows.push([clean(dt.innerText), clean(dd && dd.innerText)]); });
        if (rows.length) B.push({ t: 'table', head: ['Item', 'Details'], widths: [1.6, 6], rows });
      }
      const svgs = [...card.querySelectorAll('svg')].filter((v) => isShown(v) && !v.closest('table') && !v.closest('button') && !(v.parentElement && v.parentElement.closest('svg'))).slice(0, 4);
      for (const v of svgs) { const pic = await svgImage(v).catch(() => null); if (pic) B.push(pic); }
    }
    B.push({ t: 'note', text: 'Figures are as shown on the SoMidTN Dashboard on the date above; each section names its sources and period. The Excel download for this tab has the underlying data.' });
    return { B, name };
  }
  async function runTabReport(fmt, btn) {
    busy(btn, true);
    try {
      const sec = btn.closest('.sm-page');
      if (!sec) return;
      const { B, name } = await tabBlocks(sec);
      await save('SoMidTN-' + slug(name) + '-' + today() + '.' + fmt, fmt === 'pdf' ? pdf(B, 'SoMidTN Dashboard: ' + name + ', ' + longDate()) : docx(B));
    } catch (e) { toast(String(e && e.message ? e.message : e)); console.error(e); }
    finally { busy(btn, false); }
  }
  document.addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-fmt]');
    if (!b) return;
    const bar = b.closest('[data-report]'), cardBar = b.closest('[data-dl="card"]');
    if (bar) {
      ev.preventDefault();
      if (b.dataset.fmt === 'xlsx') runTabExcel(b);
      else if (bar.dataset.report === 'tab') runTabReport(b.dataset.fmt, b);
      else runReport(bar.dataset.report, b.dataset.fmt, b);
      return;
    }
    if (cardBar) { ev.preventDefault(); runCard(b.dataset.fmt, b); }
  });
  /* ---------- "Use this dashboard with Claude": copy the saved instruction ---------- */
  document.addEventListener('click', async (ev) => {
    if (!ev.target.closest('#sm-howto-copy')) return;
    const ta = document.getElementById('sm-howto-text');
    if (!ta) return;
    let ok = false;
    try { await navigator.clipboard.writeText(ta.value); ok = true; } catch (e) { ok = false; }
    if (!ok) { ta.focus(); ta.select(); try { ok = document.execCommand('copy'); } catch (e) { ok = false; } }
    document.querySelectorAll('#sm-howto-ok').forEach((e) => { e.hidden = !ok; });
    document.querySelectorAll('#sm-howto-fail').forEach((e) => { e.hidden = ok; });
    if (!ok) { ta.focus(); ta.select(); }
  });
  window.SMExport = { csv, xlsx, docx, pdf, pptx, strategyBlocks, countyBlocks, strategySlides, tabBlocks };
})();
