import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { LayoutStore } from "./db.js";
import { LayoutService } from "./service.js";
import { ApiError, ErrorCode } from "./validate.js";

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  INVALID_CONTAINER: 400,
  INVALID_ITEMS: 400,
  INVALID_ID: 400,
  DUPLICATE_ID: 400,
  INVALID_WEIGHT: 400,
  TOO_MANY_ITEMS: 413,
  NOT_FOUND: 404,
  BAD_REQUEST: 400,
  INTERNAL: 500,
};

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return {};
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError("BAD_REQUEST", "请求体不是合法 JSON");
  }
}

function send(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

function parseId(raw: string | undefined | null): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ApiError("BAD_REQUEST", `非法布局 id: ${String(raw)}`);
  }
  return id;
}

export function createApp(service: LayoutService) {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const parts = url.pathname.split("/").filter(Boolean);
      const method = req.method ?? "GET";

      if (method === "GET" && url.pathname === "/api/health") {
        return send(res, 200, { ok: true });
      }
      if (method === "POST" && url.pathname === "/api/layouts") {
        const body = (await readBody(req)) as Record<string, unknown>;
        const name = typeof body.name === "string" && body.name ? body.name : "未命名布局";
        const created = service.createLayout(name, body.container, body.items);
        return send(res, 201, created);
      }
      if (method === "GET" && url.pathname === "/api/layouts") {
        return send(res, 200, { layouts: service.listLayouts() });
      }
      if (method === "POST" && url.pathname === "/api/verify") {
        const body = (await readBody(req)) as Record<string, unknown>;
        return send(res, 200, service.verifyDirect(body.container, body.items, body.rects));
      }
      if (method === "GET" && parts[0] === "api" && parts[1] === "compare") {
        const a = parseId(url.searchParams.get("a"));
        const b = parseId(url.searchParams.get("b"));
        return send(res, 200, service.compare(a, b));
      }
      if (parts[0] === "api" && parts[1] === "layouts" && parts.length >= 3) {
        const id = parseId(parts[2]);
        if (method === "GET" && parts.length === 3) {
          return send(res, 200, service.getLayout(id));
        }
        if (method === "GET" && parts[3] === "rects") {
          return send(res, 200, service.getRects(id));
        }
        if (method === "GET" && parts[3] === "strips") {
          return send(res, 200, service.getStrips(id));
        }
        if (method === "GET" && parts[3] === "verify") {
          return send(res, 200, service.verify(id));
        }
      }
      throw new ApiError("NOT_FOUND", `未知路由: ${method} ${url.pathname}`);
    } catch (err) {
      if (err instanceof ApiError) {
        return send(res, STATUS_BY_CODE[err.code], {
          error: { code: err.code, message: err.message, details: err.details ?? null },
        });
      }
      const message = err instanceof Error ? err.message : String(err);
      return send(res, 500, { error: { code: "INTERNAL", message } });
    }
  });
}

/** 启动服务。port=0（默认）时让系统分配空闲端口。 */
export async function startServer(
  port: number = Number(process.env.PORT ?? 0),
  dbPath?: string
): Promise<{ port: number; close: () => Promise<void> }> {
  const store = new LayoutStore(dbPath);
  const service = new LayoutService(store);
  const app = createApp(service);
  await new Promise<void>((resolve) => app.listen(port, "127.0.0.1", resolve));
  const actual = (app.address() as AddressInfo).port;
  return {
    port: actual,
    close: async () => {
      await new Promise<void>((resolve) => app.close(() => resolve()));
      store.close();
    },
  };
}

const invokedAs = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] : false;
if (invokedAs) {
  const port = process.env.PORT ? Number(process.env.PORT) : 0;
  startServer(port).then(({ port }) => {
    console.log(`squarify 布局服务已启动: http://127.0.0.1:${port}`);
  });
}
