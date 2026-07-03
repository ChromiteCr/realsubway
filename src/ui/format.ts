/** 12345 -> "1.2万";890 -> "890" */
export function fmtRiders(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  return String(Math.round(n));
}
