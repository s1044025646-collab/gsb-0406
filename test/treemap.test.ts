import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ApiError } from "../src/errors";
import { createServer } from "../src/server";
import { layout } from "../src/squarify";
import { Store } from "../src/store";
import { validateRequest } from "../src/validate";
import { verify } from "../src/verify";
import { LayoutRequest, LayoutResult } from "../src/types";

function req(partial: Partial<LayoutRequest>): LayoutRequest {
  return { width: 4, height: 4, items: [], tolerance: 1e-6, ...partial };
}

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "treemap-test-"));
}

test("单项目填满整个容器", () => {
  const r = layout(req({ width: 3, height: 5, items: [{ id: "only", weight: 7 }] }));
  const it = r.items[0];
  assert.equal(it.status, "placed");
  assert.deepEqual(it.rect, { x: 0, y: 0, width: 3, height: 5 });
  assert.ok(verify(r).ok);
});

test("长条容器使用短边方向条带", () => {
  const r = layout(req({
    width: 100,
    height: 2,
    items: [
      { id: "a", weight: 1 },
      { id: "b", weight: 1 },
    ],
  }));
  assert.equal(r.strips[0].orientation, "vertical"); // 短边是高=2，竖条
  assert.ok(verify(r).ok);
  const tall = layout(req({
    width: 2,
    height: 100,
    items: [
      { id: "a", weight: 1 },
      { id: "b", weight: 1 },
    ],
  }));
  assert.equal(tall.strips[0].orientation, "horizontal"); // 短边是宽=2，横条
  assert.ok(verify(tall).ok);
});

test("正方形容器四个等权项目面积相等", () => {
  const r = layout(req({
    items: [
      { id: "A", weight: 1 },
      { id: "B", weight: 1 },
      { id: "C", weight: 1 },
      { id: "D", weight: 1 },
    ],
  }));
  for (const it of r.items) {
    assert.ok(Math.abs(it.rect!.width * it.rect!.height - 4) < 1e-9);
  }
  assert.ok(verify(r).ok);
});

test("等权重按输入顺序稳定排序", () => {
  const r = layout(req({
    items: [
      { id: "z", weight: 1 },
      { id: "a", weight: 1 },
      { id: "m", weight: 1 },
    ],
  }));
  const sorted = r.items.filter((i) => i.sortedIndex !== null).sort((x, y) => x.sortedIndex! - y.sortedIndex!);
  assert.deepEqual(sorted.map((i) => i.id), ["z", "a", "m"]);
});

test("零权重项目保留编号但无矩形，全零输入不除零", () => {
  const r = layout(req({
    items: [
      { id: "p", weight: 2 },
      { id: "z", weight: 0 },
    ],
  }));
  const z = r.items.find((i) => i.id === "z")!;
  assert.equal(z.status, "zero-weight");
  assert.equal(z.rect, null);
  assert.ok(verify(r).ok);

  const allZero = layout(req({ items: [{ id: "a", weight: 0 }, { id: "b", weight: 0 }] }));
  assert.equal(allZero.strips.length, 0);
  assert.ok(allZero.items.every((i) => i.status === "zero-weight"));
  assert.ok(verify(allZero).ok);
});

test("空列表不产生条带也不报错", () => {
  const r = layout(req({ items: [] }));
  assert.equal(r.items.length, 0);
  assert.equal(r.strips.length, 0);
  assert.ok(verify(r).ok);
});

test("权重同比缩放布局不变", () => {
  const items = [
    { id: "a", weight: 5 },
    { id: "b", weight: 3 },
    { id: "c", weight: 2 },
    { id: "d", weight: 1 },
  ];
  const r1 = layout(req({ items }));
  const r2 = layout(req({ items: items.map((i) => ({ ...i, weight: i.weight * 37.5 })) }));
  assert.deepEqual(r1.items.map((i) => i.rect), r2.items.map((i) => i.rect));
  assert.deepEqual(r1.strips.map((s) => s.itemIds), r2.strips.map((s) => s.itemIds));
});

