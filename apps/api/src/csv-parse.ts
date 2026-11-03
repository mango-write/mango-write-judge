// 最小 RFC 4180 解析器：双引号包裹、"" 转义、逗号分隔、\r\n 或 \n 行尾、剥 BOM。
// 只服务于管理端导入（小文件），不接受引号未闭合的输入。
export const MAX_CSV_BYTES = 1024 * 1024;
export const MAX_CSV_ROWS = 250;

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    // 全空行（含仅空字段的尾行）跳过
    if (row.length > 1 || row[0] !== "") rows.push(row);
    row = [];
  };

  while (i < src.length) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          quoted = false;
          i += 1;
        }
      } else {
        field += ch;
        i += 1;
      }
      continue;
    }
    if (ch === '"' && field === "") {
      quoted = true;
      i += 1;
    } else if (ch === ",") {
      pushField();
      i += 1;
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i += 1;
      pushRow();
      i += 1;
    } else {
      field += ch;
      i += 1;
    }
  }
  if (field !== "" || row.length > 0) pushRow();
  if (quoted) throw new Error("CSV 引号未闭合");
  if (rows.length > MAX_CSV_ROWS) throw new Error(`CSV 超过 ${MAX_CSV_ROWS} 行`);
  return rows;
}

/** 首行按表头识别：命中任一已知表头名进入表头模式，否则按位置列处理。 */
export function mapRows(
  rows: string[][],
  headerAliases: readonly (readonly string[])[],
): Record<string, string>[] {
  if (rows.length === 0) return [];
  const first = rows[0]!.map((h) => h.trim().toLowerCase());
  const hasHeader = headerAliases.some((aliases) =>
    first.some((cell) => aliases.some((a) => a.toLowerCase() === cell)),
  );
  const body = hasHeader ? rows.slice(1) : rows;
  const columns = headerAliases.map((aliases, index) => {
    if (!hasHeader) return index;
    const found = first.findIndex((cell) => aliases.some((a) => a.toLowerCase() === cell));
    return found >= 0 ? found : -1;
  });
  return body.map((cells) => {
    const record: Record<string, string> = {};
    headerAliases.forEach((aliases, index) => {
      const key = aliases[0]!;
      const col = columns[index]!;
      record[key] = (col >= 0 ? cells[col] : cells[index] ?? "")?.trim() ?? "";
    });
    return record;
  });
}
