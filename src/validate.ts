import { ContainerSpec, LayoutItemInput } from "./types.js";

/** 公开规模上限：单布局最多项目数。 */
export const MAX_ITEMS = 10000;
export const MAX_ID_LENGTH = 128;

export type ErrorCode =
  | "INVALID_CONTAINER"
  | "INVALID_ITEMS"
  | "INVALID_ID"
  | "DUPLICATE_ID"
  | "INVALID_WEIGHT"
  | "TOO_MANY_ITEMS"
  | "NOT_FOUND"
  | "BAD_REQUEST"
  | "INTERNAL";

export class ApiError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function validateContainer(raw: unknown): ContainerSpec {
  if (typeof raw !== "object" || raw === null) {
    throw new ApiError("INVALID_CONTAINER", "容器必须为对象 {width, height}");
  }
  const { width, height } = raw as Record<string, unknown>;
  for (const [key, value] of [
    ["width", width],
    ["height", height],
  ] as const) {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      throw new ApiError("INVALID_CONTAINER", `容器 ${key} 必须为有限正数，收到: ${String(value)}`);
    }
  }
  return { width: width as number, height: height as number };
}

export function validateItems(raw: unknown): LayoutItemInput[] {
  if (!Array.isArray(raw)) {
    throw new ApiError("INVALID_ITEMS", "items 必须为数组");
  }
  if (raw.length > MAX_ITEMS) {
    throw new ApiError("TOO_MANY_ITEMS", `项目数 ${raw.length} 超过上限 ${MAX_ITEMS}`);
  }
  const seen = new Set<string>();
  const items: LayoutItemInput[] = [];
  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i] as Record<string, unknown>;
    if (typeof entry !== "object" || entry === null) {
      throw new ApiError("INVALID_ITEMS", `第 ${i} 项不是对象`);
    }
    const { id, weight } = entry;
    if (typeof id !== "string" || id.length === 0 || id.length > MAX_ID_LENGTH) {
      throw new ApiError("INVALID_ID", `第 ${i} 项 id 必须为 1~${MAX_ID_LENGTH} 字符的字符串`);
    }
    if (seen.has(id)) {
      throw new ApiError("DUPLICATE_ID", `重复编号: ${id}`);
    }
    if (typeof weight !== "number" || !Number.isFinite(weight) || weight < 0) {
      throw new ApiError("INVALID_WEIGHT", `项目 ${id} 的权重必须为有限非负数，收到: ${String(weight)}`);
    }
    seen.add(id);
    items.push({ id, weight });
  }
  return items;
}
