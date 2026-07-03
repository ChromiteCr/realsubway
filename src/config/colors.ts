/** 新建线路依次取色的调色板,色系参考北京地铁线路色 */
export const LINE_PALETTE = [
  "#c23a30",
  "#006098",
  "#009d6b",
  "#a6217f",
  "#d29700",
  "#00a3e0",
  "#f08300",
  "#8fc31f",
  "#e40077",
  "#5f2c1f",
  "#7b68ee",
  "#2e8b57",
  "#9a6900",
  "#d385b5",
  "#708090",
] as const;

export function pickLineColor(indexOfLine: number): string {
  return LINE_PALETTE[indexOfLine % LINE_PALETTE.length]!;
}
