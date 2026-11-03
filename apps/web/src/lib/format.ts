// 展示格式化：分数十分位 → 文本；时间本地化。
export function tenthsToText(tenths: number): string {
  return (tenths / 10).toFixed(1);
}

export function textToTenths(text: string): number | null {
  const value = Number(text);
  if (!Number.isFinite(value)) return null;
  const tenths = Math.round(value * 10);
  return tenths >= 0 && tenths <= 100 ? tenths : null;
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("zh-CN", { hour12: false });
}

export function shortHash(hash: string | null): string {
  return hash ? `${hash.slice(0, 12)}…` : "—";
}
