import http from "node:http";
import { ApiError } from "./errors";
import { layout } from "./squarify";
import { Store } from "./store";
import { validateRequest } from "./validate";
import { verify } from "./verify";

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body, null, 2);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(data);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = "";
    req.on("data", (c) => {
      buf += c;
      if (buf.length > 10 * 1024 * 1024) reject(new ApiError("BAD_REQUEST", "请求体过大", 413));
    });
    req.on("end", () => resolve(buf));
    req.on("error", reject);
  });
}

export function createServer(store: Store): http.Server {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const parts = url.pathname.split("/").filter(Boolean);
      const method = req.method ?? "GET";

      if (method === "GET" && url.pathname === "/health") {
        return sendJson(res, 200, { ok: true });
      }
      if (method === "GET" && url.pathname === "/rules") {
        return sendJson(res, 200, store.getRules());
      }

      if (method === "POST" && url.pathname === "/layouts") {
        const body = JSON.parse(await readBody(req));
        const request = validateRequest(body);
        const result = layout(request);
        const summary = store.createLayout(request, result);
        return sendJson(res, 201, { summary, result, verify: verify(result) });
      }

      if (method === "GET" && url.pathname === "/layouts") {
        return sendJson(res, 200, store.listLayouts(url.searchParams.get("name") ?? undefined));
      }

      if (parts[0] === "layouts" && parts.length >= 2) {
        const id = Number(parts[1]);
        if (!Number.isInteger(id)) throw new ApiError("BAD_REQUEST", "布局 id 必须是整数");
        const rec = store.getLayout(id);
        if (!rec) throw new ApiError("NOT_FOUND", `布局 ${id} 不存在`, 404);

        if (method === "GET" && parts.length === 2) {
          return sendJson(res, 200, rec);
        }
        if (method === "GET" && parts[2] === "items" && parts.length === 4) {
          const item = rec.result.items.find((it) => it.id === parts[3]);
          if (!item) throw new ApiError("NOT_FOUND", `布局 ${id} 中不存在项目 ${parts[3]}`, 404);
          return sendJson(res, 200, item);
        }
        if (method === "GET" && parts[2] === "strips") {
          return sendJson(res, 200, rec.result.strips);
        }
        if (method === "POST" && parts[2] === "verify") {
          return sendJson(res, 200, verify(rec.result));
        }
        if (method === "GET" && parts[2] === "export") {
          res.writeHead(200, {
            "Content-Type": "application/json; charset=utf-8",
            "Content-Disposition": `attachment; filename="layout-${id}.json"`,
          });
          return res.end(JSON.stringify({ ...rec, verify: verify(rec.result) }, null, 2));
        }
      }

      throw new ApiError("NOT_FOUND", `未知路由: ${method} ${url.pathname}`, 404);
    } catch (e) {
      if (e instanceof ApiError) {
        return sendJson(res, e.status, { error: { code: e.code, message: e.message } });
      }
      if (e instanceof SyntaxError) {
        return sendJson(res, 400, { error: { code: "BAD_REQUEST", message: "JSON 解析失败" } });
      }
      sendJson(res, 500, { error: { code: "INTERNAL", message: String(e) } });
    }
  });
}

export function startServer(store: Store, port: number): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer(store);
    server.listen(port, () => {
      const addr = server.address();
      const actual = typeof addr === "object" && addr ? addr.port : port;
      console.log(`API 服务已启动: http://localhost:${actual}`);
      resolve(actual);
    });
  });
}
