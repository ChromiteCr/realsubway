export interface GridMeta {
  bbox: { lngMin: number; latMin: number; lngMax: number; latMax: number };
  width: number;
  height: number;
  /** 反量化系数:真实值 = 存储值 × scale(人口栅格为 1,可缺省) */
  scale?: number;
  totalPopulation?: number;
  totalWeight?: number;
}

export interface CellRef {
  row: number;
  col: number;
  /** 格心到查询点的距离(米) */
  distM: number;
}

const M_PER_DEG_LAT = 110_574;

/** 行主序 Uint16 栅格,行 0 = 北 */
export class DataGrid {
  constructor(
    readonly meta: GridMeta,
    readonly data: Uint16Array,
  ) {
    if (data.length !== meta.width * meta.height) {
      throw new Error(`栅格尺寸不符: ${data.length} != ${meta.width}x${meta.height}`);
    }
  }

  static async fetch(binUrl: string, metaUrl: string): Promise<DataGrid> {
    const [binResp, metaResp] = await Promise.all([window.fetch(binUrl), window.fetch(metaUrl)]);
    if (!binResp.ok || !metaResp.ok) {
      throw new Error(`栅格加载失败: ${binUrl} ${binResp.status} / ${metaUrl} ${metaResp.status}`);
    }
    const [buf, meta] = await Promise.all([
      binResp.arrayBuffer(),
      metaResp.json() as Promise<GridMeta>,
    ]);
    return new DataGrid(meta, new Uint16Array(buf));
  }

  get lngRes(): number {
    return (this.meta.bbox.lngMax - this.meta.bbox.lngMin) / this.meta.width;
  }

  get latRes(): number {
    return (this.meta.bbox.latMax - this.meta.bbox.latMin) / this.meta.height;
  }

  valueAt(row: number, col: number): number {
    const raw = this.data[row * this.meta.width + col] ?? 0;
    return raw * (this.meta.scale ?? 1);
  }

  cellCenter(row: number, col: number): { lng: number; lat: number } {
    return {
      lng: this.meta.bbox.lngMin + (col + 0.5) * this.lngRes,
      lat: this.meta.bbox.latMax - (row + 0.5) * this.latRes,
    };
  }

  /** 以 (lng,lat) 为圆心、radiusM 为半径覆盖的格子(按格心判定) */
  cellsWithin(lng: number, lat: number, radiusM: number): CellRef[] {
    const mPerDegLng = M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
    const colSpan = Math.ceil(radiusM / (this.lngRes * mPerDegLng));
    const rowSpan = Math.ceil(radiusM / (this.latRes * M_PER_DEG_LAT));
    const col0 = Math.floor((lng - this.meta.bbox.lngMin) / this.lngRes);
    const row0 = Math.floor((this.meta.bbox.latMax - lat) / this.latRes);

    const cells: CellRef[] = [];
    for (let row = row0 - rowSpan; row <= row0 + rowSpan; row++) {
      if (row < 0 || row >= this.meta.height) continue;
      for (let col = col0 - colSpan; col <= col0 + colSpan; col++) {
        if (col < 0 || col >= this.meta.width) continue;
        const c = this.cellCenter(row, col);
        const dx = (c.lng - lng) * mPerDegLng;
        const dy = (c.lat - lat) * M_PER_DEG_LAT;
        const distM = Math.hypot(dx, dy);
        if (distM <= radiusM) cells.push({ row, col, distM });
      }
    }
    return cells;
  }
}
