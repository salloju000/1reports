/**
 * Reads the first worksheet of an .xlsx file into rows of display strings, so a report's data-only
 * Excel export can be shown as a table. Uses the browser's own DecompressionStream; no library.
 * Returns null when the file is not a readable workbook (for example a legacy .xls).
 */
export async function readWorkbook(data: ArrayBuffer): Promise<string[][] | null> {
  const files = await unzip(data, name => name === "xl/sharedStrings.xml" || name === "xl/styles.xml"
    || /^xl\/worksheets\/sheet\d+\.xml$/.test(name));
  if (!files) return null;
  const sheetName = [...files.keys()].filter(name => name.startsWith("xl/worksheets/"))
    .sort((a, b) => sheetNumber(a) - sheetNumber(b))[0];
  if (!sheetName) return null;
  const parser = new DOMParser();
  const xml = (name: string) => files.has(name) ? parser.parseFromString(files.get(name)!, "application/xml") : null;
  const shared = [...(xml("xl/sharedStrings.xml")?.getElementsByTagName("si") ?? [])].map(item =>
    [...item.getElementsByTagName("t")].map(text => text.textContent ?? "").join(""));
  const dateStyles = readDateStyles(xml("xl/styles.xml"));
  const sheet = xml(sheetName);
  if (!sheet) return null;

  const rows: string[][] = [];
  for (const row of sheet.getElementsByTagName("row")) {
    const cells: string[] = [];
    let next = 0;
    for (const cell of row.getElementsByTagName("c")) {
      const reference = cell.getAttribute("r");
      const column = reference ? columnIndex(reference) : next;
      next = column + 1;
      cells[column] = cellText(cell, shared, dateStyles);
    }
    rows.push(Array.from(cells, value => value ?? ""));
  }
  return tidy(rows);
}

function sheetNumber(name: string) {
  return Number(/sheet(\d+)\.xml$/.exec(name)?.[1] ?? 0);
}

function columnIndex(reference: string) {
  let index = 0;
  for (const letter of reference.replace(/\d+$/, "").toUpperCase()) index = index * 26 + letter.charCodeAt(0) - 64;
  return index - 1;
}

function cellText(cell: Element, shared: string[], dateStyles: Set<number>) {
  const type = cell.getAttribute("t");
  const value = cell.getElementsByTagName("v")[0]?.textContent ?? "";
  if (type === "s") return shared[Number(value)] ?? "";
  if (type === "inlineStr")
    return [...cell.getElementsByTagName("t")].map(text => text.textContent ?? "").join("");
  if (type === "b") return value === "1" ? "Yes" : "No";
  if (type === "str" || type === "e" || value === "") return value;
  const number = Number(value);
  if (!Number.isFinite(number)) return value;
  if (dateStyles.has(Number(cell.getAttribute("s") ?? -1))) return excelDate(number);
  return Number.isInteger(number) ? String(number) : String(Math.round(number * 1e6) / 1e6);
}

/** Style indexes whose number format shows a date or time. */
function readDateStyles(styles: Document | null) {
  const dates = new Set<number>();
  if (!styles) return dates;
  const builtIn = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);
  const custom = new Set<number>();
  for (const format of styles.getElementsByTagName("numFmt")) {
    const code = (format.getAttribute("formatCode") ?? "").replace(/"[^"]*"|\[[^\]]*\]/g, "");
    if (/[dmyhs]/i.test(code)) custom.add(Number(format.getAttribute("numFmtId")));
  }
  const xfs = styles.getElementsByTagName("cellXfs")[0];
  [...(xfs?.getElementsByTagName("xf") ?? [])].forEach((xf, index) => {
    const id = Number(xf.getAttribute("numFmtId") ?? 0);
    if (builtIn.has(id) || custom.has(id)) dates.add(index);
  });
  return dates;
}

function excelDate(serial: number) {
  const date = new Date(Math.round((serial - 25569) * 86400000));
  const pad = (value: number) => String(value).padStart(2, "0");
  const day = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  const seconds = Math.round((serial % 1) * 86400);
  return seconds ? `${day} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}` : day;
}

/** Drops empty rows and columns, and pads every row to the same width. */
function tidy(rows: string[][]) {
  const kept = rows.filter(row => row.some(value => value.trim() !== ""));
  const width = Math.max(0, ...kept.map(row => row.length));
  const used = Array.from({ length: width }, (_, column) => kept.some(row => (row[column] ?? "").trim() !== ""));
  return kept.map(row => used.flatMap((keep, column) => keep ? [row[column] ?? ""] : []));
}

async function unzip(data: ArrayBuffer, wanted: (name: string) => boolean): Promise<Map<string, string> | null> {
  const view = new DataView(data);
  let end = -1;
  for (let offset = data.byteLength - 22; offset >= Math.max(0, data.byteLength - 65557); offset--) {
    if (view.getUint32(offset, true) === 0x06054b50) { end = offset; break; }
  }
  if (end < 0) return null;
  const count = view.getUint16(end + 10, true);
  let entry = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  const files = new Map<string, string>();
  for (let index = 0; index < count; index++) {
    if (view.getUint32(entry, true) !== 0x02014b50) return null;
    const method = view.getUint16(entry + 10, true);
    const size = view.getUint32(entry + 20, true);
    const nameLength = view.getUint16(entry + 28, true);
    const extraLength = view.getUint16(entry + 30, true);
    const commentLength = view.getUint16(entry + 32, true);
    const local = view.getUint32(entry + 42, true);
    const name = decoder.decode(new Uint8Array(data, entry + 46, nameLength));
    entry += 46 + nameLength + extraLength + commentLength;
    if (!wanted(name)) continue;
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const bytes = new Uint8Array(data, start, size);
    if (method === 0) files.set(name, decoder.decode(bytes));
    else if (method === 8) files.set(name, await inflate(bytes));
    else return null;
  }
  return files;
}

async function inflate(bytes: Uint8Array) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Response(stream).text();
}
