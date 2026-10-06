import { LayoutResult, VerifyIssue, VerifyReport } from "./types";

/**
 * 独立几何核验：只依据输出矩形与输入权重重新计算，
 * 不读取布局过程自报的成功标志。
 */
export function verify(result: LayoutResult): VerifyReport {
  const tol = result.tolerance;
  const issues: VerifyIssue[] = [];
  const { width, height } = result;
  const containerArea = width * height;

  const seen = new Set<string>();
  const placedItems = result.items.filter((it) => it.rect !== null);

  for (const it of result.items) {
    if (seen.has(it.id)) {
      issues.push({ kind: "duplicate-item", itemIds: [it.id], detail: `项目 ${it.id} 出现多次`, deviation: 1 });
    }
    seen.add(it.id);
  }

  const totalWeight = result.items.reduce((s, it) => s + it.weight, 0);

  // 边界检查（允许容差级浮点误差）
  const boundTol = Math.max(width, height) * tol;
  for (const it of placedItems) {
    const r = it.rect!;
    const out =
      r.x < -boundTol ||
      r.y < -boundTol ||
      r.x + r.width > width + boundTol ||
      r.y + r.height > height + boundTol;
    if (out) {
      const dev = Math.max(
        -r.x,
        -r.y,
        r.x + r.width - width,
        r.y + r.height - height,
        0
      );
      issues.push({
        kind: "out-of-bounds",
        itemIds: [it.id],
        detail: `项目 ${it.id} 矩形 (${r.x}, ${r.y}, ${r.width}, ${r.height}) 超出容器 ${width}x${height}`,
        deviation: dev,
      });
    }
  }

  // 两两重叠检查
  const overlapTol = containerArea * tol;
  for (let a = 0; a < placedItems.length; a++) {
    for (let b = a + 1; b < placedItems.length; b++) {
      const ra = placedItems[a].rect!;
      const rb = placedItems[b].rect!;
      const ox = Math.min(ra.x + ra.width, rb.x + rb.width) - Math.max(ra.x, rb.x);
      const oy = Math.min(ra.y + ra.height, rb.y + rb.height) - Math.max(ra.y, rb.y);
      if (ox > 0 && oy > 0 && ox * oy > overlapTol) {
        issues.push({
          kind: "overlap",
          itemIds: [placedItems[a].id, placedItems[b].id],
          detail: `项目 ${placedItems[a].id} 与 ${placedItems[b].id} 重叠面积 ${ox * oy}`,
          deviation: ox * oy,
        });
      }
    }
  }

  // 面积比例检查：实际面积 / 容器面积 应等于 权重 / 总权重
  let placedArea = 0;
  for (const it of placedItems) {
    const r = it.rect!;
    const actual = r.width * r.height;
    placedArea += actual;
    if (totalWeight > 0) {
      const expected = (it.weight / totalWeight) * containerArea;
      const denom = Math.max(expected, containerArea * 1e-12);
      const rel = Math.abs(actual - expected) / denom;
      if (rel > tol) {
        issues.push({
          kind: "area-mismatch",
          itemIds: [it.id],
          detail: `项目 ${it.id} 面积 ${actual}，按权重应为 ${expected}，相对偏差 ${rel}`,
          deviation: rel,
        });
      }
    }
  }

  // 正权重项目必须各出现一次且有矩形
  for (const it of result.items) {
    if (it.weight > 0 && it.rect === null) {
      issues.push({ kind: "missing-item", itemIds: [it.id], detail: `正权重项目 ${it.id} 没有矩形`, deviation: 1 });
    }
  }

  // 总面积检查
  if (totalWeight > 0) {
    const rel = Math.abs(placedArea - containerArea) / containerArea;
    if (rel > tol) {
      issues.push({
        kind: "total-area-mismatch",
        itemIds: [],
        detail: `矩形总面积 ${placedArea} 与容器面积 ${containerArea} 相对偏差 ${rel}`,
        deviation: rel,
      });
    }
  }

  return {
    ok: issues.length === 0,
    tolerance: tol,
    issues,
    checkedItems: placedItems.length,
    containerArea,
    placedArea,
  };
}
