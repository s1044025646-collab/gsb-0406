import { layout } from "./squarify";
import { Store } from "./store";
import { verify } from "./verify";

export function runDemo(store: Store): void {
  console.log("=== 演示 1：正方形容器 + 四个等权项目（应得四块等面积区域） ===");
  const req1 = {
    name: "demo-equal",
    width: 4,
    height: 4,
    items: [
      { id: "A", weight: 1 },
      { id: "B", weight: 1 },
      { id: "C", weight: 1 },
      { id: "D", weight: 1 },
    ],
    tolerance: 1e-6,
  };
  const r1 = layout(req1);
  const s1 = store.createLayout(req1, r1);
  printResult(r1, s1.id);

  console.log("\n=== 演示 2：一大多小权重（多条带 + 一次拒绝追加） ===");
  const req2 = {
    name: "demo-mixed",
    width: 4,
    height: 4,
    items: [
      { id: "big", weight: 8 },
      { id: "m1", weight: 2 },
      { id: "m2", weight: 2 },
      { id: "s1", weight: 1 },
      { id: "s2", weight: 1 },
      { id: "s3", weight: 1 },
      { id: "empty", weight: 0 },
    ],
    tolerance: 1e-6,
  };
  const r2 = layout(req2);
  const s2 = store.createLayout(req2, r2);
  printResult(r2, s2.id);
}

function printResult(r: ReturnType<typeof layout>, layoutId: number): void {
  console.log(`布局 id=${layoutId}，容器 ${r.width}x${r.height}`);
  for (const st of r.strips) {
    console.log(
      `  条带#${st.index} [${st.orientation}] 起点(${st.x}, ${st.y}) 厚度=${st.thickness.toFixed(6)} 长度=${st.length} 项目=[${st.itemIds.join(", ")}]`
    );
    for (const at of st.attempts) {
      console.log(
        `    尝试 ${at.candidateId}: 短边=${at.shortSide} 前=${at.worstBefore} 后=${at.worstAfter} -> ${at.decision}（${at.reason}）`
      );
    }
    console.log(`    封条原因: ${st.sealedReason}`);
  }
  for (const it of r.items) {
    if (it.rect) {
      console.log(
        `  ${it.id}: rect=(${it.rect.x.toFixed(4)}, ${it.rect.y.toFixed(4)}, ${it.rect.width.toFixed(4)}, ${it.rect.height.toFixed(4)}) 面积=${(it.rect.width * it.rect.height).toFixed(6)} 目标=${it.targetArea.toFixed(6)}`
      );
    } else {
      console.log(`  ${it.id}: 状态=${it.status}（零权重，无矩形）`);
    }
  }
  const report = verify(r);
  console.log(`  核验: ${report.ok ? "通过" : "失败"}（总面积 ${report.placedArea} / ${report.containerArea}）`);
  if (!report.ok) console.log(JSON.stringify(report.issues, null, 2));
}
