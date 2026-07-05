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
 * 服务计划编辑器:首末班车、运营时段逐小时间隔滑条、车型×编组。
 * 滑条拖动中只更新标签,release(change)才提交模型,避免拖动中被重渲染打断。
 */
export function buildServicePlanEditor(network: Network, line: LineData): HTMLElement {
  const root = document.createElement("div");
  root.className = "plan-editor";
  const plan = line.servicePlan;

  // —— 首末班车 ——
  const times = document.createElement("div");
  times.className = "plan-row";
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
  const timesLabel = document.createElement("span");
  timesLabel.textContent = "首末班";
  times.append(timesLabel, firstInput, document.createTextNode("—"), lastInput);
  root.appendChild(times);

  // —— 车型 × 编组 ——
  const stockRow = document.createElement("div");
  stockRow.className = "plan-row";
  const typeSel = document.createElement("select");
  for (const t of ["A", "B", "C"] as CarType[]) {
    const opt = document.createElement("option");
    opt.value = t;
    opt.textContent = `${t}型(宽${CAR_SPECS[t].widthM}m,定员${CAR_SPECS[t].capacity})`;
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
  const stockLabel = document.createElement("span");
  stockLabel.textContent = "车型";
  stockRow.append(stockLabel, typeSel, carsSel);
  root.appendChild(stockRow);

  // —— 运力提示 ——
  const capLine = document.createElement("div");
  capLine.className = "cap-line";
  const renderCap = () => {
    const cap = trainCapacity(line.servicePlan.stock);
    const h0 = Math.floor(line.servicePlan.firstTrainMin / 60);
    const h1 = Math.min(23, Math.floor(line.servicePlan.lastTrainMin / 60));
    let minHeadway = Infinity;
    for (let h = h0; h <= h1; h++) {
      minHeadway = Math.min(minHeadway, line.servicePlan.headwayByHour[h] ?? 6);
    }
    const peakCapacity = Math.round((60 / minHeadway) * cap);
    capLine.textContent = `列车定员 ${cap} 人 · 高峰运力 ≈ ${peakCapacity.toLocaleString()} 人/h·向`;
  };
  renderCap();
  root.appendChild(capLine);

  // —— 逐小时间隔滑条(运营时段) ——
  const hoursBox = document.createElement("div");
  hoursBox.className = "hours-box";
  const h0 = Math.floor(plan.firstTrainMin / 60);
  const h1 = Math.min(23, Math.floor(plan.lastTrainMin / 60));
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
  root.appendChild(hoursBox);

  return root;
}
