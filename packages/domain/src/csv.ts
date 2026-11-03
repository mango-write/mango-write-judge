// CSV 输出：RFC 4180 转义（引号/逗号/换行）+ 公式注入防护（= + - @ 与制表/回车
// 开头的文本单元格前加 '）。UTF-8 BOM 由调用方拼接。
export const UTF8_BOM = "\uFEFF";

export type CsvCell = string | number | null | undefined;

export function csvCell(value: CsvCell): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "number" ? (Number.isFinite(value) ? String(value) : "") : value;
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

export function csvLine(cells: readonly CsvCell[]): string {
  return cells
    .map((cell) => {
      const text = csvCell(cell);
      return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    })
    .join(",");
}

export function toCsv(header: readonly CsvCell[], rows: readonly (readonly CsvCell[])[]): string {
  return [csvLine(header), ...rows.map(csvLine)].join("\r\n");
}
