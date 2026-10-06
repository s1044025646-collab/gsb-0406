import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { LayoutRequest, LayoutResult, PlacedItem, StripRecord } from "./types";

export interface LayoutSummary {
  id: number;
  name: string;
  version: number;
  width: number;
  height: number;
  itemCount: number;
  totalWeight: number;
  createdAt: string;
}

export interface LayoutRecord {
  summary: LayoutSummary;
  request: LayoutRequest;
  result: LayoutResult;
}

const ALGORITHM_RULES = {
  algorithm: "squarify-strip-greedy",
  sort: "权重降序，相等权重按输入顺序（稳定）",
  stripDirection: "剩余矩形短边方向；宽>=高取左侧竖条，否则顶部横条；正方形按竖条",
  acceptRule: "加入后最差长宽比 <= 当前最差（含 1e-12 平局容差）则接受，否则封条",
  aspectRatio: "长边/短边，>=1，越小越方",
  lastStrip: "末条带厚度吸附到剩余容器边界",
  optimality: "贪心近似，不保证全局最优划分",
};

export class Store {
  private db: DatabaseSync;

  constructor(dataDir: string) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(path.join(dataDir, "treemap.sqlite"));
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS layouts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        version INTEGER NOT NULL,
        width REAL NOT NULL,
        height REAL NOT NULL,
        item_count INTEGER NOT NULL,
        total_weight REAL NOT NULL,
        tolerance REAL NOT NULL,
        request_json TEXT NOT NULL,
        rules_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS items (
        layout_id INTEGER NOT NULL,
        item_id TEXT NOT NULL,
        weight REAL NOT NULL,
        input_index INTEGER NOT NULL,
        sorted_index INTEGER,
        status TEXT NOT NULL,
        target_area REAL NOT NULL,
        x REAL, y REAL, w REAL, h REAL,
        PRIMARY KEY (layout_id, item_id)
      );
      CREATE TABLE IF NOT EXISTS strips (
        layout_id INTEGER NOT NULL,
        strip_index INTEGER NOT NULL,
        orientation TEXT NOT NULL,
        x REAL NOT NULL, y REAL NOT NULL,
        thickness REAL NOT NULL, length REAL NOT NULL,
        item_ids TEXT NOT NULL,
        attempts_json TEXT NOT NULL,
        sealed_reason TEXT NOT NULL,
        PRIMARY KEY (layout_id, strip_index)
      );
    `);
  }

  createLayout(req: LayoutRequest, result: LayoutResult): LayoutSummary {
    const name = req.name ?? "default";
    const totalWeight = req.items.reduce((s, it) => s + it.weight, 0);
    const row = this.db
      .prepare("SELECT COALESCE(MAX(version), 0) + 1 AS v FROM layouts WHERE name = ?")
      .get(name) as { v: number };
    const version = row.v;
    const createdAt = new Date().toISOString();

    this.db.exec("BEGIN");
    try {
      const info = this.db
        .prepare(
          `INSERT INTO layouts (name, version, width, height, item_count, total_weight, tolerance, request_json, rules_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          name,
          version,
          req.width,
          req.height,
          req.items.length,
          totalWeight,
          result.tolerance,
          JSON.stringify(req),
          JSON.stringify(ALGORITHM_RULES),
          createdAt
        );
      const layoutId = Number(info.lastInsertRowid);

      const insItem = this.db.prepare(
        `INSERT INTO items (layout_id, item_id, weight, input_index, sorted_index, status, target_area, x, y, w, h)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const it of result.items) {
        insItem.run(
          layoutId,
          it.id,
          it.weight,
          it.inputIndex,
          it.sortedIndex,
          it.status,
          it.targetArea,
          it.rect?.x ?? null,
          it.rect?.y ?? null,
          it.rect?.width ?? null,
          it.rect?.height ?? null
        );
      }

      const insStrip = this.db.prepare(
        `INSERT INTO strips (layout_id, strip_index, orientation, x, y, thickness, length, item_ids, attempts_json, sealed_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const st of result.strips) {
        insStrip.run(
          layoutId,
          st.index,
          st.orientation,
          st.x,
          st.y,
          st.thickness,
          st.length,
          JSON.stringify(st.itemIds),
          JSON.stringify(st.attempts),
          st.sealedReason
        );
      }
      this.db.exec("COMMIT");
      return { id: layoutId, name, version, width: req.width, height: req.height, itemCount: req.items.length, totalWeight, createdAt };
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  listLayouts(name?: string): LayoutSummary[] {
    const rows = (name
      ? this.db.prepare("SELECT * FROM layouts WHERE name = ? ORDER BY version").all(name)
      : this.db.prepare("SELECT * FROM layouts ORDER BY id").all()) as unknown as Array<Record<string, unknown>>;
    return rows.map(summaryFromRow);
  }

  getLayout(id: number): LayoutRecord | null {
    const row = this.db.prepare("SELECT * FROM layouts WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    const itemRows = this.db
      .prepare("SELECT * FROM items WHERE layout_id = ? ORDER BY input_index")
      .all(id) as unknown as Array<Record<string, unknown>>;
    const stripRows = this.db
      .prepare("SELECT * FROM strips WHERE layout_id = ? ORDER BY strip_index")
      .all(id) as unknown as Array<Record<string, unknown>>;

    const items: PlacedItem[] = itemRows.map((r) => ({
      id: r.item_id as string,
      weight: r.weight as number,
      inputIndex: r.input_index as number,
      sortedIndex: r.sorted_index as number | null,
      status: r.status as PlacedItem["status"],
      targetArea: r.target_area as number,
      rect:
        r.x === null
          ? null
          : { x: r.x as number, y: r.y as number, width: r.w as number, height: r.h as number },
    }));
    const strips: StripRecord[] = stripRows.map((r) => ({
      index: r.strip_index as number,
      orientation: r.orientation as StripRecord["orientation"],
      x: r.x as number,
      y: r.y as number,
      thickness: r.thickness as number,
      length: r.length as number,
      itemIds: JSON.parse(r.item_ids as string),
      attempts: JSON.parse(r.attempts_json as string),
      sealedReason: r.sealed_reason as string,
    }));

    return {
      summary: summaryFromRow(row),
      request: JSON.parse(row.request_json as string),
      result: {
        width: row.width as number,
        height: row.height as number,
        tolerance: row.tolerance as number,
        items,
        strips,
      },
    };
  }

  getRules(): typeof ALGORITHM_RULES {
    return ALGORITHM_RULES;
  }

  close(): void {
    this.db.close();
  }
}

function summaryFromRow(row: Record<string, unknown>): LayoutSummary {
  return {
    id: row.id as number,
    name: row.name as string,
    version: row.version as number,
    width: row.width as number,
    height: row.height as number,
    itemCount: row.item_count as number,
    totalWeight: row.total_weight as number,
    createdAt: row.created_at as string,
  };
}
