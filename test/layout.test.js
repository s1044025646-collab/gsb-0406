import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { squarify } from "../dist/layout.js";
import { verifyLayout } from "../dist/verify.js";
import { LayoutStore } from "../dist/db.js";
import { LayoutService } from "../dist/service.js";
import { ApiError } from "../dist/validate.js";

const nearly = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b));

test("单项目填满整个容器", () => {
  const r = squarify([{ id: "only", weight: 5 }], { width: 3, height: 7 });
  assert.equal(r.rects.length, 1);
  const rect = r.rects[0];
  assert.ok(nearly(rect.x, 0) && nearly(rect.y, 0));
  assert.ok(nearly(rect.width, 3) && nearly(rect.height, 7));
  assert.ok(verifyLayout(r.rects, [{ id: "only", weight: 5 }], { width: 3, height: 7 }).ok);
});

test("正方形四个等权项目：四块等面积", () => {
  const items = [
    { id: "a", weight: 1 },
    { id: "b", weight: 1 },
    { id: "c", weight: 1 },
    { id: "d", weight: 1 },
  ];
  const r = squarify(items, { width: 4, height: 4 });
  assert.equal(r.rects.length, 4);
  for (const rect of r.rects) assert.ok(nearly(rect.area, 4), `面积应为 4，实际 ${rect.area}`);
  assert.ok(verifyLayout(r.rects, items, { width: 4, height: 4 }).ok);
});

test("长条容器布局合法且面积成比例", () => {
  const items = [
    { id: "a", weight: 5 },
    { id: "b", weight: 3 },
    { id: "c", weight: 2 },
  ];
  const container = { width: 100, height: 2 };
  const r = squarify(items, container);
  const report = verifyLayout(r.rects, items, container);
  assert.ok(report.ok, JSON.stringify(report.issues));
});

test("零权重项目保留编号但不产生矩形；全零与空列表不出错", () => {
  const mixed = [
    { id: "pos", weight: 2 },
    { id: "zero", weight: 0 },
  ];
  const r1 = squarify(mixed, { width: 4, height: 4 });
  assert.equal(r1.rects.length, 1);
  assert.deepEqual(r1.skipped, [{ id: "zero", reason: "zero-weight" }]);

  const r2 = squarify([{ id: "z1", weight: 0 }, { id: "z2", weight: 0 }], { width: 4, height: 4 });
  assert.equal(r2.rects.length, 0);
  assert.equal(r2.skipped.length, 2);
  assert.ok(verifyLayout(r2.rects, [{ id: "z1", weight: 0 }, { id: "z2", weight: 0 }], { width: 4, height: 4 }).ok);

  const r3 = squarify([], { width: 4, height: 4 });
  assert.equal(r3.rects.length, 0);
});

test("等权时按输入顺序稳定处理", () => {
  const r = squarify(
    [
      { id: "first", weight: 1 },
      { id: "second", weight: 1 },
      { id: "third", weight: 1 },
    ],
    { width: 9, height: 9 }
  );
  assert.deepEqual(r.order, ["first", "second", "third"]);
});

test("权重同比缩放布局不变；容器同比放大坐标线性、面积平方", () => {
  const items = [
    { id: "a", weight: 6 },
    { id: "b", weight: 4 },
    { id: "c", weight: 3 },
    { id: "d", weight: 2 },
    { id: "e", weight: 1 },
  ];
  const base = squarify(items, { width: 6, height: 4 });
  const scaledW = squarify(items.map((it) => ({ ...it, weight: it.weight * 7 })), { width: 6, height: 4 });
  assert.deepEqual(scaledW.rects, base.rects);

  const k = 2.5;
  const scaledC = squarify(items, { width: 6 * k, height: 4 * k });
  assert.equal(scaledC.rects.length, base.rects.length);
  for (let i = 0; i < base.rects.length; i++) {
    const b = base.rects[i];
    const s = scaledC.rects[i];
    assert.equal(s.id, b.id);
    assert.ok(nearly(s.x, b.x * k, 1e-9), `x: ${s.x} vs ${b.x * k}`);
    assert.ok(nearly(s.y, b.y * k, 1e-9));
    assert.ok(nearly(s.width, b.width * k, 1e-9));
    assert.ok(nearly(s.height, b.height * k, 1e-9));
    assert.ok(nearly(s.area, b.area * k * k, 1e-9));
  }
});

