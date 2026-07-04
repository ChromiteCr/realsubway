import type { Network } from "../model/network";
import type { SimClient } from "../sim/simClient";
import { fmtRiders } from "./format";

/** 车站弹窗内容:改名输入框 + 客流 + 经停线路徽章 + 删除按钮 */
export function buildStationPopup(
  network: Network,
  sim: SimClient,
  stationId: string,
  onClose: () => void,
): HTMLElement {
  const station = network.getStation(stationId);
  const root = document.createElement("div");
  root.className = "station-popup";
  if (!station) return root;

  const nameInput = document.createElement("input");
  nameInput.value = station.name;
  nameInput.title = "车站名";
  nameInput.addEventListener("change", () => {
    network.renameStation(stationId, nameInput.value.trim() || station.name);
  });
  root.appendChild(nameInput);

  const riders = document.createElement("div");
  riders.className = "riders-line";
  riders.textContent = !sim.hasData
    ? "日进出站:暂无数据(先运行数据管线)"
    : sim.state === "computing"
      ? "日进出站:计算中…"
      : `日进出站 ≈ ${fmtRiders(sim.ridersAt(stationId))}`;
  root.appendChild(riders);

  const badges = document.createElement("div");
  badges.className = "badges";
  const lines = network.linesThroughStation(stationId);
  if (lines.length === 0) {
    const tip = document.createElement("span");
    tip.style.color = "#999";
    tip.textContent = "未接入线路";
    badges.appendChild(tip);
  }
  for (const line of lines) {
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.style.background = line.color;
    badge.textContent = line.name;
    badges.appendChild(badge);
  }
  root.appendChild(badges);

  const delBtn = document.createElement("button");
  delBtn.className = "danger";
  delBtn.textContent = "删除车站";
  delBtn.addEventListener("click", () => {
    network.deleteStation(stationId);
    onClose();
  });
  root.appendChild(delBtn);

  return root;
}
