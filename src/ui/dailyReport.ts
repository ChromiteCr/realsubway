import type { SimClient } from "../sim/simClient";
import { fmtRiders } from "./format";
import { SCORE_DETAIL_EVENT } from "./scorePanel";

/** 金额(元/日)→ "±X.X亿/万" */
function fmtMoney(yuan: number): string {
  const sign = yuan < 0 ? "−" : "";
  const abs = Math.abs(yuan);
  if (abs >= 1e8) return `${sign}${(abs / 1e8).toFixed(2)}亿`;
  if (abs >= 1e4) return `${sign}${(abs / 1e4).toFixed(0)}万`;
  return `${sign}${Math.round(abs)}`;
}

/** 三参数日报:运输总量 / 经济利润 / 综合评分 */
export function buildDailyReport(sim: SimClient): HTMLElement {
  const root = document.createElement("div");
  root.className = "daily-report";

  if (!sim.hasData) {
    root.textContent = "三参数:暂无数据";
    return root;
  }
  if (sim.state === "computing") {
    root.textContent = "三参数:计算中…";
    return root;
  }

  const tiles: { label: string; value: string; cls?: string; title?: string; detail?: boolean }[] = [
    { label: "运输总量", value: `${fmtRiders(sim.total())}/日` },
    {
      label: "日利润",
      value: fmtMoney(sim.profitPerDay()),
      cls: sim.profitPerDay() >= 0 ? "pos" : "neg",
      title: `票款 ${fmtMoney(sim.economy().fare)} − 运营 ${fmtMoney(sim.economy().opex)} − 摊销 ${fmtMoney(sim.economy().amortization)}`,
    },
    {
      label: "综合评分",
      value: sim.grade(),
      title: `数值 ${sim.rating().toFixed(1)} · 点击看分项评分`,
      detail: true,
    },
  ];

  for (const t of tiles) {
    const tile = document.createElement("div");
    tile.className = "report-tile";
    if (t.title) tile.title = t.title;
    if (t.detail) {
      // 点评分磁贴 → 唤起分项评分面板(M5a6)
      tile.classList.add("clickable");
      tile.addEventListener("click", () => {
        document.dispatchEvent(new CustomEvent(SCORE_DETAIL_EVENT));
      });
    }
    const val = document.createElement("div");
    val.className = "report-value" + (t.cls ? ` ${t.cls}` : "");
    val.textContent = t.value;
    const lab = document.createElement("div");
    lab.className = "report-label";
    lab.textContent = t.label;
    tile.append(val, lab);
    root.appendChild(tile);
  }

  const sub = document.createElement("div");
  sub.className = "report-sub";
  sub.textContent = `分担率 ${(sim.modeShare() * 100).toFixed(0)}%`;
  if (sim.unserved() > 1000) sub.textContent += ` · 未送达 ${fmtRiders(sim.unserved())}`;
  root.appendChild(sub);

  return root;
}
