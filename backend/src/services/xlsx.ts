/**
 * Minimal XLSX (SpreadsheetML) writer.
 *
 * Excel workbooks are ZIP archives of XML parts. Everything needed for a
 * multi-sheet, styled, formula-free report fits in ~200 lines against Node's
 * built-in `zlib`, so the export feature ships without pulling SheetJS (and its
 * transitive surface) into a hackathon deployment.
 *
 * Supported on purpose:
 *   - multiple worksheets
 *   - a bold, frozen header row with an autofilter
 *   - per-column widths
 *   - real numeric / date / currency cells, so Excel can sum and sort them
 */

import zlib from 'zlib';

export type CellValue = string | number | boolean | Date | null | undefined;

export type ColumnFormat = 'text' | 'number' | 'currency' | 'date' | 'datetime';

export interface SheetColumn {
  header: string;
  /** Width in Excel character units. Defaults to a value derived from the header. */
  width?: number;
  format?: ColumnFormat;
}

export interface SheetSpec {
  name: string;
  columns: SheetColumn[];
  rows: CellValue[][];
}

// ─── ZIP container ───────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ -1) >>> 0;
}

interface ZipEntry {
  name: string;
  data: Buffer;
}

/**
 * Builds a ZIP archive with deflate-compressed entries. Only the fields Excel
 * actually reads are populated; DOS timestamps are fixed so the same report
 * produces a byte-identical file, which makes the export diffable in tests.
 */
