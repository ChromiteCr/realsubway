import type { Network } from "../model/network";
import type { SimClient } from "../sim/simClient";
import { fmtRiders } from "./format";

/**
 * 运输量排行榜(M5a3):右下角按钮唤起,按各线运输量降序列出。
 * 面板打开时随网络/模拟变化刷新。
 */
export function createRankingPanel(
  container: HTMLElement,
  network: Network,
  sim: SimClient,
): void {
  let open = false;

  const panel = document.createElement("div");
  panel.className = "ranking-panel";
  panel.hidden = true;

  const btn = document.createElement("button");
  btn.className = "ranking-toggle";
  btn.textContent = "🏆 运输量排行";
  btn.addEventListener("click", () => {
    open = !open;
    btn.classList.toggle("primary", open);
    renderPanel();
  });

  container.append(panel, btn);

  const renderPanel = () => {
    panel.hidden = !open;
    if (!open) return;
    panel.innerHTML = "";

    const title = document.createElement("div");
    title.className = "ranking-title";
    title.textContent = "线路运输量排行";
    panel.appendChild(title);

    const ranked = network.lines
      .map((l) => ({ line: l, vol: sim.lineVolume(l.id) }))
      .sort((a, b) => b.vol - a.vol);

    if (ranked.length === 0) {
      const empty = document.createElement("div");
      empty.className = "ranking-empty";
      empty.textContent = "还没有线路";
      panel.appendChild(empty);
      return;
    }

    const list = document.createElement("div");
    list.className = "ranking-list";
    ranked.forEach((r, i) => {
      const row = document.createElement("div");
      row.className = "ranking-row";
      const rank = document.createElement("span");
      rank.className = "ranking-rank";
      rank.textContent = String(i + 1);
      const dot = document.createElement("span");
      dot.className = "ranking-dot";
      dot.style.background = r.line.color;
      const name = document.createElement("span");
      name.className = "ranking-name";
      name.textContent = r.line.name;
      const vol = document.createElement("span");
      vol.className = "ranking-vol";
      vol.textContent = sim.hasData ? `${fmtRiders(r.vol)}/日` : "—";
      row.append(rank, dot, name, vol);
      list.appendChild(row);
    });
    panel.appendChild(list);
  };

  network.subscribe(renderPanel);
  sim.subscribe(renderPanel);
  renderPanel();
}