test("容器同比放大坐标线性变化、面积平方变化", () => {
  const items = [
    { id: "a", weight: 5 },
    { id: "b", weight: 3 },
    { id: "c", weight: 2 },
  ];
  const k = 2.5;
  const r1 = layout(req({ width: 4, height: 6, items }));
  const r2 = layout(req({ width: 4 * k, height: 6 * k, items }));
  for (const it1 of r1.items) {
    const it2 = r2.items.find((i) => i.id === it1.id)!;
    assert.ok(Math.abs(it2.rect!.x - it1.rect!.x * k) < 1e-9);
    assert.ok(Math.abs(it2.rect!.y - it1.rect!.y * k) < 1e-9);
    assert.ok(Math.abs(it2.rect!.width - it1.rect!.width * k) < 1e-9);
    assert.ok(Math.abs(it2.rect!.height - it1.rect!.height * k) < 1e-9);
    const a1 = it1.rect!.width * it1.rect!.height;
    const a2 = it2.rect!.width * it2.rect!.height;
    assert.ok(Math.abs(a2 - a1 * k * k) < 1e-6);
  }
});

test("手算条带核对：一大多小产生拒绝追加", () => {
  // 容器 4x4，权重 8,2,2,1,1,1，总面积 16，总权重 15
  // big 面积 = 128/15 ≈ 8.5333；m1 面积 = 32/15 ≈ 2.1333
  // 条带1 短边=4：big 单独 -> t=32/15≈2.1333，长=4，最差比 = 4/(32/15) = 1.875
  // 加入 m1 -> t=160/45=32/9≈3.5556... 不对，重算：
  //   sum = 128/15 + 32/15 = 160/15 = 32/3；t = (32/3)/4 = 8/3 ≈ 2.6667
  //   big 长 = (128/15)/(8/3) = 128/15*3/8 = 16/5 = 3.2 -> 比 = 3.2/(8/3) = 1.2
  //   m1 长 = (32/15)/(8/3) = 32/15*3/8 = 4/5 = 0.8 -> 比 = (8/3)/0.8 = 10/3 ≈ 3.3333
  //   最差 = 10/3 > 1.875 -> 拒绝，封条
  const r = layout(req({
    items: [
      { id: "big", weight: 8 },
      { id: "m1", weight: 2 },
      { id: "m2", weight: 2 },
      { id: "s1", weight: 1 },
      { id: "s2", weight: 1 },
      { id: "s3", weight: 1 },
    ],
  }));
  assert.ok(r.strips.length >= 2, "应产生多条带");
  const first = r.strips[0];
  assert.deepEqual(first.itemIds, ["big"]);
  assert.equal(first.attempts.length, 1);
  const attempt = first.attempts[0];
  assert.equal(attempt.candidateId, "m1");
  assert.equal(attempt.decision, "reject-seal");
  assert.ok(Math.abs(attempt.worstBefore! - 1.875) < 1e-9);
  assert.ok(Math.abs(attempt.worstAfter - 10 / 3) < 1e-9);
  // big 的矩形：厚 32/15，长 4
  const big = r.items.find((i) => i.id === "big")!;
  assert.ok(Math.abs(big.rect!.width - 32 / 15) < 1e-9);
  assert.ok(Math.abs(big.rect!.height - 4) < 1e-9);
  assert.ok(verify(r).ok);
});

test("相同输入重算结果一致（确定性）", () => {
  const items = [
    { id: "a", weight: 9 },
    { id: "b", weight: 4 },
    { id: "c", weight: 4 },
    { id: "d", weight: 1 },
  ];
  const r1 = layout(req({ width: 7, height: 3, items }));
  const r2 = layout(req({ width: 7, height: 3, items }));
  assert.deepEqual(r1, r2);
});

test("核验器能发现被篡改的矩形", () => {
  const r = layout(req({
    items: [
      { id: "a", weight: 3 },
      { id: "b", weight: 1 },
    ],
  }));
  const tampered: LayoutResult = JSON.parse(JSON.stringify(r));
  tampered.items[0].rect!.width *= 1.5; // 撑大 a，必与 b 重叠且面积不符
  const report = verify(tampered);
  assert.equal(report.ok, false);
  const kinds = report.issues.map((i) => i.kind);
  assert.ok(kinds.includes("overlap") || kinds.includes("out-of-bounds"));
  assert.ok(kinds.includes("area-mismatch"));
  assert.ok(report.issues.every((i) => i.itemIds.length >= 0 && typeof i.deviation === "number"));
});

