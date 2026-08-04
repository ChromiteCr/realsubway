import { describe, expect, it } from "vitest";
import { SCORE_REF } from "../../config/economy";
import { Network } from "../../model/network";
import type { NetworkData } from "../../model/types";
import { computeScore, type ScoreInput, type ScoreKey } from "./scoring";

/** n 站单线网络 */
function lineNet(n: number): NetworkData {
  const net = new Network();
  const ids: string[] = [];
  for (let i = 0; i < n; i++) ids.push(net.addStation(116.3 + i * 0.01, 39.9).id);
  const l = net.addLine();
  for (const id of ids) net.appendStationToLine(l.id, id);
  return net.toJSON();
}

function input(served: number, unserved = 0, over: Partial<ScoreInput> = {}): ScoreInput {
  return {
    servedTrips: served,
    metroDemandTrips: served + unserved,
    unservedTrips: unserved,
    loadFactors: [],
    coverageRatio: 0.1,
    fareRevenue: 1e6,
    totalCost: 1e8,
    ...over,
  };
}

function partScoreOf(parts: { key: ScoreKey; score: number }[], key: ScoreKey): number {
  return parts.find((p) => p.key === key)!.score;
}

describe("computeScore(M5a6 分项评分)", () => {
  it("各指标与现网持平 → 85 分(B)锚点", () => {
    // 394 站、送达 3.40M、覆盖 43.6%、未送达率 1.5%、回收率 6.7% = 现网画像
    const s = computeScore(
      lineNet(394),
      input(SCORE_REF.volume, 51_776, {
        coverageRatio: SCORE_REF.coverage,
        fareRevenue: SCORE_REF.economy * 1e8,
        totalCost: 1e8,
      }),
    );
    // 服务质量分项基准取设计目标 0.9,现网 0.985 略高于基准,故整体略高于 85
    expect(s.rating).toBeGreaterThan(84);
    expect(s.rating).toBeLessThan(87);
    expect(s.grade).toBe("B");
    expect(partScoreOf(s.parts, "coverage")).toBeCloseTo(85, 0);
    expect(partScoreOf(s.parts, "volume")).toBeCloseTo(85, 0);
  });

  it("小而密的网络拿不到 A:覆盖与规模跟不上(M5a6 难度核心)", () => {
    // 40 站、送达 1.2M(站均 3 万,效率/经济分项撞高分),但覆盖只有现网的 1/3
    const s = computeScore(
      lineNet(40),
      input(1_200_000, 5_000, { coverageRatio: 0.15, fareRevenue: 1.2e7, totalCost: 1e8 }),
    );
    expect(partScoreOf(s.parts, "intensity")).toBeGreaterThan(90); // 效率确实高
    expect(s.rating).toBeLessThan(80); // 但综合分进不了 B+/A
  });

  it("覆盖人口越多分越高(权重最高的两项之一)", () => {
    const net = lineNet(100);
    const low = computeScore(net, input(2_000_000, 0, { coverageRatio: 0.1 }));
    const high = computeScore(net, input(2_000_000, 0, { coverageRatio: 0.4 }));
    expect(high.rating).toBeGreaterThan(low.rating + 5);
  });

  it("绝对客流越大评分越高(规模项单调)", () => {
    const net = lineNet(20);
    const low = computeScore(net, input(1_000_000));
    const high = computeScore(net, input(4_000_000));
    expect(high.rating).toBeGreaterThan(low.rating);
  });

  it("未送达比例升高 → 服务质量与评分下降", () => {
    const net = lineNet(20);
    const good = computeScore(net, input(2_000_000, 0));
    const bad = computeScore(net, input(2_000_000, 2_000_000)); // 一半未送达
    expect(bad.serviceQuality).toBeLessThan(good.serviceQuality);
    expect(partScoreOf(bad.parts, "service")).toBeLessThan(partScoreOf(good.parts, "service"));
    expect(bad.rating).toBeLessThan(good.rating);
  });

  it("拥挤(满载率>1)降低服务质量", () => {
    const net = lineNet(10);
    const base = computeScore(net, { ...input(1_000_000), loadFactors: [new Float32Array([1, 1])] });
    const crowded = computeScore(net, {
      ...input(1_000_000),
      loadFactors: [new Float32Array([2.5, 2.0])],
    });
    expect(crowded.serviceQuality).toBeLessThan(base.serviceQuality);
    expect(crowded.rating).toBeLessThan(base.rating);
  });

  it("同样客流:紧凑网络的效率分高于稀疏网络", () => {
    const compact = computeScore(lineNet(40), input(2_000_000));
    const sprawling = computeScore(lineNet(400), input(2_000_000));
    expect(partScoreOf(compact.parts, "intensity")).toBeGreaterThan(
      partScoreOf(sprawling.parts, "intensity"),
    );
    // 分项分天然封顶 100,综合分也就封顶 100,不会像旧公式那样被效率乘子放大
    expect(compact.rating).toBeLessThanOrEqual(100);
  });

  it("缺数据的分项被剔除,权重归一化", () => {
    const s = computeScore(
      lineNet(20),
      input(1_000_000, 0, { coverageRatio: null, totalCost: 0 }),
    );
    expect(s.parts.map((p) => p.key).sort()).toEqual(["intensity", "service", "volume"]);
    expect(s.parts.reduce((sum, p) => sum + p.weight, 0)).toBeCloseTo(1, 6);
  });

  it("空网络评分为 F,所有分项归零", () => {
    const s = computeScore({ version: 1, stations: [], lines: [] }, input(0));
    expect(s.grade).toBe("F");
    expect(s.parts.every((p) => p.score === 0)).toBe(true);
  });
});
