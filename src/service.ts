import { LayoutStore } from "./db.js";
import { squarify } from "./layout.js";
import { ApiError, validateContainer, validateItems } from "./validate.js";
import { verifyLayout, VerifyReport } from "./verify.js";
import { ContainerSpec, LayoutItemInput, LayoutResult } from "./types.js";

/** 业务层：布局创建、查询、核验、版本比较。 */
export class LayoutService {
  constructor(private store: LayoutStore) {}

  createLayout(name: string, containerRaw: unknown, itemsRaw: unknown) {
    const container = validateContainer(containerRaw);
    const items = validateItems(itemsRaw);
    const result = squarify(items, container);
    const id = this.store.create(name, container, items, result);
    return { id, name, container, items, result };
  }

  getLayout(id: number) {
    const row = this.store.get(id);
    if (!row) throw new ApiError("NOT_FOUND", `布局 ${id} 不存在`);
    return row;
  }

  listLayouts() {
    return this.store.list();
  }

  close(): void {
    this.store.close();
  }

  getRects(id: number) {
    const row = this.getLayout(id);
    return { id, container: row.container, rects: row.result.rects, skipped: row.result.skipped };
  }

  getStrips(id: number) {
    const row = this.getLayout(id);
    return { id, order: row.result.order, strips: row.result.strips };
  }

  verify(id: number): VerifyReport & { id: number } {
    const row = this.getLayout(id);
    const report = verifyLayout(row.result.rects, row.items, row.container);
    return { id, ...report };
  }

  /** 独立核验：调用方直接给矩形与输入，不读数据库中的结果。 */
  verifyDirect(containerRaw: unknown, itemsRaw: unknown, rectsRaw: unknown) {
    const container = validateContainer(containerRaw);
    const items = validateItems(itemsRaw);
    if (!Array.isArray(rectsRaw)) throw new ApiError("BAD_REQUEST", "rects 必须为数组");
    const rects = rectsRaw.map((r, i) => {
      const e = r as Record<string, unknown>;
      for (const k of ["id", "x", "y", "width", "height"]) {
        if (!(k in e)) throw new ApiError("BAD_REQUEST", `rects[${i}] 缺少字段 ${k}`);
      }
      return {
        id: String(e.id),
        x: Number(e.x),
        y: Number(e.y),
        width: Number(e.width),
        height: Number(e.height),
        area: Number(e.width) * Number(e.height),
        targetArea: 0,
      };
    });
    return verifyLayout(rects, items, container);
  }

  /** 比较两个布局版本：容器差异、逐项矩形差异、面积差异。 */
  compare(idA: number, idB: number) {
    const a = this.getLayout(idA);
    const b = this.getLayout(idB);
    const ids = Array.from(
      new Set([...a.result.rects.map((r) => r.id), ...b.result.rects.map((r) => r.id)])
    );
    const rectA = new Map(a.result.rects.map((r) => [r.id, r]));
    const rectB = new Map(b.result.rects.map((r) => [r.id, r]));
    const items = ids.map((id) => {
      const ra = rectA.get(id);
      const rb = rectB.get(id);
      return {
        id,
        a: ra ?? null,
        b: rb ?? null,
        delta: ra && rb ? { dx: rb.x - ra.x, dy: rb.y - ra.y, dArea: rb.area - ra.area } : null,
      };
    });
    return {
      a: { id: a.id, name: a.name, container: a.container, items: a.items },
      b: { id: b.id, name: b.name, container: b.container, items: b.items },
      containerChanged:
        a.container.width !== b.container.width || a.container.height !== b.container.height,
      items,
    };
  }
}

export type { ContainerSpec, LayoutItemInput, LayoutResult };
