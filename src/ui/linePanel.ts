import type { Network } from "../model/network";
import { exportToFile, importFromFile } from "../persist/storage";
import { Network as NetworkClass } from "../model/network";
import type { SimClient } from "../sim/simClient";
import type { EditorState } from "./editorState";
import { fmtRiders } from "./format";
import { buildServicePlanEditor } from "./servicePlanEditor";

interface PanelCallbacks {
  /** 导入存档后用新 Network 实例重建应用 */
  onImport: (net: NetworkClass) => void;
  /** 切换需求热力图;返回切换后的可见性,不可用时为 null */
  onToggleHeat: (() => boolean) | null;
}

/** 侧栏:全网指标 + 线路列表 + 新建/编辑/删除 + 导入导出 */
export function createLinePanel(
  container: HTMLElement,
  network: Network,
  editor: EditorState,
  sim: SimClient,
  callbacks: PanelCallbacks,
): void {
  /** 当前展开服务计划编辑器的线路 */
  let openPlanLineId: string | null = null;
  /** 滑条拖动期间挂起重渲染,松手后补渲染 */
  let suppressRender = false;
  let pendingRender = false;

  const render = () => {
    if (suppressRender) {
      pendingRender = true;
      return;
    }
    container.innerHTML = "";

    const header = document.createElement("header");
    const h1 = document.createElement("h1");
    h1.textContent = "realsubway";
    const p = document.createElement("p");
    p.textContent = "北京 · 画出你的地铁线网";
    const stats = document.createElement("div");
    stats.className = "stats-line";
    if (!sim.hasData) {
      stats.textContent = "运输总量:暂无数据";
    } else if (sim.state === "computing") {
      stats.textContent = "运输总量:计算中…";
    } else {
      stats.textContent =
        `运输总量 ≈ ${fmtRiders(sim.total())}/日 · ` +
        `分担率 ${(sim.modeShare() * 100).toFixed(0)}%(${sim.computeMs.toFixed(0)}ms)`;
      if (sim.unserved() > 1000) {
        stats.textContent += ` · 未送达 ${fmtRiders(sim.unserved())}`;
      }
    }
    header.append(h1, p, stats);
    container.appendChild(header);

    if (editor.editingLineId) {
      const hint = document.createElement("div");
      hint.className = "editing-hint";
      const line = network.getLine(editor.editingLineId);
      hint.textContent = `正在铺设「${line?.name ?? ""}」:点击地图建站,点击已有车站并线`;
      container.appendChild(hint);
    }

    const list = document.createElement("div");
    list.className = "line-list";
    container.appendChild(list);

    if (network.lines.length === 0) {
      const tip = document.createElement("div");
      tip.className = "empty-tip";
      tip.textContent = "还没有线路。点击下方「新建线路」,然后在地图上点击铺站。";
      list.appendChild(tip);
    }

    for (const line of network.lines) {
      const item = document.createElement("div");
      item.className = "line-item" + (editor.editingLineId === line.id ? " editing" : "");

      const dot = document.createElement("span");
      dot.className = "line-dot";
      dot.style.background = line.color;

      const name = document.createElement("span");
      name.className = "line-name";
      name.textContent = line.name;
      name.title = "双击改名";
      name.addEventListener("dblclick", () => {
        const next = prompt("线路名", line.name);
        if (next?.trim()) network.renameLine(line.id, next.trim());
      });

      const count = document.createElement("span");
      count.className = "station-count";
      count.textContent = `${line.stationIds.length}站`;

      const editBtn = document.createElement("button");
      if (editor.editingLineId === line.id) {
        editBtn.textContent = "完成";
        editBtn.className = "primary";
        editBtn.addEventListener("click", () => editor.setEditingLine(null));
      } else {
        editBtn.textContent = "铺设";
        editBtn.addEventListener("click", () => editor.setEditingLine(line.id));
      }

      const planBtn = document.createElement("button");
      planBtn.textContent = openPlanLineId === line.id ? "收起" : "计划";
      planBtn.addEventListener("click", () => {
        openPlanLineId = openPlanLineId === line.id ? null : line.id;
        render();
      });

      const delBtn = document.createElement("button");
      delBtn.className = "danger";
      delBtn.textContent = "删";
      delBtn.addEventListener("click", () => {
        if (!confirm(`删除「${line.name}」?车站会保留。`)) return;
        if (editor.editingLineId === line.id) editor.setEditingLine(null);
        if (openPlanLineId === line.id) openPlanLineId = null;
        network.deleteLine(line.id);
      });

      item.append(dot, name, count, editBtn, planBtn, delBtn);
      list.appendChild(item);

      if (openPlanLineId === line.id) {
        const planEditor = buildServicePlanEditor(network, line);
        // 只在拖动滑条时挂起重渲染;松手用 window 一次性监听,避免卡死
        planEditor.addEventListener("pointerdown", (e) => {
          const t = e.target as HTMLElement;
          if (!(t instanceof HTMLInputElement) || t.type !== "range") return;
          suppressRender = true;
          window.addEventListener(
            "pointerup",
            () => {
              suppressRender = false;
              if (pendingRender) {
                pendingRender = false;
                render();
              }
            },
            { once: true },
          );
        });
        list.appendChild(planEditor);
      }
    }

    const actions = document.createElement("div");
    actions.className = "panel-actions";

    const newBtn = document.createElement("button");
    newBtn.className = "primary";
    newBtn.textContent = "+ 新建线路";
    newBtn.addEventListener("click", () => {
      const line = network.addLine();
      editor.setEditingLine(line.id);
    });

    const exportBtn = document.createElement("button");
    exportBtn.textContent = "导出";
    exportBtn.addEventListener("click", () => exportToFile(network));

    const importBtn = document.createElement("button");
    importBtn.textContent = "导入";
    importBtn.addEventListener("click", () => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "application/json";
      input.addEventListener("change", async () => {
        const file = input.files?.[0];
        if (!file) return;
        try {
          const data = await importFromFile(file);
          callbacks.onImport(NetworkClass.fromJSON(data));
        } catch (e) {
          alert(`导入失败:${e instanceof Error ? e.message : e}`);
        }
      });
      input.click();
    });

    actions.append(newBtn, exportBtn, importBtn);

    if (callbacks.onToggleHeat) {
      const heatBtn = document.createElement("button");
      heatBtn.textContent = "热力图";
      heatBtn.addEventListener("click", () => {
        const on = callbacks.onToggleHeat!();
        heatBtn.classList.toggle("primary", on);
      });
      actions.appendChild(heatBtn);
    }

    container.appendChild(actions);
  };

  network.subscribe(render);
  editor.subscribe(render);
  sim.subscribe(render);
  render();
}
