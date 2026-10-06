import fs from "node:fs";
import path from "node:path";
import { ApiError } from "./errors";
import { layout } from "./squarify";
import { startServer } from "./server";
import { Store } from "./store";
import { validateRequest } from "./validate";
import { verify } from "./verify";
import { runDemo } from "./demo";

const DATA_DIR = path.join(__dirname, "..", "..", "data");

function argValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

function parseItems(spec: string): { id: string; weight: number }[] {
  if (!spec) return [];
  return spec.split(",").map((pair) => {
    const idx = pair.lastIndexOf(":");
    if (idx <= 0) throw new ApiError("BAD_REQUEST", `项目格式应为 id:weight，收到 "${pair}"`);
    return { id: pair.slice(0, idx), weight: Number(pair.slice(idx + 1)) };
  });
}

function buildRequest(args: string[]): unknown {
  const file = argValue(args, "--file");
  if (file) return JSON.parse(fs.readFileSync(file, "utf-8"));
  const tol = argValue(args, "--tolerance");
  return {
    name: argValue(args, "--name"),
    width: Number(argValue(args, "--width")),
    height: Number(argValue(args, "--height")),
    items: parseItems(argValue(args, "--items") ?? ""),
    tolerance: tol === undefined ? undefined : Number(tol),
  };
}

function needId(args: string[]): number {
  const id = Number(argValue(args, "--id"));
  if (!Number.isInteger(id)) throw new ApiError("BAD_REQUEST", "需要 --id <整数>");
  return id;
}

function mustLayout(store: Store, id: number) {
  const rec = store.getLayout(id);
  if (!rec) throw new ApiError("NOT_FOUND", `布局 ${id} 不存在`, 404);
  return rec;
}

function main(): void {
  const [, , command, ...args] = process.argv;
  const store = new Store(argValue(args, "--data") ?? DATA_DIR);

  try {
    switch (command) {
      case "serve": {
        const port = Number(argValue(args, "--port") ?? 0);
        startServer(store, port);
        break;
      }
      case "create": {
        const req = validateRequest(buildRequest(args));
        const result = layout(req);
        const summary = store.createLayout(req, result);
        const report = verify(result);
        console.log(JSON.stringify({ summary, result, verify: report }, null, 2));
        if (!report.ok) process.exitCode = 2;
        break;
      }
      case "list":
        console.log(JSON.stringify(store.listLayouts(argValue(args, "--name")), null, 2));
        break;
      case "versions":
        console.log(JSON.stringify(store.listLayouts(argValue(args, "--name") ?? "default"), null, 2));
        break;
      case "show":
        console.log(JSON.stringify(mustLayout(store, needId(args)), null, 2));
        break;
      case "item": {
        const rec = mustLayout(store, needId(args));
        const itemId = argValue(args, "--item");
        const item = rec.result.items.find((it) => it.id === itemId);
        if (!item) throw new ApiError("NOT_FOUND", `项目 ${itemId} 不存在`, 404);
        console.log(JSON.stringify(item, null, 2));
        break;
      }
      case "strips":
        console.log(JSON.stringify(mustLayout(store, needId(args)).result.strips, null, 2));
        break;
      case "verify": {
        const report = verify(mustLayout(store, needId(args)).result);
        console.log(JSON.stringify(report, null, 2));
        if (!report.ok) process.exitCode = 2;
        break;
      }
      case "export": {
        const rec = mustLayout(store, needId(args));
        const out = JSON.stringify({ ...rec, verify: verify(rec.result) }, null, 2);
        const file = argValue(args, "--out");
        if (file) {
          fs.writeFileSync(file, out);
          console.log(`已导出到 ${file}`);
        } else {
          console.log(out);
        }
        break;
      }
      case "rules":
        console.log(JSON.stringify(store.getRules(), null, 2));
        break;
      case "demo":
        runDemo(store);
        break;
      default:
        console.log(`用法: node dist/src/cli.js <命令> [参数]
命令:
  serve [--port N] [--data DIR]     启动 API 服务（默认端口 0 = 自动选空闲端口）
  create --width W --height H --items "a:1,b:2" [--name N] [--file req.json]
  list [--name N]                   列出布局
  versions --name N                 比较同一名字的版本
  show --id N                       查看布局（含矩形与条带）
  item --id N --item ITEM           查询单个项目坐标
  strips --id N                     查看条带决策过程
  verify --id N                     独立几何核验
  export --id N [--out file.json]   导出 JSON
  rules                             查看算法规则说明
  demo                              运行内置演示`);
    }
  } catch (e) {
    if (e instanceof ApiError) {
      console.error(JSON.stringify({ error: { code: e.code, message: e.message } }));
      process.exitCode = 1;
    } else {
      throw e;
    }
  } finally {
    if (command !== "serve") store.close();
  }
}

main();
