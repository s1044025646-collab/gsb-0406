import { ApiError, MAX_ITEMS } from "./errors";
import { LayoutRequest } from "./types";

export const DEFAULT_TOLERANCE = 1e-6;

export function validateRequest(req: unknown): LayoutRequest {
  if (typeof req !== "object" || req === null) {
    throw new ApiError("BAD_REQUEST", "请求体必须是 JSON 对象");
  }
  const r = req as Record<string, unknown>;

  for (const key of ["width", "height"] as const) {
    const v = r[key];
    if (typeof v !== "number" || !Number.isFinite(v)) {
      throw new ApiError("INVALID_CONTAINER", `容器 ${key} 必须是有限数字`);
    }
    if (v <= 0) {
      throw new ApiError("EMPTY_DIMENSION", `容器 ${key} 必须为正数，收到 ${v}`);
    }
  }

  if (!Array.isArray(r.items)) {
    throw new ApiError("BAD_REQUEST", "items 必须是数组");
  }
  if (r.items.length > MAX_ITEMS) {
    throw new ApiError("TOO_MANY_ITEMS", `项目数 ${r.items.length} 超过上限 ${MAX_ITEMS}`);
  }

  const seen = new Set<string>();
  const items = r.items.map((raw, i) => {
    if (typeof raw !== "object" || raw === null) {
      throw new ApiError("BAD_REQUEST", `items[${i}] 必须是对象`);
    }
    const it = raw as Record<string, unknown>;
    if (typeof it.id !== "string" || it.id.length === 0 || it.id.length > 128) {
      throw new ApiError("INVALID_ID", `items[${i}].id 必须是 1-128 字符的非空字符串`);
    }
    if (seen.has(it.id)) {
      throw new ApiError("DUPLICATE_ID", `项目编号重复: ${it.id}`);
    }
    seen.add(it.id);
    if (typeof it.weight !== "number" || !Number.isFinite(it.weight)) {
      throw new ApiError("NON_FINITE_VALUE", `项目 ${it.id} 的权重必须是有限数字`);
    }
    if (it.weight < 0) {
      throw new ApiError("NEGATIVE_WEIGHT", `项目 ${it.id} 的权重不能为负: ${it.weight}`);
    }
    return { id: it.id, weight: it.weight };
  });

  let tolerance = DEFAULT_TOLERANCE;
  if (r.tolerance !== undefined) {
    if (typeof r.tolerance !== "number" || !Number.isFinite(r.tolerance) || r.tolerance <= 0 || r.tolerance >= 0.5) {
      throw new ApiError("INVALID_TOLERANCE", "tolerance 必须是 (0, 0.5) 区间内的有限数");
    }
    tolerance = r.tolerance;
  }

  let name: string | undefined;
  if (r.name !== undefined) {
    if (typeof r.name !== "string" || r.name.length === 0 || r.name.length > 128) {
      throw new ApiError("BAD_REQUEST", "name 必须是 1-128 字符的字符串");
    }
    name = r.name;
  }

  return { name, width: r.width as number, height: r.height as number, items, tolerance };
}
