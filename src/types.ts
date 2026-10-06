/** 共享类型定义：布局输入、输出与条带决策记录。 */

export interface LayoutItemInput {
  id: string;
  weight: number;
}

export interface ContainerSpec {
  width: number;
  height: number;
}

/** 单个项目的最终矩形（浮点坐标，原点为容器左上角，x 向右，y 向下）。 */
export interface PlacedRect {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  area: number;
  targetArea: number;
}

/** 零权重项目：保留编号，不参与正面积条带。 */
export interface SkippedItem {
  id: string;
  reason: "zero-weight";
}

export interface StripTrial {
  candidateId: string;
  shortSide: number;
  worstBefore: number | null;
  worstAfter: number;
  accepted: boolean;
  reason: string;
}

export interface StripRecord {
  index: number;
  itemIds: string[];
  /** 条带沿短边方向推进："row" 表示沿 x 排一列厚度沿 y，"column" 表示沿 y 排一列厚度沿 x。 */
  orientation: "row" | "column";
  shortSide: number;
  thickness: number;
  containerBefore: { x: number; y: number; width: number; height: number };
  containerAfter: { x: number; y: number; width: number; height: number };
  trials: StripTrial[];
}

export interface LayoutResult {
  container: ContainerSpec;
  totalWeight: number;
  rects: PlacedRect[];
  skipped: SkippedItem[];
  strips: StripRecord[];
  /** 排序后的处理顺序（权重降序，等权按输入顺序稳定）。 */
  order: string[];
}
