#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { LayoutStore } from "./db.js";
import { LayoutService } from "./service.js";
import { startServer } from "./server.js";
import { ApiError } from "./validate.js";

/**
 * CLI 用法：
 *   node dist/cli.js serve [--port N]
 *   node dist/cli.js create <input.json> [--name 名称]
 *   node dist/cli.js list
 *   node dist/cli.js rects <id>
 *   node dist/cli.js strips <id>
 *   node dist/cli.js verify <id>
 *   node dist/cli.js compare <idA> <idB>
 *   node dist/cli.js export <id> <out.json>
 *   node dist/cli.js demo
 *
 * input.json 形如：{ "container": {"width": 4, "height": 4}, "items": [{"id":"a","weight":1}] }
 */

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function fail(err: unknown): never {
  if (err instanceof ApiError) {
    console.error(`错误 [${err.code}] ${err.message}`);
  } else {
    console.error(`错误 ${err instanceof Error ? err.message : String(err)}`);
  }
  process.exit(1);
}

function parseId(raw: string | undefined): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    fail(new ApiError("BAD_REQUEST", `非法布局 id: ${String(raw)}`));
  }
  return id;
}

async function main(): Promise<void> {
  const [, , command, ...args] = process.argv;
  const service = new LayoutService(new LayoutStore());

  switch (command) {
    case "serve": {
      const portIdx = args.indexOf("--port");
      const port = portIdx >= 0 ? Number(args[portIdx + 1]) : process.env.PORT ? Number(process.env.PORT) : 0;
      const { port: actual } = await startServer(port);
      console.log(`squarify 布局服务已启动: http://127.0.0.1:${actual}`);
      return;
    }
    case "create": {
      const file = args[0];
      if (!file) fail(new ApiError("BAD_REQUEST", "缺少输入文件路径"));
      const nameIdx = args.indexOf("--name");
      const name = nameIdx >= 0 ? args[nameIdx + 1] : "未命名布局";
      const body = JSON.parse(readFileSync(file, "utf8"));
      const created = service.createLayout(name, body.container, body.items);
      printJson(created);
      return;
    }
    case "list":
      printJson(service.listLayouts());
      return;
    case "rects":
      printJson(service.getRects(parseId(args[0])));
      return;
    case "strips":
      printJson(service.getStrips(parseId(args[0])));
      return;
    case "verify":
      printJson(service.verify(parseId(args[0])));
      return;
    case "compare":
      printJson(service.compare(parseId(args[0]), parseId(args[1])));
      return;
    case "export": {
      const id = parseId(args[0]);
      const out = args[1];
      if (!out) fail(new ApiError("BAD_REQUEST", "缺少输出文件路径"));
      const row = service.getLayout(id);
      const report = service.verify(id);
      writeFileSync(out, JSON.stringify({ layout: row, verify: report }, null, 2), "utf8");
      console.log(`已导出布局 ${id} 到 ${out}`);
      return;
    }
    case "demo": {
      runDemo(service);
      return;
    }
    default:
      console.log(`用法:
  node dist/cli.js serve [--port N]      启动 API 服务（默认自动选空闲端口）
  node dist/cli.js create <in.json> [--name 名称]   创建布局（新版本，不覆盖旧布局）
  node dist/cli.js list                  列出所有布局版本
  node dist/cli.js rects <id>            查询项目坐标
  node dist/cli.js strips <id>           查看条带决策过程
  node dist/cli.js verify <id>           独立几何核验
  node dist/cli.js compare <idA> <idB>   比较两个版本
  node dist/cli.js export <id> <out.json> 导出 JSON
  node dist/cli.js demo                  运行内置演示`);
  }
}

function runDemo(service: LayoutService): void {
  console.log("=== 演示 1：正方形容器 + 四个等权项目 ===");
  const demo1 = service.createLayout(
    "demo-等权四块",
    { width: 4, height: 4 },
    [
      { id: "甲", weight: 1 },
      { id: "乙", weight: 1 },
      { id: "丙", weight: 1 },
      { id: "丁", weight: 1 },
    ]
  );
  for (const r of demo1.result.rects) {
    console.log(
      `  ${r.id}: x=${r.x} y=${r.y} w=${r.width} h=${r.height} 面积=${r.area}（目标 ${r.targetArea}）`
    );
  }
  const v1 = service.verify(demo1.id);
  console.log(`  核验: ${v1.ok ? "通过" : "失败"}（最大面积偏差 ${v1.checked.maxAreaDeviation}）`);

  console.log("\n=== 演示 2：一大多小权重（多条带 + 拒绝追加） ===");
  const demo2 = service.createLayout(
    "demo-一大多小",
    { width: 10, height: 6 },
    [
      { id: "大", weight: 50 },
      { id: "中", weight: 20 },
      { id: "小1", weight: 12 },
      { id: "小2", weight: 10 },
      { id: "小3", weight: 8 },
    ]
  );
  for (const s of demo2.result.strips) {
    console.log(`  条带 ${s.index} [${s.orientation}] 项目=[${s.itemIds.join(",")}] 厚度=${s.thickness}`);
    for (const t of s.trials) {
      const before = t.worstBefore === null ? "—" : t.worstBefore.toFixed(4);
      console.log(
        `    试排 ${t.candidateId}: 短边=${t.shortSide} 前=${before} 后=${t.worstAfter.toFixed(4)} => ${t.accepted ? "接受" : "拒绝"}（${t.reason}）`
      );
    }
  }
  const v2 = service.verify(demo2.id);
  console.log(`  核验: ${v2.ok ? "通过" : "失败"}（最大面积偏差 ${v2.checked.maxAreaDeviation}）`);
  console.log(`\n布局已保存为版本 ${demo1.id} 与 ${demo2.id}，可用 list/rects/strips/verify/compare/export 查询。`);
}

main().catch(fail);
