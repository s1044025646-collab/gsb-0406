import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ContainerSpec, LayoutItemInput, LayoutResult } from "./types.js";

/** 项目内数据目录：<项目根>/data */
const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const DATA_DIR = process.env.SQUARIFY_DATA_DIR ?? join(PROJECT_ROOT, "data");
export const DB_PATH = process.env.SQUARIFY_DB_PATH ?? join(DATA_DIR, "squarify.db");

const ALGORITHM_RULES = {
  name: "squarify-greedy-strip",
  version: 1,
  sort: "权重降序，等权按输入顺序稳定",
  aspectRatio: "长边/短边，>=1，越小越方",
  accept: "加入后最差比例 <= 加入前（平局接受）",
  tieBreak: "剩余宽==高时按竖列(column)处理",
  lastStrip: "末条带厚度吸附剩余边界以消除浮点残差",
} as const;

export interface LayoutRow {
  id: number;
  name: string;
  createdAt: string;
  container: ContainerSpec;
  items: LayoutItemInput[];
  result: LayoutResult;
}

export class LayoutStore {
  private db: DatabaseSync;

  constructor(dbPath: string = DB_PATH) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS layouts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        container TEXT NOT NULL,
        items TEXT NOT NULL,
        rules TEXT NOT NULL,
        result TEXT NOT NULL
      );
    `);
  }

  /** 保存一个新版本布局；从不更新已有行，保证旧布局不被覆盖。 */
  create(name: string, container: ContainerSpec, items: LayoutItemInput[], result: LayoutResult): number {
    const stmt = this.db.prepare(
      "INSERT INTO layouts (name, created_at, container, items, rules, result) VALUES (?, ?, ?, ?, ?, ?)"
    );
    const info = stmt.run(
      name,
      new Date().toISOString(),
      JSON.stringify(container),
      JSON.stringify(items),
      JSON.stringify(ALGORITHM_RULES),
      JSON.stringify(result)
    );
    return Number(info.lastInsertRowid);
  }

  get(id: number): LayoutRow | null {
    const row = this.db.prepare("SELECT * FROM layouts WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    return {
      id: row.id as number,
      name: row.name as string,
      createdAt: row.created_at as string,
      container: JSON.parse(row.container as string),
      items: JSON.parse(row.items as string),
      result: JSON.parse(row.result as string),
    };
  }

  list(): Array<{ id: number; name: string; createdAt: string; container: ContainerSpec; itemCount: number }> {
    const rows = this.db
      .prepare("SELECT id, name, created_at, container, items FROM layouts ORDER BY id")
      .all() as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: r.id as number,
      name: r.name as string,
      createdAt: r.created_at as string,
      container: JSON.parse(r.container as string),
      itemCount: (JSON.parse(r.items as string) as unknown[]).length,
    }));
  }

  close(): void {
    this.db.close();
  }
}
