'use strict';
/**
 * تولید فایل Excel واقعی (xlsx) بدون وابستگی خارجی
 *  - راست‌به‌چپ، سطر عنوان پررنگ و ثابت (freeze)، عرض ستون خودکار، اعداد به‌صورت عدد
 *  - رشته‌ها به‌صورت inlineStr (بدون جدول sharedStrings) → ساده و سریع
 */
const zip = require('./zip');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  // کاراکترهای کنترلی غیرمجاز در XML
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

function colName(i) { let s = ''; i += 1; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }

function cell(ref, v, style) {
  if (v == null || v === '') return '';
  const st = style ? ` s="${style}"` : '';
  if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${st}><v>${v}</v></c>`;
  if (typeof v === 'boolean') return `<c r="${ref}" t="b"${st}><v>${v ? 1 : 0}</v></c>`;
  const s = String(v);
  return `<c r="${ref}" t="inlineStr"${st}><is><t xml:space="preserve">${esc(s)}</t></is></c>`;
}

/** طول تقریبی برای عرض ستون */
function width(s) { return Math.min(60, Math.max(8, [...String(s == null ? '' : s)].length * 1.15 + 2)); }

/**
 * ساخت xlsx. sheets = [{ name, header: [..], rows: [[..], ..] }] یا یک شیت (header, rows)
 * @returns {Buffer}
 */
function build(input) {
  const sheets = Array.isArray(input) ? input : [input];
  const files = [];
  const sheetXml = (sh) => {
    const header = sh.header || [];
    const rows = sh.rows || [];
    const widths = header.map((h) => width(h));
    const out = [];
    out.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
    out.push('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">');
    out.push(`<sheetViews><sheetView rightToLeft="1" workbookViewId="0"${header.length ? ' tabSelected="1"' : ''}>${header.length ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' : ''}</sheetView></sheetViews>`);
    out.push('<sheetFormatPr defaultRowHeight="18"/>');
    const body = [];
    let r = 1;
    if (header.length) { body.push(`<row r="${r}">${header.map((h, i) => cell(`${colName(i)}${r}`, h, 1)).join('')}</row>`); r++; }
    for (const row of rows) {
      const cells = [];
      row.forEach((v, i) => { if (widths[i] == null) widths[i] = 8; widths[i] = Math.max(widths[i], Math.min(60, width(v))); const c = cell(`${colName(i)}${r}`, v, typeof v === 'number' ? 2 : 0); if (c) cells.push(c); });
      body.push(`<row r="${r}">${cells.join('')}</row>`); r++;
    }
    if (widths.length) out.push(`<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w.toFixed(1)}" customWidth="1"/>`).join('')}</cols>`);
    out.push(`<sheetData>${body.join('')}</sheetData>`);
    if (header.length && rows.length) out.push(`<autoFilter ref="A1:${colName(header.length - 1)}${rows.length + 1}"/>`);
    out.push('</worksheet>');
    return out.join('');
  };
  const names = sheets.map((sh, i) => esc((sh.name || `Sheet${i + 1}`).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31)));
  files.push({ name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>` });
  files.push({ name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>' });
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  files.push({ name: 'docProps/core.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>سامانه مدیریت مدرسه</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created></cp:coreProperties>` });
  files.push({ name: 'docProps/app.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>School Management System</Application></Properties>' });
  files.push({ name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${sheets.map((_, i) => `<sheet name="${names[i]}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>` });
  files.push({ name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` });
  files.push({ name: 'xl/styles.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.##"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Tahoma"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Tahoma"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF2563EB"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>' });
  sheets.forEach((sh, i) => files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(sh) }));
  return zip.build(files);
}

/** تبدیل سطرها + ستون‌ها (همان قالب toCSV: [{ key|value, label }]) به xlsx */
function fromColumns(rows, columns, sheetName) {
  const header = columns.map((c) => c.label);
  const data = rows.map((r) => columns.map((c) => {
    const v = typeof c.value === 'function' ? c.value(r) : r[c.key];
    if (v == null) return '';
    if (typeof v === 'number') return v;
    return typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) && v.length < 16 && !/^0\d/.test(v) && !c.text ? Number(v) : v;
  }));
  return build({ name: sheetName || 'Sheet1', header, rows: data });
}

const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

module.exports = { build, fromColumns, MIME };
