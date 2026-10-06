# Squarified 矩形树图布局与面积比例核验后端

离线、本地可运行的矩形树图（treemap）布局服务：把一组带唯一编号和非负权重的项目放入给定宽高的矩形容器，每个项目所得面积与其权重成比例，返回矩形坐标与完整条带决策过程，并提供独立几何核验。只做 API 与 CLI，不含网页绘图。

- 技术栈：TypeScript + Node.js（内置 `node:http` 与 `node:sqlite`，无原生/付费/在线依赖）
- 平台：Windows 本地运行，不需要 Docker / WSL
- 范围：一层平面列表、浮点坐标；不做多层树、物理切割排样、零件旋转、像素整数化
- 最优性说明：squarify 是贪心近似算法，输出不保证是所有可能划分中的全局最优

## 快速开始

```powershell
npm install        # 安装 devDependencies（typescript、@types/node）
npm run build      # 编译到 dist/
npm test           # 构建并运行全部测试
npm start          # 启动 API 服务（默认端口 0 = 自动选择空闲端口）
npm run demo       # 运行内置演示（等权四块 + 一大多小多条带）
```

数据目录默认为项目内 `data/`（SQLite 文件 `data/treemap.sqlite`），可用 `--data <目录>` 覆盖。重启后可用相同 id 查询相同报告。

## 算法规则（核心自行实现，未使用现成布局库）

1. 排序：权重降序；权重相等按原输入顺序（稳定排序）。
2. 目标面积：`面积_i = 权重_i / 总权重 × 容器面积`。
3. 条带方向：在剩余矩形的短边方向排一条带。
   - 剩余宽 >= 高：短边为高，在左侧放竖条（`vertical`），厚度沿 x 推进，项目自上而下堆叠；
   - 剩余宽 < 高：短边为宽，在顶部放横条（`horizontal`），厚度沿 y 推进，项目自左向右排列；
   - 正方形（宽 = 高）按竖条处理，两种取法几何等价。
4. 条带几何：厚度 `t = 条带面积和 / 短边长 s`；项目长度 `= 项目面积 / t`。
5. 长宽比：一律 `长边 / 短边 >= 1`，越小越接近正方形（不存在小于 1 的"更优"值）。
6. 接受规则：试排下一项，若加入后最差长宽比 `<=` 当前最差（含 `1e-12` 平局容差，平局接受）则加入；否则拒绝并封存当前条带，在剩余矩形中开新条带。
7. 末条带：最后一个条带厚度直接吸附到剩余容器边界，仅消除浮点残差，不用于掩盖面积偏差（核验器会复核）。
8. 零权重：保留编号与输入顺序，状态 `zero-weight`，不参与条带、无矩形；空列表与全零输入不会除零。
9. 确定性：相同输入与配置重算得到相同顺序与坐标。

该算法是贪心条带近似（Bruls et al. 的 squarify 思路），不枚举全部划分。

## 容差口径

- 默认相对容差 `tolerance = 1e-6`（可在请求中覆盖，合法区间 `(0, 0.5)`）。
- 面积比例：`|实际面积 - 目标面积| / 目标面积 <= tolerance`。
- 总面积：`|矩形面积和 - 容器面积| / 容器面积 <= tolerance`。
- 边界：允许 `max(宽,高) × tolerance` 的浮点越界；重叠：允许 `容器面积 × tolerance` 的重叠面积。
- 长宽比平局判定容差：`1e-12`（绝对值）。

## CLI

```powershell
node dist/src/cli.js serve --port 8080          # 启动 API（省略 --port 则自动选空闲端口）
node dist/src/cli.js create --width 4 --height 4 --items "A:1,B:1,C:1,D:1" --name demo
node dist/src/cli.js create --file request.json # 或从 JSON 文件创建
node dist/src/cli.js list                       # 列出全部布局
node dist/src/cli.js versions --name demo       # 比较同一名字的版本（改权重/宽高生成新版本，不覆盖旧的）
node dist/src/cli.js show --id 1                # 完整布局（矩形 + 条带）
node dist/src/cli.js item --id 1 --item A       # 单个项目坐标
node dist/src/cli.js strips --id 1              # 条带决策过程（候选、前后最差比、接受/封条原因）
node dist/src/cli.js verify --id 1              # 独立几何核验（失败时退出码为 2）
node dist/src/cli.js export --id 1 --out layout.json
node dist/src/cli.js rules                      # 算法规则说明
node dist/src/cli.js demo                       # 内置演示
```

