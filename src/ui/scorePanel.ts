import type { ScoreKey, ScorePart } from "../sim/engine";
import type { SimClient } from "../sim/simClient";
import { fmtRiders } from "./format";

/** 点击日报「综合评分」磁贴时派发,由本面板监听 */
export const SCORE_DETAIL_EVENT = "realsubway:score-detail";
/** 别的浮层要占同一片位置时派发,收起本面板 */
export const SCORE_CLOSE_EVENT = "realsubway:score-close";

interface DimMeta {
  label: string;
  hint: string;
  fmt: (v: number) => string;
}

/** 分项的展示元数据(引擎只给数值,标签与单位在 UI 侧) */
const DIMS: Record<ScoreKey, DimMeta> = {
  coverage: {
    label: "人口覆盖",
    hint: "车站集水区(800m)并集覆盖的常住人口占比",
    fmt: (v) => `${(v * 100).toFixed(1)}%`,
  },
  volume: {
    label: "运输规模",
    hint: "日送达出行量——线网到底运了多少人",
    fmt: (v) => `${fmtRiders(v)}/日`,
  },
  intensity: {
    label: "运输效率",
    hint: "站均日进出站量——车站是否修在有人的地方",
    fmt: (v) => `${fmtRiders(v)}/站`,
  },
  service: {
    label: "服务质量",
    hint: "1 − 未送达率 − 拥挤惩罚;基准取设计目标 90%",
    fmt: (v) => `${(v * 100).toFixed(1)}%`,
  },
  economy: {
    label: "经济效益",
    hint: "成本回收率 = 票款 ÷(运营 + 摊销)",
    fmt: (v) => `${(v * 100).toFixed(1)}%`,
  },
};

function barColor(score: number): string {
  if (score >= 85) return "#1f8a4c";
  if (score >= 70) return "#2f6fb3";
  if (score >= 60) return "#d68910";
  return "#c0392b";
}

function buildRow(part: ScorePart): HTMLElement {
  const meta = DIMS[part.key];
  const row = document.createElement("div");
  row.className = "score-row";
  row.title = meta.hint;

  const head = document.createElement("div");
  head.className = "score-row-head";
  const label = document.createElement("span");
  label.className = "score-row-label";
  label.textContent = meta.label;
  const weight = document.createElement("span");
  weight.className = "score-row-weight";
  weight.textContent = `权重 ${(part.weight * 100).toFixed(0)}%`;
  const val = document.createElement("span");
  val.className = "score-row-score";
  val.textContent = part.score.toFixed(0);
  val.style.color = barColor(part.score);
  head.append(label, weight, val);

  const track = document.createElement("div");
  track.className = "score-bar";
  const fill = document.createElement("div");
  fill.className = "score-bar-fill";
  fill.style.width = `${Math.max(0, Math.min(100, part.score))}%`;
  fill.style.background = barColor(part.score);
  // 现网基准(85 分)刻度线,一眼看出比现网强还是弱
  const mark = document.createElement("div");
  mark.className = "score-bar-mark";
  track.append(fill, mark);

  const detail = document.createElement("div");
  detail.className = "score-row-detail";
  detail.textContent = `本网 ${meta.fmt(part.value)} · 基准 ${meta.fmt(part.ref)}`;

  row.append(head, track, detail);
  return row;
}

/**
 * 分项评分面板(M5a6):点击日报「综合评分」磁贴唤起。
 * 综合分 = Σ 分项分 × 权重,每个分项都以真实北京现网为 85 分(B)基准。
 */
export function createScorePanel(container: HTMLElement, sim: SimClient): void {
  let open = false;

  const panel = document.createElement("div");
  panel.className = "score-panel";
  panel.hidden = true;
  container.appendChild(panel);

  const render = (): void => {
    panel.hidden = !open;
    if (!open) return;
    panel.innerHTML = "";

    const header = document.createElement("div");
    header.className = "score-header";
    const title = document.createElement("div");
    title.className = "score-title";
    title.textContent = "综合评分";
    const grade = document.createElement("div");
    grade.className = "score-grade";
    grade.textContent = sim.grade();
    const num = document.createElement("div");
    num.className = "score-number";
    num.textContent = sim.hasData ? sim.rating().toFixed(1) : "—";
    const close = document.createElement("button");
    close.textContent = "✕";
    close.title = "关闭";
    close.addEventListener("click", () => {
      open = false;
      render();
    });
    header.append(title, grade, num, close);
    panel.appendChild(header);

    const parts = sim.scoreParts();
    if (parts.length === 0) {
      const empty = document.createElement("div");
      empty.className = "score-empty";
      empty.textContent = sim.state === "computing" ? "计算中…" : "还没有可评分的线网";
      panel.appendChild(empty);
      return;
    }

    for (const p of parts) panel.appendChild(buildRow(p));

    const foot = document.createElement("div");
    foot.className = "score-foot";
    foot.textContent =
      `各分项以真实北京现网为 85 分(B)基准,竖线即基准位;` +
      `覆盖 ${fmtRiders(sim.coveredPopulation())}人。想拿 A 得比现网铺得更广、运得更多。`;
    panel.appendChild(foot);
  };

  document.addEventListener(SCORE_DETAIL_EVENT, () => {
    open = !open;
    render();
  });
  document.addEventListener(SCORE_CLOSE_EVENT, () => {
    if (!open) return;
    open = false;
    render();
  });
  sim.subscribe(render);
  render();
}
