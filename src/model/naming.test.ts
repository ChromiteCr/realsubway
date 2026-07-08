import { describe, expect, it } from "vitest";
import { buildGazetteer, Gazetteer, type NamedPoint } from "./naming";

// 北京城区一带,便于用真实量级的经纬度
const GUOMAO = { lng: 116.456, lat: 39.908 };
const WANGJING = { lng: 116.462, lat: 39.998 };

describe("Gazetteer.suggest 优先级与半径", () => {
  it("命中真实站名优先于地标与片区", () => {
    const g = buildGazetteer({
      stations: [{ name: "国贸", ...GUOMAO }],
      landmarks: [{ name: "中央商务区", lng: 116.457, lat: 39.909 }],
      places: [{ name: "呼家楼片区", lng: 116.458, lat: 39.91 }],
    });
    expect(g.suggest(GUOMAO.lng, GUOMAO.lat, new Set())).toBe("国贸");
  });

  it("无站但有片区名 → 取片区名", () => {
    const g = buildGazetteer({
      places: [{ name: "望京", ...WANGJING }],
    });
    expect(g.suggest(WANGJING.lng, WANGJING.lat, new Set())).toBe("望京");
  });

  it("超出所有半径 → 返回 null(调用方回落车站N)", () => {
    const g = buildGazetteer({
      stations: [{ name: "国贸", ...GUOMAO }],
    });
    // 远在 10km 外
    expect(g.suggest(116.6, 39.99, new Set())).toBeNull();
  });

  it("站半径(500m)外、地标半径(1000m)内 → 跳过站取地标", () => {
    // 造一个点:距站 ~800m(站半径外),但在地标半径内
    const near = { lng: GUOMAO.lng + 0.009, lat: GUOMAO.lat }; // ~0.77km 东
    const g = buildGazetteer({
      stations: [{ name: "国贸", ...GUOMAO }],
      landmarks: [{ name: "商务区", ...near }],
    });
    expect(g.suggest(near.lng, near.lat, new Set())).toBe("商务区");
  });

  it("同档取最近", () => {
    const g = buildGazetteer({
      places: [
        { name: "近片区", lng: 116.456, lat: 39.908 },
        { name: "远片区", lng: 116.46, lat: 39.908 },
      ],
    });
    expect(g.suggest(116.4562, 39.908, new Set())).toBe("近片区");
  });
});

describe("Gazetteer.suggest 重名消歧", () => {
  it("重名 → 加方位;方位由点击相对命名点的位置决定", () => {
    const g = buildGazetteer({ places: [{ name: "望京", ...WANGJING }] });
    // 点击在片区点正东侧
    const east = { lng: WANGJING.lng + 0.003, lat: WANGJING.lat };
    expect(g.suggest(east.lng, east.lat, new Set(["望京"]))).toBe("望京东");
    // 点击在正南侧
    const south = { lng: WANGJING.lng, lat: WANGJING.lat - 0.003 };
    expect(g.suggest(south.lng, south.lat, new Set(["望京"]))).toBe("望京南");
  });

  it("方位也重名 → 加序号", () => {
    const g = buildGazetteer({ places: [{ name: "望京", ...WANGJING }] });
    const east = { lng: WANGJING.lng + 0.003, lat: WANGJING.lat };
    const existing = new Set(["望京", "望京东"]);
    expect(g.suggest(east.lng, east.lat, existing)).toBe("望京东2");
  });
});

describe("buildGazetteer 降级", () => {
  it("空来源 → size 0,suggest 恒 null", () => {
    const g = new Gazetteer([]);
    expect(g.size).toBe(0);
    expect(g.suggest(116.4, 39.9, new Set())).toBeNull();
  });

  it("只给片区来源也能工作", () => {
    const pts: NamedPoint[] = [{ name: "亦庄", lng: 116.5, lat: 39.79, kind: "place" }];
    const g = new Gazetteer(pts);
    expect(g.suggest(116.5, 39.79, new Set())).toBe("亦庄");
  });
});
