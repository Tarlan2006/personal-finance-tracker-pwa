/** RFC 4180-совместимый разбор: кавычки, переносы строк внутри ячеек, BOM. Возвращает все строки, включая пустые посередине. */
export function parseCsv(text: string, delimiter?: string): { rows: string[][]; lines: number[]; delimiter: string } {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const d = delimiter ?? detectDelimiter(text);
  const rows: string[][] = []; const lines: number[] = [];
  let row: string[] = [], cell = '', q = false, line = 1, rowLine = 1;
  const endRow = () => { row.push(cell); cell = ''; rows.push(row); lines.push(rowLine); row = []; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else { if (ch === '\n') line++; cell += ch; }
    } else if (ch === '"' && cell === '') q = true;
    else if (ch === d) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      endRow(); line++; rowLine = line;
    } else cell += ch;
  }
  if (cell !== '' || row.length) endRow();
  return { rows, lines, delimiter: d };
}
function detectDelimiter(text: string): string {
  const head = text.slice(0, 4000).split(/\r?\n/).slice(0, 5).join('\n');
  const counts = [';', ',', '\t'].map(c => [c, head.split(c).length - 1] as const);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ',';
}
