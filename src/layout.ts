import {
  ContainerSpec,
  LayoutItemInput,
  LayoutResult,
  PlacedRect,
  StripRecord,
  StripTrial,
} from "./types.js";

/**
 * Squarified 矩形树图核心布局（自行实现的贪心条带算法，不依赖任何布局库）。
 *
 * 规则（README 中有同样口径）：
 * 1. 项目按权重降序排列，等权时按原输入顺序稳定处理。
 * 2. 目标面积 = 权重 / 总权重 * 容器面积。
 * 3. 每一步在剩余容器的短边上试排一条带：
 *    - 剩余宽 >= 高时，条带为竖列（orientation="column"），厚度沿 x 方向推进；
 *    - 剩余高 > 宽时，条带为横行（orientation="row"），厚度沿 y 方向推进；
 *    - 宽 == 高（正方形）时按竖列处理（固定平局规则，保证确定性）。
 * 4. 条带厚度 t = 条带面积和 / 短边长度；条带内每项长度 = 该项面积 / t。
 * 5. 长宽比一律取 长边 / 短边（>= 1，越小越方）。候选加入后最差比例
 *    不劣于加入前（<=，平局接受）则接受，否则封条，候选进入下一条带。
 * 6. 封条后立即在剩余容器上开始新条带，直到项目耗尽。
 * 7. 末条带封条时厚度吸附到剩余容器边界（仅消除浮点残差，不大幅挪动矩形）。
 */

interface WorkItem {
  id: string;
  weight: number;
  area: number;
  inputIndex: number;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 条带内加入一组面积后的最差长宽比（长/短，>=1）。 */
function worstRatio(areas: number[], shortSide: number): number {
  const sum = areas.reduce((a, b) => a + b, 0);
  const thickness = sum / shortSide;
  let worst = 0;
  for (const a of areas) {
    const len = a / thickness;
    const ratio = Math.max(thickness, len) / Math.min(thickness, len);
    if (ratio > worst) worst = ratio;
  }
  return worst;
}

export function squarify(items: LayoutItemInput[], container: ContainerSpec): LayoutResult {
  const totalArea = container.width * container.height;
  const positive = items.filter((it) => it.weight > 0);
  const skipped = items
    .filter((it) => it.weight === 0)
    .map((it) => ({ id: it.id, reason: "zero-weight" as const }));
  const totalWeight = positive.reduce((a, it) => a + it.weight, 0);

  const sorted: WorkItem[] = positive
    .map((it, inputIndex) => ({ id: it.id, weight: it.weight, area: 0, inputIndex }))
    .sort((a, b) => b.weight - a.weight || a.inputIndex - b.inputIndex);
  for (const it of sorted) {
    it.area = (it.weight / totalWeight) * totalArea;
  }

  const rects: PlacedRect[] = [];
  const strips: StripRecord[] = [];
  let remaining: Rect = { x: 0, y: 0, width: container.width, height: container.height };
  let stripAreas: number[] = [];
  let stripItems: WorkItem[] = [];
  let trials: StripTrial[] = [];
  let stripIndex = 0;

  const fixStrip = (isLast: boolean) => {
    const shortSide = Math.min(remaining.width, remaining.height);
    const orientation: "row" | "column" = remaining.height > remaining.width ? "row" : "column";
    const sum = stripAreas.reduce((a, b) => a + b, 0);
    let thickness = sum / shortSide;
    const before = { ...remaining };
    // 末条带边界吸附：吃掉浮点残差，保证矩形恰好填满容器。
    if (isLast) {
      thickness = orientation === "column" ? remaining.width : remaining.height;
    }
    let offset = 0;
    for (let i = 0; i < stripItems.length; i++) {
      const it = stripItems[i];
      const len = stripAreas[i] / thickness;
      let rect: PlacedRect;
      if (orientation === "column") {
        rect = {
          id: it.id,
          x: remaining.x,
          y: remaining.y + offset,
          width: thickness,
          height: len,
          area: thickness * len,
          targetArea: it.area,
        };
      } else {
        rect = {
          id: it.id,
          x: remaining.x + offset,
          y: remaining.y,
          width: len,
          height: thickness,
          area: thickness * len,
          targetArea: it.area,
        };
      }
      rects.push(rect);
      offset += len;
    }
    if (orientation === "column") {
      remaining = {
        x: remaining.x + thickness,
        y: remaining.y,
        width: remaining.width - thickness,
        height: remaining.height,
      };
    } else {
      remaining = {
        x: remaining.x,
        y: remaining.y + thickness,
        width: remaining.width,
        height: remaining.height - thickness,
      };
    }
    // 消除可能产生的 -0 与极小负残差。
    if (Math.abs(remaining.width) < 1e-9) remaining.width = 0;
    if (Math.abs(remaining.height) < 1e-9) remaining.height = 0;
    strips.push({
      index: stripIndex++,
      itemIds: stripItems.map((it) => it.id),
      orientation,
      shortSide,
      thickness,
      containerBefore: before,
      containerAfter: { ...remaining },
      trials,
    });
    stripAreas = [];
    stripItems = [];
    trials = [];
  };

  for (let i = 0; i < sorted.length; i++) {
    const it = sorted[i];
    const shortSide = Math.min(remaining.width, remaining.height);
    const before = stripAreas.length === 0 ? null : worstRatio(stripAreas, shortSide);
    const after = worstRatio([...stripAreas, it.area], shortSide);
    const accepted = before === null || after <= before;
    const reason =
      before === null
        ? "空条带，直接接受首项"
        : accepted
          ? after === before
            ? "加入后最差比例持平（平局接受）"
            : "加入后最差比例改善"
          : "加入后最差比例变差，封条并转入下一条带";
    trials.push({
      candidateId: it.id,
      shortSide,
      worstBefore: before,
      worstAfter: after,
      accepted,
      reason,
    });
    if (accepted) {
      stripAreas.push(it.area);
      stripItems.push(it);
    } else {
      fixStrip(false);
      // 候选进入新条带（新条带首项必被接受，记录一条说明性试排）。
      const newShort = Math.min(remaining.width, remaining.height);
      const newAfter = worstRatio([it.area], newShort);
      trials.push({
        candidateId: it.id,
        shortSide: newShort,
        worstBefore: null,
        worstAfter: newAfter,
        accepted: true,
        reason: "空条带，直接接受首项（上一条带已封存）",
      });
      stripAreas.push(it.area);
      stripItems.push(it);
    }
  }
  if (stripItems.length > 0) {
    fixStrip(true);
  }

  return {
    container: { ...container },
    totalWeight,
    rects,
    skipped,
    strips,
    order: sorted.map((it) => it.id),
  };
}
