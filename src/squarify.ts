import { LayoutRequest, LayoutResult, PlacedItem, Rect, StripAttempt, StripRecord } from "./types";

/**
 * Squarified 条带布局（Bruls et al. 的贪心策略，自行实现）。
 *
 * 规则：
 * - 项目按权重降序排列，权重相等时按原输入顺序（稳定排序）。
 * - 目标面积 = 权重 / 总权重 * 容器面积。
 * - 每一步在剩余矩形的短边上试排一条带：
 *   - 剩余宽 >= 高：短边为高，条带是左侧竖条（orientation=vertical），
 *     厚度沿 x 方向，项目在条带内自上而下堆叠；
 *   - 剩余宽 < 高：短边为宽，条带是顶部横条（orientation=horizontal），
 *     厚度沿 y 方向，项目在条带内自左向右排列。
 *   宽高相等（正方形）时按 vertical 处理，两种取法几何上等价。
 * - 条带厚度 t = 条带面积和 / 短边长 s；项目长度 = 项目面积 / t。
 * - 长宽比一律取 长边/短边 >= 1，值越小越接近正方形。
 * - 尝试加入下一项：若加入后最差长宽比 <= 当前最差长宽比（含平局，
 *   平局容差 RATIO_EPS）则接受，否则拒绝并封存当前条带。
 * - 最后一个条带的厚度吸附到剩余容器边界（仅末条带，消除浮点残差，
 *   不用于掩盖面积偏差；吸附量受容差约束并由核验器复核）。
 * - 零权重项目保留编号与输入顺序，状态为 zero-weight，不参与条带、无矩形。
 */
export const RATIO_EPS = 1e-12;

function worstRatio(areas: number[], shortSide: number): number {
  const sum = areas.reduce((a, b) => a + b, 0);
  const thickness = sum / shortSide;
  let worst = 1;
  for (const a of areas) {
    const len = a / thickness;
    const ratio = Math.max(thickness, len) / Math.min(thickness, len);
    if (ratio > worst) worst = ratio;
  }
  return worst;
}

export function layout(req: LayoutRequest): LayoutResult {
  const { width, height, items, tolerance = 1e-6 } = req;
  const containerArea = width * height;

  const positive = items
    .map((it, inputIndex) => ({ ...it, inputIndex }))
    .filter((it) => it.weight > 0);
  positive.sort((a, b) => b.weight - a.weight || a.inputIndex - b.inputIndex);

  const totalWeight = positive.reduce((s, it) => s + it.weight, 0);
  const areas = positive.map((it) => (totalWeight > 0 ? (it.weight / totalWeight) * containerArea : 0));

  const placed = new Map<string, PlacedItem>();
  const strips: StripRecord[] = [];

  let rem: Rect = { x: 0, y: 0, width, height };
  let i = 0;

  while (i < positive.length) {
    const vertical = rem.width >= rem.height;
    const shortSide = vertical ? rem.height : rem.width;
    const stripAreas: number[] = [areas[i]];
    const stripIds: string[] = [positive[i].id];
    const attempts: StripAttempt[] = [];
    let areaSum = areas[i];
    let worst = worstRatio(stripAreas, shortSide);
    i++;
    let sealedReason = "已到最后一个项目，封存末条带";

    while (i < positive.length) {
      const candidate = positive[i];
      const before = worst;
      const after = worstRatio([...stripAreas, areas[i]], shortSide);
      if (after <= before + RATIO_EPS) {
        attempts.push({
          candidateId: candidate.id,
          shortSide,
          worstBefore: before,
          worstAfter: after,
          decision: "accept",
          reason:
            after <= before
              ? `加入后最差长宽比 ${after} 优于 ${before}，接受`
              : `加入后最差长宽比与 ${before} 持平（容差 ${RATIO_EPS}），按平局规则接受`,
        });
        stripAreas.push(areas[i]);
        stripIds.push(candidate.id);
        areaSum += areas[i];
        worst = after;
        i++;
      } else {
        attempts.push({
          candidateId: candidate.id,
          shortSide,
          worstBefore: before,
          worstAfter: after,
          decision: "reject-seal",
          reason: `加入后最差长宽比 ${after} 差于 ${before}，拒绝追加并封存当前条带`,
        });
        sealedReason = `候选 ${candidate.id} 使最差长宽比从 ${before} 变差为 ${after}，封条`;
        break;
      }
    }

    const isLastStrip = i >= positive.length;
    let thickness = areaSum / shortSide;
    const remainingExtent = vertical ? rem.width : rem.height;
    if (isLastStrip) {
      // 末条带边界吸附：厚度直接取剩余边长，消除浮点残差。
      thickness = remainingExtent;
    }

    let offset = 0;
    stripIds.forEach((id, k) => {
      const a = stripAreas[k];
      const len = a / thickness;
      const rect: Rect = vertical
        ? { x: rem.x, y: rem.y + offset, width: thickness, height: len }
        : { x: rem.x + offset, y: rem.y, width: len, height: thickness };
      placed.set(id, {
        id,
        weight: positive.find((p) => p.id === id)!.weight,
        inputIndex: positive.find((p) => p.id === id)!.inputIndex,
        sortedIndex: null,
        status: "placed",
        targetArea: a,
        rect,
      });
      offset += len;
    });

    strips.push({
      index: strips.length,
      orientation: vertical ? "vertical" : "horizontal",
      x: rem.x,
      y: rem.y,
      thickness,
      length: shortSide,
      itemIds: stripIds,
      attempts,
      sealedReason,
    });

    if (vertical) {
      rem = { x: rem.x + thickness, y: rem.y, width: rem.width - thickness, height: rem.height };
    } else {
      rem = { x: rem.x, y: rem.y + thickness, width: rem.width, height: rem.height - thickness };
    }
  }

  positive.forEach((p, idx) => {
    const item = placed.get(p.id);
    if (item) item.sortedIndex = idx;
  });

  const allItems: PlacedItem[] = items.map((it, inputIndex) => {
    const p = placed.get(it.id);
    if (p) return p;
    return {
      id: it.id,
      weight: it.weight,
      inputIndex,
      sortedIndex: null,
      status: "zero-weight" as const,
      targetArea: 0,
      rect: null,
    };
  });

  return { width, height, tolerance, items: allItems, strips };
}
