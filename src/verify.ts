import { ContainerSpec, LayoutItemInput, PlacedRect } from "./types.js";

/**
 * 独立几何核验器：只根据输出矩形、容器与原始权重重新检查，
 * 不读取算法自己写入的任何成功标志。
 */

/** 相对容差：面积与边界比较均按容器面积 / 容器边长的比例放宽。 */
export const DEFAULT_REL_TOL = 1e-9;

export interface VerifyIssue {
  kind:
    | "out-of-bounds"
    | "overlap"
    | "area-mismatch"
    | "total-area-mismatch"
    | "duplicate-rect"
    | "missing-rect"
    | "unexpected-rect"
    | "non-positive-rect";
  message: string;
  itemIds: string[];
  detail?: Record<string, number>;
}

export interface VerifyReport {
  ok: boolean;
  tolerance: { rel: number; areaAbs: number; lengthAbs: number };
  issues: VerifyIssue[];
  checked: {
    rectCount: number;
    totalRectArea: number;
    containerArea: number;
    maxAreaDeviation: number;
    maxOverlapArea: number;
  };
}

export function verifyLayout(
  rects: PlacedRect[],
  items: LayoutItemInput[],
  container: ContainerSpec,
  relTol: number = DEFAULT_REL_TOL
): VerifyReport {
  const containerArea = container.width * container.height;
  const areaTol = Math.max(containerArea, 1) * relTol * Math.max(items.length, 1);
  const lenTol = Math.max(container.width, container.height, 1) * Math.sqrt(relTol);
  const issues: VerifyIssue[] = [];

  const byId = new Map<string, PlacedRect>();
  for (const r of rects) {
    if (byId.has(r.id)) {
      issues.push({ kind: "duplicate-rect", message: `项目 ${r.id} 出现多个矩形`, itemIds: [r.id] });
    }
    byId.set(r.id, r);
    if (!(r.width > 0) || !(r.height > 0)) {
      issues.push({
        kind: "non-positive-rect",
        message: `项目 ${r.id} 矩形宽高非正: ${r.width} x ${r.height}`,
        itemIds: [r.id],
      });
    }
  }

  const positiveItems = items.filter((it) => it.weight > 0);
  const totalWeight = positiveItems.reduce((a, it) => a + it.weight, 0);
  for (const it of positiveItems) {
    if (!byId.has(it.id)) {
      issues.push({ kind: "missing-rect", message: `正权重项目 ${it.id} 缺少矩形`, itemIds: [it.id] });
    }
  }
  const positiveIds = new Set(positiveItems.map((it) => it.id));
  for (const r of rects) {
    if (!positiveIds.has(r.id)) {
      issues.push({ kind: "unexpected-rect", message: `矩形 ${r.id} 对应项目不存在或权重为零`, itemIds: [r.id] });
    }
  }

  for (const r of rects) {
    const out =
      r.x < -lenTol ||
      r.y < -lenTol ||
      r.x + r.width > container.width + lenTol ||
      r.y + r.height > container.height + lenTol;
    if (out) {
      issues.push({
        kind: "out-of-bounds",
        message: `项目 ${r.id} 超出容器边界`,
        itemIds: [r.id],
        detail: { x: r.x, y: r.y, width: r.width, height: r.height },
      });
    }
  }

  let maxOverlap = 0;
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i];
      const b = rects[j];
      const ox = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      if (ox > lenTol && oy > lenTol) {
        const overlapArea = ox * oy;
        if (overlapArea > areaTol) {
          maxOverlap = Math.max(maxOverlap, overlapArea);
          issues.push({
            kind: "overlap",
            message: `项目 ${a.id} 与 ${b.id} 内部重叠，重叠面积 ${overlapArea}`,
            itemIds: [a.id, b.id],
            detail: { overlapArea },
          });
        }
      }
    }
  }

  let maxAreaDev = 0;
  if (totalWeight > 0) {
    for (const it of positiveItems) {
      const r = byId.get(it.id);
      if (!r) continue;
      const actual = r.width * r.height;
      const expected = (it.weight / totalWeight) * containerArea;
      const dev = Math.abs(actual - expected);
      maxAreaDev = Math.max(maxAreaDev, dev);
      if (dev > areaTol) {
        issues.push({
          kind: "area-mismatch",
          message: `项目 ${it.id} 面积偏差 ${dev}（实际 ${actual}，目标 ${expected}）`,
          itemIds: [it.id],
          detail: { actual, expected, deviation: dev },
        });
      }
    }
  }

  const totalRectArea = rects.reduce((a, r) => a + r.width * r.height, 0);
  const totalDev = Math.abs(totalRectArea - containerArea);
  if (totalWeight > 0 && totalDev > areaTol) {
    issues.push({
      kind: "total-area-mismatch",
      message: `矩形总面积 ${totalRectArea} 与容器面积 ${containerArea} 偏差 ${totalDev}`,
      itemIds: [],
      detail: { totalRectArea, containerArea, deviation: totalDev },
    });
  }

  return {
    ok: issues.length === 0,
    tolerance: { rel: relTol, areaAbs: areaTol, lengthAbs: lenTol },
    issues,
    checked: {
      rectCount: rects.length,
      totalRectArea,
      containerArea,
      maxAreaDeviation: maxAreaDev,
      maxOverlapArea: maxOverlap,
    },
  };
}
