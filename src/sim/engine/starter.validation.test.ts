/**
 * M3 完成标准验证:用真实北京数据 + OSM 现网跑引擎,
 * 检查繁忙线路排名是否符合现实、孤立线是否显著弱于接网线。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { NetworkData } from "../../model/types";
import { DataGrid, type GridMeta } from "../grids";
import { runSimulation, type SimResult } from "./index";

const DATA_DIR = path.resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../../public/data/beijing",
);

function loadGrid(name: string): DataGrid {
  const meta = JSON.parse(readFileSync(path.join(DATA_DIR, `${name}.json`), "utf-8")) as GridMeta;
  const buf = readFileSync(path.join(DATA_DIR, `${name}.bin`));
  const data = new Uint16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2);
  return new DataGrid(meta, data);
}

const popGrid = loadGrid("demand_grid");
const attrGrid = loadGrid("attraction_grid");
const landmarks = (
  JSON.parse(readFileSync(path.join(DATA_DIR, "landmarks.json"), "utf-8")) as {
    landmarks: { name: string; lng: number; lat: number; dailyTrips: number }[];
  }
).landmarks;
const starter = JSON.parse(
  readFileSync(path.join(DATA_DIR, "starter_network.json"), "utf-8"),
) as NetworkData;

function lineDailyCrossings(res: SimResult, lineId: string): number {
  const idx = res.lineIds.indexOf(lineId);
  const loads = res.segLoads[idx]!;
  let sum = 0;
  for (const v of loads) sum += v;
  return sum;
}

describe("现网验证(真实数据)", () => {
  const t0 = performance.now();
  const res = runSimulation(starter, popGrid, attrGrid, landmarks);
  const elapsed = performance.now() - t0;

  it("394 站现网重算 < 3 秒(编辑响应性)", () => {
    console.log(`现网重算耗时 ${elapsed.toFixed(0)}ms`);
    expect(elapsed).toBeLessThan(3000);
  });

  it("日送达出行量在现实数量级(100万–3000万),分担率合理", () => {
    const share = res.servedTrips / res.potentialTrips;
    console.log(
      `潜在 ${(res.potentialTrips / 1e6).toFixed(2)}M, 送达 ${(res.servedTrips / 1e6).toFixed(2)}M, ` +
        `分担率 ${(share * 100).toFixed(1)}%, 未送达 ${(res.unservedTrips / 1e6).toFixed(2)}M`,
    );
    expect(res.servedTrips).toBeGreaterThan(1e6);
    expect(res.servedTrips).toBeLessThan(3e7);
    expect(share).toBeGreaterThan(0.05);
    expect(share).toBeLessThan(0.95);
  });

  it("繁忙线路排名符合现实:10号线居前,1/4/6号线进前五", () => {
    const ranking = starter.lines
      .map((l) => ({ name: l.name, load: lineDailyCrossings(res, l.id) }))
      .sort((a, b) => b.load - a.load);
    console.log(
      "线路负载排名:",
      ranking.slice(0, 8).map((r) => `${r.name}=${(r.load / 1e6).toFixed(2)}M`).join(", "),
    );
    const top5 = ranking.slice(0, 5).map((r) => r.name);
    expect(top5).toContain("10号线");
    expect(
      top5.some((n) => n === "1号线" || n === "6号线" || n.startsWith("4号线")),
    ).toBe(true);
    // 外围支线不应进前五
    expect(top5).not.toContain("燕房线");
    expect(top5).not.toContain("大兴机场线");
  });

  it("M4Y:交通枢纽在现网中被抬升——机场/火车站进出站量达枢纽量级", () => {
    const ridersOfName = (name: string): number => {
      const st = starter.stations.find((s) => s.name === name);
      if (!st) return -1;
      return res.stationRiders[res.stationIds.indexOf(st.id)]!;
    };
    const airport = ridersOfName("首都机场2号航站楼"); // 距机场地标 0.9km,在 4km 上限内
    const westRail = ridersOfName("北京西站");
    console.log(
      `枢纽站进出站量: 首都机场T2=${(airport / 1e3).toFixed(1)}k, 北京西站=${(westRail / 1e3).toFixed(1)}k`,
    );
    // 无外生客流时机场站几乎为 0(零常住人口);M4Y 后应达数万
    expect(airport).toBeGreaterThan(15000);
    expect(westRail).toBeGreaterThan(15000);
  });
});
