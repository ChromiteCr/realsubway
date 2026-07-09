import { CAR_SPECS, trainCapacity } from "../config/rollingstock";
import { PLAN_LIMITS, type Network } from "../model/network";
import type { CarType, LineData } from "../model/types";

function minutesToHHMM(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function hhmmToMinutes(v: string): number {
  const [h, m] = v.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/**
 * 服务计划编辑器(浮出面板内容,M5a2):
 *   顶部左侧两行高线路标识 + 右侧线路信息(如「6节、B型编组」);
 *   下方依次:首末班车 → 编组选择 → 逐小时间隔滑条。
 * 滑条拖动中只更新标签,release(change)才提交模型,避免拖动中被重渲染打断。
 */
export function buildServicePlanEditor(network: Network, line: LineData): HTMLElement {
  const root = document.createElement("div");
  root.className = "plan-flyout-content";
  const plan = line.servicePlan;

  // —— 顶部:两行高线路标识 + 线路信息 ——
  const header = document.createElement("div");
  header.className = "plan-header";
  const badge = document.createElement("div");
  badge.className = "plan-badge";
  badge.style.background = line.color;
  badge.textContent = line.name;
  const info = document.createElement("div");
  info.className = "plan-info";
  const infoName = document.createElement("div");
  infoName.className = "plan-info-name";
  infoName.textContent = line.name;
  const infoStock = document.createElement("div");
  infoStock.className = "plan-info-stock";
  header.append(badge, info);
  info.append(infoName, infoStock);
  root.appendChild(header);

  const body = document.createElement("div");
  body.className = "plan-body";
  root.appendChild(body);

  // —— 首末班车 ——
  const times = document.createElement("div");
  times.className = "plan-row";
  const timesLabel = document.createElement("span");
  timesLabel.className = "plan-row-label";
  timesLabel.textContent = "首末班车";
  const firstInput = document.createElement("input");
  firstInput.type = "time";
  firstInput.value = minutesToHHMM(plan.firstTrainMin);
  const lastInput = document.createElement("input");
  lastInput.type = "time";
  lastInput.value = minutesToHHMM(plan.lastTrainMin);
  firstInput.addEventListener("change", () =>
    network.updateServicePlan(line.id, { firstTrainMin: hhmmToMinutes(firstInput.value) }),
  );
  lastInput.addEventListener("change", () =>
    network.updateServicePlan(line.id, { lastTrainMin: hhmmToMinutes(lastInput.value) }),
  );
  times.append(timesLabel, firstInput, document.createTextNode("—"), lastInput);
  body.appendChild(times);

  // —— 编组选择(车型 × 辆数)——
  const stockRow = document.createElement("div");
  stockRow.className = "plan-row";
  const stockLabel = document.createElement("span");
  stockLabel.className = "plan-row-label";
  stockLabel.textContent = "编组";
  const typeSel = document.createElement("select");
  for (const t of ["A", "B", "C"] as CarType[]) {
    const opt = document.createElement("option");
    opt.value = t;
    opt.textContent = `${t}型(宽${CAR_SPECS[t].widthM}m·定员${CAR_SPECS[t].capacity})`;
    opt.selected = plan.stock.type === t;
    typeSel.appendChild(opt);
  }
  const carsSel = document.createElement("select");
  for (let c = PLAN_LIMITS.carsMin; c <= PLAN_LIMITS.carsMax; c++) {
    const opt = document.createElement("option");
    opt.value = String(c);
    opt.textContent = `${c}辆编组`;
    opt.selected = plan.stock.cars === c;
    carsSel.appendChild(opt);
  }
  const commitStock = () =>
    network.updateServicePlan(line.id, {
      stock: { type: typeSel.value as CarType, cars: Number(carsSel.value) },
    });
  typeSel.addEventListener("change", commitStock);
  carsSel.addEventListener("change", commitStock);
  stockRow.append(stockLabel, typeSel, carsSel);
  body.appendChild(stockRow);

  // —— 信息行(节数/车型)与运力提示 ——
  const cap = trainCapacity(plan.stock);
  const h0 = Math.floor(plan.firstTrainMin / 60);
  const h1 = Math.min(23, Math.floor(plan.lastTrainMin / 60));
  let minHeadway = Infinity;
  for (let h = h0; h <= h1; h++) minHeadway = Math.min(minHeadway, plan.headwayByHour[h] ?? 6);
  const peakCapacity = Math.round((60 / minHeadway) * cap);
  infoStock.textContent = `${plan.stock.cars}节、${plan.stock.type}型编组`;
  const capLine = document.createElement("div");
  capLine.className = "cap-line";
  capLine.textContent = `列车定员 ${cap} 人 · 高峰运力 ≈ ${peakCapacity.toLocaleString()} 人/h·向`;
  body.appendChild(capLine);

  // —— 逐小时间隔滑条(运营时段)——
  const hoursTitle = document.createElement("div");
  hoursTitle.className = "plan-row-label";
  hoursTitle.style.marginTop = "4px";
  hoursTitle.textContent = "逐小时发车间隔";
  body.appendChild(hoursTitle);

  const hoursBox = document.createElement("div");
  hoursBox.className = "hours-box";
  for (let h = h0; h <= h1; h++) {
    const row = document.createElement("div");
    row.className = "hour-row";
    const label = document.createElement("span");
    label.className = "hour-label";
    label.textContent = `${String(h).padStart(2, "0")}时`;
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = String(PLAN_LIMITS.headwayMin);
    slider.max = String(PLAN_LIMITS.headwayMax);
    slider.value = String(plan.headwayByHour[h] ?? 6);
    const value = document.createElement("span");
    value.className = "hour-value";
    value.textContent = `${slider.value}分`;
    slider.addEventListener("input", () => {
      value.textContent = `${slider.value}分`;
    });
    slider.addEventListener("change", () => {
      const headway = [...line.servicePlan.headwayByHour];
      headway[h] = Number(slider.value);
      network.updateServicePlan(line.id, { headwayByHour: headway });
    });
    row.append(label, slider, value);
    hoursBox.appendChild(row);
  }
  body.appendChild(hoursBox);

  return root;
}
