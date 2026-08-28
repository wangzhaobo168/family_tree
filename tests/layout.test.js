/* 布局与数据正确性测试：node tests/layout.test.js
 * 验证：至少 18 代、人数规模、父子一致性、同一代节点不重叠、父节点位于子区间内 */
'use strict';
const FamilyData = require('../js/data.js');
const TidyTree = require('../js/tidy-tree.js');

const NODE_W = 132, H_GAP = 26, V_GAP = 88;
let failures = 0;
function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); failures++; }
}

for (let seed = 1; seed <= 30; seed++) {
  const data = FamilyData.generate(seed);
  const { root, persons, stats } = data;

  assert(stats.maxGen >= 18, `seed ${seed}: maxGen=${stats.maxGen} < 18（至少 18 代）`);
  assert(persons.length >= 100, `seed ${seed}: 人数过少 ${persons.length}`);
  assert(persons.length < 3000, `seed ${seed}: 人数过多 ${persons.length}`);

  // 父子一致性
  for (const p of persons) {
    if (p.parent) assert(p.parent.children.includes(p), `seed ${seed}: ${p.name} 不在其父的 children 中`);
    if (p.fatherId != null) assert(p.fatherId === p.parent.id, `seed ${seed}: ${p.name} fatherId 不一致`);
  }

  // 布局（恒定间距，紧凑版）
  TidyTree(root, { nodeWidth: NODE_W, hGap: H_GAP });
  const nodes = [];
  (function walk(v) {
    v.y = (v.gen - 1) * V_GAP;
    nodes.push(v);
    v.children.forEach(walk);
  })(root);

  // 1) 同一代节点水平不重叠（核心不变量）
  const byGen = new Map();
  nodes.forEach(n => {
    if (!byGen.has(n.gen)) byGen.set(n.gen, []);
    byGen.get(n.gen).push(n);
  });
  for (const [gen, arr] of byGen) {
    arr.sort((a, b) => a.x - b.x);
    for (let i = 1; i < arr.length; i++) {
      const gap = arr[i].x - arr[i - 1].x;
      assert(gap >= NODE_W - 1e-6,
        `seed ${seed} gen${gen}: 重叠 ${arr[i-1].name}(${arr[i-1].x.toFixed(1)}) vs ${arr[i].name}(${arr[i].x.toFixed(1)}) 间距=${gap.toFixed(1)}`);
    }
  }

  // 2) 父节点位于首尾子节点之间
  (function c2(v) {
    if (v.children.length) {
      const first = v.children[0], last = v.children[v.children.length - 1];
      assert(v.x >= first.x - 0.01 && v.x <= last.x + 0.01,
        `seed ${seed}: 父 ${v.name} x=${v.x.toFixed(1)} 超出子区间 [${first.x.toFixed(1)}, ${last.x.toFixed(1)}]`);
      v.children.forEach(c2);
    }
  })(root);

  const maxX = Math.max(...nodes.map(n => n.x));
  console.log(`seed ${String(seed).padStart(2)}: ✓ ${String(persons.length).padStart(4)} 人, ${stats.maxGen} 世, 男${stats.male} 女${stats.female}, 在世${stats.alive}, 宽 ${maxX.toFixed(0)}px`);
}

// 网站实际使用的种子
const real = FamilyData.generate(20250520);
console.log(`\n网站种子 20250520: ${real.stats.total} 人, ${real.stats.maxGen} 世, 男${real.stats.male} 女${real.stats.female}, 在世${real.stats.alive}`);

console.log(failures ? `\n${failures} 处失败` : '\n全部测试通过 ✓');
process.exit(failures ? 1 : 0);