test("参数校验错误码", () => {
  assert.throws(() => validateRequest({ width: -1, height: 2, items: [] }), (e: ApiError) => e.code === "EMPTY_DIMENSION");
  assert.throws(() => validateRequest({ width: Number.NaN, height: 2, items: [] }), (e: ApiError) => e.code === "INVALID_CONTAINER");
  assert.throws(
    () => validateRequest({ width: 1, height: 1, items: [{ id: "a", weight: 1 }, { id: "a", weight: 2 }] }),
    (e: ApiError) => e.code === "DUPLICATE_ID"
  );
  assert.throws(
    () => validateRequest({ width: 1, height: 1, items: [{ id: "a", weight: -1 }] }),
    (e: ApiError) => e.code === "NEGATIVE_WEIGHT"
  );
  assert.throws(
    () => validateRequest({ width: 1, height: 1, items: [{ id: "a", weight: Number.POSITIVE_INFINITY }] }),
    (e: ApiError) => e.code === "NON_FINITE_VALUE"
  );
  assert.throws(
    () => validateRequest({ width: 1, height: 1, items: [{ id: "", weight: 1 }] }),
    (e: ApiError) => e.code === "INVALID_ID"
  );
});

test("校验失败不产生成功布局记录", () => {
  const store = new Store(tmpDir());
  const before = store.listLayouts().length;
  assert.throws(() =>
    validateRequest({ width: 4, height: 4, items: [{ id: "a", weight: 1 }, { id: "a", weight: 2 }] })
  );
  assert.equal(store.listLayouts().length, before);
  store.close();
});

test("重启后读取相同报告（SQLite 持久化 + 版本递增）", () => {
  const dir = tmpDir();
  const request = validateRequest({
    name: "persist",
    width: 4,
    height: 4,
    items: [
      { id: "a", weight: 3 },
      { id: "b", weight: 1 },
    ],
  });
  const store1 = new Store(dir);
  const result1 = layout(request);
  const s1 = store1.createLayout(request, result1);
  // 调整权重创建新版本，不覆盖旧布局
  const request2 = { ...request, items: [{ id: "a", weight: 5 }, { id: "b", weight: 1 }] };
  const s2 = store1.createLayout(request2, layout(request2));
  store1.close();

  const store2 = new Store(dir);
  const rec = store2.getLayout(s1.id)!;
  assert.deepEqual(rec.result, result1);
  assert.ok(verify(rec.result).ok);
  const versions = store2.listLayouts("persist");
  assert.equal(versions.length, 2);
  assert.equal(versions[0].version, 1);
  assert.equal(versions[1].version, 2);
  assert.equal(s2.version, 2);
  store2.close();
});

test("HTTP API 端到端", async () => {
  const store = new Store(tmpDir());
  const server = createServer(store);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as { port: number }).port;
  const base = `http://localhost:${port}`;

  const created = await fetch(`${base}/layouts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "api",
      width: 4,
      height: 4,
      items: [
        { id: "a", weight: 3 },
        { id: "b", weight: 1 },
        { id: "z", weight: 0 },
      ],
    }),
  });
  assert.equal(created.status, 201);
  const body = await created.json();
  assert.equal(body.verify.ok, true);
  const id = body.summary.id;

  const item = await (await fetch(`${base}/layouts/${id}/items/a`)).json();
  assert.equal(item.id, "a");
  assert.ok(item.rect.width > 0);

  const strips = await (await fetch(`${base}/layouts/${id}/strips`)).json();
  assert.ok(Array.isArray(strips));

  const ver = await (await fetch(`${base}/layouts/${id}/verify`, { method: "POST" })).json();
  assert.equal(ver.ok, true);

  const versions = await (await fetch(`${base}/layouts?name=api`)).json();
  assert.equal(versions.length, 1);

  const bad = await fetch(`${base}/layouts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ width: 4, height: 4, items: [{ id: "x", weight: -1 }] }),
  });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error.code, "NEGATIVE_WEIGHT");

  const missing = await fetch(`${base}/layouts/9999`);
  assert.equal(missing.status, 404);

  server.close();
  store.close();
});
