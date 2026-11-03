import { describe, expect, it } from "vitest";

import { UTF8_BOM, csvCell, csvLine, toCsv } from "../src";

describe("csvCell 公式注入防护", () => {
  it("= + - @ 与制表符开头的文本加单引号前缀", () => {
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvCell("+cmd")).toBe("'+cmd");
    expect(csvCell("-2d")).toBe("'-2d");
    expect(csvCell("@x")).toBe("'@x");
    expect(csvCell("\ttab")).toBe("'\ttab");
  });

  it("普通文本与数字不动", () => {
    expect(csvCell("创新性")).toBe("创新性");
    expect(csvCell(8.7)).toBe("8.7");
    expect(csvCell("8.7 分")).toBe("8.7 分");
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });
});

describe("csvLine / toCsv RFC 4180", () => {
  it("含逗号/引号/换行的字段加引号并转义", () => {
    expect(csvLine(["a,b", 'say "hi"', "line1\nline2", "plain"])).toBe(
      '"a,b","say ""hi""","line1\nline2",plain',
    );
  });

  it("行以 CRLF 连接", () => {
    const out = toCsv(["h1", "h2"], [["a", "b"], ["c", "d"]]);
    expect(out).toBe("h1,h2\r\na,b\r\nc,d");
    expect(out.endsWith("\r\n")).toBe(false);
  });

  it("BOM 常量存在且为 U+FEFF", () => {
    expect(UTF8_BOM).toBe("\uFEFF");
  });
});