## HTTP API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 健康检查 |
| GET | `/rules` | 算法规则说明 |
| POST | `/layouts` | 创建布局，Body：`{name?, width, height, items:[{id,weight}], tolerance?}` |
| GET | `/layouts?name=x` | 列出布局 / 同一名字的版本比较 |
| GET | `/layouts/:id` | 完整布局（输入、排序、矩形、条带） |
| GET | `/layouts/:id/items/:itemId` | 单个项目坐标 |
| GET | `/layouts/:id/strips` | 条带决策过程 |
| POST | `/layouts/:id/verify` | 独立几何核验 |
| GET | `/layouts/:id/export` | 导出 JSON（含核验报告） |

示例：

```powershell
curl -X POST http://localhost:8080/layouts -H "Content-Type: application/json" -d '{"name":"demo","width":4,"height":4,"items":[{"id":"A","weight":1},{"id":"B","weight":1},{"id":"C","weight":1},{"id":"D","weight":1}]}'
```

## 错误码

校验失败返回 HTTP 400（未找到 404），Body 为 `{"error":{"code","message"}}`，且不会产生任何布局记录：

| 错误码 | 含义 |
| --- | --- |
| `INVALID_CONTAINER` | 容器宽高不是有限数字 |
| `EMPTY_DIMENSION` | 容器宽高 <= 0 |
| `DUPLICATE_ID` | 项目编号重复 |
| `NEGATIVE_WEIGHT` | 权重为负 |
| `NON_FINITE_VALUE` | 权重为 NaN / Infinity |
| `INVALID_ID` | 编号为空或超长（>128） |
| `TOO_MANY_ITEMS` | 项目数超过上限 10000 |
| `INVALID_TOLERANCE` | 容差不在 (0, 0.5) |
| `NOT_FOUND` | 布局或项目不存在 |
| `BAD_REQUEST` | 请求格式错误 |

## 核验器

`verify` 只依据输出矩形与输入权重重新计算，不读取布局过程自报的成功标志，检查：

- 每个矩形在容器内（边界容差内）；
- 任意两矩形内部不重叠；
- 每个正面积项目恰好出现一次，面积与权重比例一致；
- 矩形面积之和与容器面积一致。

发现问题时返回具体项目编号与偏差数值（`issues[].itemIds` / `issues[].deviation`）。

## 持久化与版本

SQLite 保存原始输入、排序结果、算法规则与全部矩形/条带记录。相同 `name` 下每次创建自动递增 `version`，调整权重或容器宽高会生成新版本，旧布局保留可查，重启后报告一致。

## 测试覆盖

`npm test`（node:test，15 个用例）：单项目、长条容器（两个方向）、等权正方形、稳定排序、零权重混入、全零输入、空列表、权重同比缩放不变性、容器同比缩放（坐标线性 / 面积平方）、手算条带拒绝追加（4x4 容器权重 8,2,2,1,1,1，首条带最差比 1.875 vs 10/3）、确定性重算、篡改矩形被核验器发现、参数校验错误码、失败不产生布局、SQLite 重启读取与版本递增、HTTP API 端到端。

## 已知限制

- 仅一层平面列表，不支持多层树结构；
- 浮点坐标，不做像素整数化，因此极窄容器下小权重项目可能得到非常细长的矩形（算法固有特性）；
- 贪心近似，不保证全局最优长宽比；
- `node:sqlite` 在 Node 25 仍标记为 experimental（启动时有警告，不影响功能）；如需完全稳定的 API 可后续替换为 better-sqlite3。
