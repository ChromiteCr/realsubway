import type { Network } from "../model/network";
import type { SimClient } from "../sim/simClient";
import { fmtRiders } from "./format";

/** 区间弹窗:线名 + 区间两端 + 日断面与高峰断面 */
export function buildSegmentPopup(
  network: Network,
  sim: SimClient,
  lineId: string,
  seg: number,
): HTMLElement {
  const root = document.createElement("div");
  root.className = "station-popup";
  const line = network.getLine(lineId);
  if (!line) return root;
  const a = network.getStation(line.stationIds[seg] ?? "");
  const b = network.getStation(line.stationIds[seg + 1] ?? "");

  const title = document.createElement("div");
  const badge = document.createElement("span");
  badge.className = "badge";
  badge.style.background = line.color;
  badge.textContent = line.name;
  title.appendChild(badge);
  title.append(` ${a?.name ?? "?"} — ${b?.name ?? "?"}`);
  title.style.marginBottom = "8px";
  root.appendChild(title);

  const daily = document.createElement("div");
  daily.className = "riders-line";
  if (sim.state === "computing") {
    daily.textContent = "断面:计算中…";
    root.appendChild(daily);
    return root;
  }
  daily.textContent = `日断面(单向)≈ ${fmtRiders(sim.segDaily(lineId, seg))}`;
  root.appendChild(daily);

  const peak = sim.segPeak(lineId, seg);
  const peakDir = peak.dirBit === 0 ? `${a?.name}→${b?.name}` : `${b?.name}→${a?.name}`;
  const peakLine = document.createElement("div");
  peakLine.style.fontSize = "12px";
  peakLine.style.color = "#666";
  peakLine.textContent = `高峰小时最忙方向 ${peakDir} ≈ ${fmtRiders(peak.load)}/h`;
  root.appendChild(peakLine);

  const lf = sim.loadFactor(lineId, seg);
  const lfLine = document.createElement("div");
  lfLine.style.fontSize = "12px";
  lfLine.style.color = lf > 1 ? "#c0392b" : "#666";
  lfLine.textContent =
    lf > 1
      ? `高峰满载率 ${(lf * 100).toFixed(0)}% — 超运力,乘客被甩站`
      : `高峰满载率 ${(lf * 100).toFixed(0)}%`;
  root.appendChild(lfLine);

  return root;
}
