import type { Network } from "../model/network";
import type { EditorState } from "./editorState";

/**
 * 铺设提示浮层(左下角):仅在铺设模式显示当前铺设方向、
 * 起点/终点车站、最近铺设的车站,以及切换方向/形成环线按钮。
 */
export function createEditHint(
  container: HTMLElement,
  network: Network,
  editor: EditorState,
): void {
  const root = document.createElement("div");
  root.className = "edit-hint";
  root.hidden = true;
  container.appendChild(root);

  const nameOf = (id: string | null | undefined): string =>
    (id && network.getStation(id)?.name) || "—";

  const render = () => {
    const lineId = editor.editingLineId;
    const line = lineId ? network.getLine(lineId) : undefined;
    if (!line) {
      root.hidden = true;
      return;
    }
    root.hidden = false;
    const ids = line.stationIds;
    const head = ids[0];
    const tail = ids[ids.length - 1];
    const isRing = ids.length >= 3 && head !== undefined && head === tail;
    const canRing = ids.length >= 2 && head !== tail;
    const grow =
      editor.activeEnd === "head" ? "首端生长（反向）" : "末端生长（正向）";
    root.innerHTML = "";

    const title = document.createElement("div");
    title.className = "edit-hint-title";
    title.textContent = `铺设「${line.name}」`;
    root.appendChild(title);

    const rows: [string, string][] = [
      ["方向", grow],
      ["起点", nameOf(head)],
      ["终点", nameOf(tail)],
      ["最近铺设", nameOf(editor.lastLaidStationId)],
    ];
    for (const [k, v] of rows) {
      const row = document.createElement("div");
      row.className = "edit-hint-row";
      const key = document.createElement("span");
      key.className = "edit-hint-key";
      key.textContent = k;
      const val = document.createElement("span");
      val.textContent = v;
      row.append(key, val);
      root.appendChild(row);
    }

    const tip = document.createElement("div");
    tip.className = "edit-hint-tip";
    tip.textContent = "拖动车站移位 · 点线中部插站(可点他线站换乘)";
    root.appendChild(tip);

    // —— 操作按钮行 ——
    const btnRow = document.createElement("div");
    btnRow.className = "edit-hint-actions";

    const dirBtn = document.createElement("button");
    dirBtn.className = "edit-hint-btn";
    dirBtn.textContent = "⇄ 切换方向";
    dirBtn.title = "切换线路生长端（首端/末端）";
    dirBtn.addEventListener("click", () => {
      editor.setActiveEnd(editor.activeEnd === "head" ? "tail" : "head");
    });
    btnRow.appendChild(dirBtn);

    const ringBtn = document.createElement("button");
    ringBtn.className = "edit-hint-btn";
    ringBtn.textContent = isRing ? "✓ 已闭环" : "↻ 形成环线";
    ringBtn.title = isRing ? "线路已首尾相连" : "将终点与起点连接形成环线";
    ringBtn.disabled = !canRing && !isRing;
    if (canRing) {
      ringBtn.addEventListener("click", () => {
        const h = line.stationIds[0];
        if (h) network.appendStationToLine(line.id, h);
      });
    }
    btnRow.appendChild(ringBtn);

    root.appendChild(btnRow);
  };

  network.subscribe(render);
  editor.subscribe(render);
  render();
}