test("手算条带核对：6x6 容器，权重 [4,3,2,1]，出现一次拒绝追加", () => {
  const items = [
    { id: "w4", weight: 4 },
    { id: "w3", weight: 3 },
    { id: "w2", weight: 2 },
    { id: "w1", weight: 1 },
  ];
  const r = squarify(items, { width: 6, height: 6 });
  // 目标面积 14.4 / 10.8 / 7.2 / 3.6；短边 6。
  // 条带1: [14.4] 最差 2.5；加 10.8 后最差 1.6333（接受）；再加 7.2 后最差 4.05（拒绝）。
  assert.equal(r.strips.length, 3);
  assert.deepEqual(r.strips[0].itemIds, ["w4", "w3"]);
  assert.deepEqual(r.strips[1].itemIds, ["w2"]);
  assert.deepEqual(r.strips[2].itemIds, ["w1"]);

  const t0 = r.strips[0].trials;
  assert.ok(nearly(t0[0].worstAfter, 2.5));
  assert.ok(nearly(t0[1].worstBefore, 2.5));
  assert.ok(nearly(t0[1].worstAfter, 4.2 / (10.8 / 4.2)));
  assert.equal(t0[1].accepted, true);
  assert.ok(nearly(t0[2].worstAfter, 4.05, 1e-9));
  assert.equal(t0[2].accepted, false);

  // 条带1 为竖列（宽==高平局规则），厚度 25.2/6 = 4.2
  assert.equal(r.strips[0].orientation, "column");
  assert.ok(nearly(r.strips[0].thickness, 4.2));
  const w4 = r.rects.find((x) => x.id === "w4");
  assert.ok(nearly(w4.x, 0) && nearly(w4.y, 0));
  assert.ok(nearly(w4.width, 4.2) && nearly(w4.height, 14.4 / 4.2));

  const report = verifyLayout(r.rects, items, { width: 6, height: 6 });
  assert.ok(report.ok, JSON.stringify(report.issues));
});

test("长宽比始终 >= 1（长边/短边）", () => {
  const r = squarify(
    [
      { id: "a", weight: 8 },
      { id: "b", weight: 5 },
      { id: "c", weight: 3 },
    ],
    { width: 8, height: 5 }
  );
  for (const s of r.strips) {
    for (const t of s.trials) {
      assert.ok(t.worstAfter >= 1 - 1e-12, `最差比例 ${t.worstAfter} 不应小于 1`);
      if (t.worstBefore !== null) assert.ok(t.worstBefore >= 1 - 1e-12);
    }
  }
});

test("确定性：相同输入重算结果完全一致", () => {
  const items = [
    { id: "a", weight: 9 },
    { id: "b", weight: 7 },
    { id: "c", weight: 5 },
    { id: "d", weight: 3 },
    { id: "e", weight: 0 },
  ];
  const r1 = squarify(items, { width: 11, height: 7 });
  const r2 = squarify(items, { width: 11, height: 7 });
  assert.deepEqual(r1, r2);
});

test("核验器能发现篡改：越界、重叠、面积偏差", () => {
  const items = [
    { id: "a", weight: 1 },
    { id: "b", weight: 1 },
  ];
  const r = squarify(items, { width: 4, height: 4 });
  const tampered = r.rects.map((x) => ({ ...x }));
  tampered[0].width += 0.5;
  const report = verifyLayout(tampered, items, { width: 4, height: 4 });
  assert.equal(report.ok, false);
  const kinds = new Set(report.issues.map((i) => i.kind));
  assert.ok(kinds.has("out-of-bounds") || kinds.has("overlap"));
  assert.ok(kinds.has("area-mismatch"));
  assert.ok(report.issues.every((i) => i.itemIds.length > 0 || i.kind === "total-area-mismatch"));
});

test("参数校验：拒绝非法容器、重复编号、负权重、非有限值", () => {
  const dir = mkdtempSync(join(tmpdir(), "squarify-test-"));
  try {
    const service = new LayoutService(new LayoutStore(join(dir, "t.db")));
    assert.throws(() => service.createLayout("x", { width: 0, height: 4 }, []), ApiError);
    assert.throws(
      () => service.createLayout("x", { width: 4, height: 4 }, [{ id: "a", weight: 1 }, { id: "a", weight: 2 }]),
      /重复编号/
    );
    assert.throws(
      () => service.createLayout("x", { width: 4, height: 4 }, [{ id: "a", weight: -1 }]),
      /权重/
    );
    assert.throws(
      () => service.createLayout("x", { width: 4, height: 4 }, [{ id: "a", weight: Number.NaN }]),
      /权重/
    );
    assert.throws(
      () => service.createLayout("x", { width: Number.POSITIVE_INFINITY, height: 4 }, []),
      /有限正数/
    );
    assert.equal(service.listLayouts().length, 0);
    service.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("持久化：重启（重开数据库）后读取相同报告；新版本不覆盖旧布局", () => {
  const dir = mkdtempSync(join(tmpdir(), "squarify-test-"));
  const dbPath = join(dir, "t.db");
  try {
    const items = [
      { id: "a", weight: 3 },
      { id: "b", weight: 2 },
      { id: "c", weight: 1 },
    ];
    let firstId;
    {
      const service = new LayoutService(new LayoutStore(dbPath));
      const created = service.createLayout("v1", { width: 6, height: 6 }, items);
      firstId = created.id;
      service.close();
    }
    {
      const service = new LayoutService(new LayoutStore(dbPath));
      const row = service.getLayout(firstId);
      assert.equal(row.name, "v1");
      assert.equal(row.result.rects.length, 3);
      const report = service.verify(firstId);
      assert.ok(report.ok, JSON.stringify(report.issues));
      const v2 = service.createLayout("v2", { width: 6, height: 6 }, [
        { id: "a", weight: 5 },
        { id: "b", weight: 2 },
        { id: "c", weight: 1 },
      ]);
      assert.notEqual(v2.id, firstId);
      const oldAgain = service.getLayout(firstId);
      assert.deepEqual(oldAgain.items, items);
      assert.equal(service.listLayouts().length, 2);
      const cmp = service.compare(firstId, v2.id);
      assert.equal(cmp.containerChanged, false);
      assert.ok(cmp.items.length >= 3);
      service.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