function buildZip(entries: ZipEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const compressed = zlib.deflateRawSync(entry.data, { level: 9 });
    const crc = crc32(entry.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(8, 8); // method: deflate
    local.writeUInt16LE(0, 10); // mod time
    local.writeUInt16LE(0x21, 12); // mod date (1980-01-01)
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra length

    localParts.push(local, nameBuf, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // central directory signature
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk number
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42);

    centralParts.push(central, nameBuf);

    offset += local.length + nameBuf.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

// ─── XML helpers ─────────────────────────────────────────────────────────────

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // Control characters are illegal in XML 1.0 and make Excel refuse the file.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

/** Excel column label: 0 -> A, 26 -> AA. */
function columnLetter(index: number): string {
  let n = index + 1;
  let label = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    label = String.fromCharCode(65 + rem) + label;
    n = Math.floor((n - 1) / 26);
  }
  return label;
}

/** Excel serial date: days since 1899-12-30, in the workbook's local sense. */
function toExcelSerial(date: Date): number {
  const ms = date.getTime() - new Date(Date.UTC(1899, 11, 30)).getTime();
  return ms / 86_400_000;
}

/**
 * Style indices defined in `styles.xml` below. Keeping them as named constants
 * avoids magic numbers drifting out of sync with the cellXfs order.
 */
const STYLE = {
  default: 0,
  header: 1,
  currency: 2,
  date: 3,
  datetime: 4,
  number: 5,
} as const;

function styleForFormat(format: ColumnFormat | undefined): number {
  switch (format) {
    case 'currency':
      return STYLE.currency;
    case 'date':
      return STYLE.date;
    case 'datetime':
      return STYLE.datetime;
    case 'number':
      return STYLE.number;
    default:
      return STYLE.default;
  }
}

function renderCell(ref: string, value: CellValue, format: ColumnFormat | undefined): string {
  const style = styleForFormat(format);
  const styleAttr = style ? ` s="${style}"` : '';

  if (value === null || value === undefined || value === '') {
    return `<c r="${ref}"${styleAttr}/>`;
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return `<c r="${ref}"${styleAttr}/>`;
    return `<c r="${ref}"${styleAttr}><v>${toExcelSerial(value)}</v></c>`;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return `<c r="${ref}"${styleAttr}/>`;
    return `<c r="${ref}"${styleAttr}><v>${value}</v></c>`;
  }

  if (typeof value === 'boolean') {
    return `<c r="${ref}"${styleAttr} t="b"><v>${value ? 1 : 0}</v></c>`;
  }

  return `<c r="${ref}"${styleAttr} t="inlineStr"><is><t xml:space="preserve">${escapeXml(String(value))}</t></is></c>`;
}

function renderSheet(sheet: SheetSpec): string {
  const cols = sheet.columns
    .map((col, i) => {
      const width = col.width ?? Math.min(48, Math.max(12, col.header.length + 4));
      return `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`;
    })
    .join('');

  const headerCells = sheet.columns
    .map((col, i) =>
      `<c r="${columnLetter(i)}1" s="${STYLE.header}" t="inlineStr"><is><t>${escapeXml(col.header)}</t></is></c>`,
    )
    .join('');

  const bodyRows = sheet.rows
    .map((row, rowIndex) => {
      const rowNumber = rowIndex + 2;
      const cells = sheet.columns
        .map((col, colIndex) =>
          renderCell(`${columnLetter(colIndex)}${rowNumber}`, row[colIndex], col.format),
        )
        .join('');
      return `<row r="${rowNumber}">${cells}</row>`;
    })
    .join('');

  const lastColumn = columnLetter(Math.max(0, sheet.columns.length - 1));
  const lastRow = sheet.rows.length + 1;

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetPr><outlinePr summaryBelow="1" summaryRight="1"/></sheetPr>
<dimension ref="A1:${lastColumn}${lastRow}"/>
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${cols}</cols>
<sheetData><row r="1" ht="20" customHeight="1">${headerCells}</row>${bodyRows}</sheetData>
<autoFilter ref="A1:${lastColumn}${lastRow}"/>
</worksheet>`;
}

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="3">
  <numFmt numFmtId="164" formatCode="&quot;₹&quot;#,##0"/>
  <numFmt numFmtId="165" formatCode="dd-mmm-yyyy"/>
  <numFmt numFmtId="166" formatCode="dd-mmm-yyyy hh:mm"/>
</numFmts>
<fonts count="2">
  <font><sz val="11"/><color theme="1"/><name val="Calibri"/></font>
  <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
</fonts>
<fills count="3">
  <fill><patternFill patternType="none"/></fill>
  <fill><patternFill patternType="gray125"/></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FF1D4ED8"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="6">
  <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
  <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf>
  <xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
  <xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
  <xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
  <xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/** Sheet names cannot exceed 31 chars or contain []:*?/\ */
function safeSheetName(name: string, index: number): string {
  const cleaned = name.replace(/[[\]:*?/\\]/g, '-').trim();
  return (cleaned || `Sheet${index + 1}`).slice(0, 31);
}

/**
 * Renders one or more sheets into a complete .xlsx file.
 * The result is a Buffer ready to stream straight to an HTTP response.
 */
export function buildWorkbook(sheets: SheetSpec[]): Buffer {
  const usable = sheets.length ? sheets : [{ name: 'Sheet1', columns: [{ header: 'Empty' }], rows: [] }];
  const names = usable.map((s, i) => safeSheetName(s.name, i));

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${usable
  .map(
    (_s, i) =>
      `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  )
  .join('\n')}
</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${names
    .map((name, i) => `<sheet name="${escapeXml(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join('')}</sheets>
</workbook>`;

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${usable
  .map(
    (_s, i) =>
      `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
  )
  .join('\n')}
<Relationship Id="rId${usable.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  const entries: ZipEntry[] = [
    { name: '[Content_Types].xml', data: Buffer.from(contentTypes, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(rootRels, 'utf8') },
    { name: 'xl/workbook.xml', data: Buffer.from(workbook, 'utf8') },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(workbookRels, 'utf8') },
    { name: 'xl/styles.xml', data: Buffer.from(STYLES_XML, 'utf8') },
    ...usable.map((sheet, i) => ({
      name: `xl/worksheets/sheet${i + 1}.xml`,
      data: Buffer.from(renderSheet(sheet), 'utf8'),
    })),
  ];

  return buildZip(entries);
}

/** CSV fallback for clients that prefer plain text. */
export function buildCsv(sheet: SheetSpec): string {
  const cell = (value: CellValue): string => {
    if (value === null || value === undefined) return '';
    const text = value instanceof Date ? value.toISOString() : String(value);
    return `"${text.replace(/"/g, '""')}"`;
  };

  return [
    sheet.columns.map((c) => cell(c.header)).join(','),
    ...sheet.rows.map((row) => sheet.columns.map((_c, i) => cell(row[i])).join(',')),
  ].join('\r\n');
}
