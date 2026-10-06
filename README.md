# Squarified 矩形树图布局与面积比例核验后端

纯后端服务：把一组带唯一编号和非负权重的项目放入给定宽高的矩形容器，
每个项目所得面积与其权重成比例，返回浮点矩形坐标与完整条带决策过程，
并提供独立几何核验。仅做一层平面列表，不做多层树、网页绘图、物理切割
排样、零件旋转或像素整数化。布局结果为 squarify 贪心条带算法的确定解，
**不保证是所有可能划分中的全局最优**。

技术栈：TypeScript + Node.js（>= 22，使用内置 `node:sqlite`，无原生扩展）+ SQLite。
Windows 本地运行，不依赖 Docker / WSL / 外部在线服务。除开发依赖
`typescript`、`@types/node` 外无运行时第三方依赖，核心布局为自行实现。

## 快速开始

```powershell
npm install        # 安装开发依赖（typescript）
npm run build      # 编译到 dist/
npm test           # 构建并运行全部测试
npm start          # 启动 API 服务（默认自动选择空闲端口）
npm run demo       # 运行内置演示（等权四块 + 一大多小多条带）
```

端口配置：`set PORT=8080 && npm start`，或 `node dist/cli.js serve --port 8080`。
不指定端口时由系统分配空闲端口并打印实际地址。

数据目录：项目内 `data/squarify.db`（可用环境变量 `SQUARIFY_DATA_DIR` 或
`SQUARIFY_DB_PATH` 覆盖）。重启后可用相同 id 查询相同报告；每次
`create` 都插入新版本行，绝不更新或覆盖旧布局。

## CLI

```
node dist/cli.js serve [--port N]            启动 API 服务
node dist/cli.js create <in.json> [--name X] 创建布局（新版本）
node dist/cli.js list                        列出所有布局版本
node dist/cli.js rects <id>                  查询项目坐标
node dist/cli.js strips <id>                 查看条带决策过程
node dist/cli.js verify <id>                 独立几何核验
node dist/cli.js compare <idA> <idB>         比较两个版本（容器/坐标/面积差异）
node dist/cli.js export <id> <out.json>      导出布局与核验报告 JSON
node dist/cli.js demo                        内置演示
```

输入文件格式见 `examples/input.json`：

```json
{
  "container": { "width": 10, "height": 6 },
  "items": [{ "id": "大", "weight": 50 }]
}
```

## HTTP API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查 |
| POST | `/api/layouts` | 创建布局，body 同输入文件格式 |
| GET | `/api/layouts` | 列出全部版本 |
| GET | `/api/layouts/:id` | 查询完整布局（输入、规则、结果） |
| GET | `/api/layouts/:id/rects` | 查询项目坐标 |
| GET | `/api/layouts/:id/strips` | 查看条带决策过程 |
| GET | `/api/layouts/:id/verify` | 对库中布局运行独立核验 |
| POST | `/api/verify` | 独立核验：body 为 `{container, items, rects}` |
| GET | `/api/compare?a=1&b=2` | 比较两个版本 |

错误响应统一为 `{"error": {"code", "message", "details"}}`，错误码：
`INVALID_CONTAINER`（宽高非有限正数）、`INVALID_ITEMS`、`INVALID_ID`、
`DUPLICATE_ID`、`INVALID_WEIGHT`（负值/非有限）、`TOO_MANY_ITEMS`
（单布局超过 10000 项）、`NOT_FOUND`、`BAD_REQUEST`、`INTERNAL`。

## 布局算法规则（确定可复现）

1. 项目按权重降序排列，等权按原输入顺序稳定处理。
2. 目标面积 = 权重 / 总权重 × 容器面积。
3. 每步在剩余容器短边上试排一条带：剩余宽 ≥ 高时为竖列
   （`column`，厚度沿 x 推进），高 > 宽时为横行（`row`，厚度沿 y 推进）；
   宽 == 高（正方形）时固定按竖列处理。
4. 条带厚度 = 条带面积和 / 短边长度；条带内每项长度 = 该项面积 / 厚度。
5. 长宽比一律为 **长边 / 短边（≥ 1，越小越方）**。候选加入后最差比例
   ≤ 加入前则接受（平局接受），否则封存当前条带，候选进入下一条带。
6. 末条带封条时厚度吸附到剩余边界，仅消除浮点残差，不大幅挪动矩形。
7. 零权重项目保留编号、列入 `skipped`，不参与正面积条带；
   空列表与全零输入合法，返回空矩形集，不发生除零。

坐标系：原点为容器左上角，x 向右，y 向下，浮点坐标。相同输入与配置
重算得到完全相同的顺序与坐标。

## 核验口径与容差

核验器（`src/verify.ts`）只根据输出矩形、容器与原始权重重新检查，
不读取算法写入的任何成功标志。检查项：边界、两两内部重叠（共享边不算）、
逐项面积与权重比例、总面积与容器面积、重复/缺失/多余矩形、非正宽高。
发现问题时返回具体项目 id 与数值偏差。

容差（`DEFAULT_REL_TOL = 1e-9`）：

- 面积绝对容差 = max(容器面积, 1) × 1e-9 × 项目数
- 长度绝对容差 = max(容器最长边, 1) × √(1e-9)

浮点坐标下面积误差仅为 1e-12 量级，远小于容差；不会通过挪动矩形掩盖偏差。

## 演示

`npm run demo` 依次演示：

1. 4×4 正方形容器内四个等权项目，形成四块面积均为 4 的区域；
2. 10×6 容器内一大多小权重（50/20/12/10/8），展示多条带划分与
   一次“加入后最差比例变差”的拒绝追加决策，并逐条打印试排记录。

## 测试

`npm test` 覆盖：单项目、长条容器、相等权重、混入零项、全零输入、
空列表、权重同比缩放布局不变、容器同比放大坐标线性/面积平方、
手算条带核对比例比较、确定性重算、核验器发现篡改、参数校验失败
不产生布局、重启后读取相同报告、版本不覆盖。

## 限制

- 仅一层平面列表，不支持多层树结构。
- 贪心条带算法，不保证全局最优长宽比。
- 浮点坐标，不做像素整数化；极端权重比下小项会非常细长（算法固有特性）。
- 单布局项目数上限 10000。
