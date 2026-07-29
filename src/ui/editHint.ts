import type { Network } from "../model/network";
import type { EditorState } from "./editorState";

/**
 * 铺设提示浮层(左下角,M5a3):仅在铺设模式显示当前铺设方向、
 * 起点/终点车站、最近铺设的车站。
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
    tip.textContent = "点端点站切换生长方向 · 拖动车站移位 · 点线中部插站(可点他线站换乘)";
    root.appendChild(tip);
  };

  network.subscribe(render);
  editor.subscribe(render);
  render();
}
