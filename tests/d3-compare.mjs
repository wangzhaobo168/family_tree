/* 对照实验：我的 TidyTree 与官方 d3-hierarchy 的 tree 布局在相同数据上输出应完全一致
 * 运行：node tests/d3-compare.mjs
 */
import { createRequire } from 'module';
import { pathToFileURL } from 'url';
const require = createRequire(import.meta.url);
const FamilyData = require('../js/data.js');
const TidyTree = require('../js/tidy-tree.js');

const d3h = await import(pathToFileURL('D:/soft/node/node_global/node_modules/@wenyan-md/cli/node_modules/d3-hierarchy/src/index.js').href);

const NODE_W = 132, H_GAP = 26, INTERVAL = NODE_W + H_GAP;
let failures = 0;
function assert(cond, msg) { if (!cond) { console.error('FAIL:', msg); failures++; } }

const data = FamilyData.generate(20250520);

// ---------- 官方 d3 ----------
const hroot = d3h.hierarchy(data.root, d => d.children);
d3h.tree().separation((a, b) => (a.parent === b.parent ? 1 : 2) * INTERVAL)
         .nodeSize([1, 1])(hroot);   // nodeSize([1,1])：不归一化，抽象单位即像素
const d3x = new Map();
hroot.descendants().forEach(n => d3x.set(n.data.id, n.x));

// ---------- 我的实现（使用与 d3 相同的分离函数） ----------
TidyTree(data.root, {
  nodeWidth: NODE_W,
  hGap: H_GAP,
  separation: (a, b) => (a.parent === b.parent ? 1 : 2) * INTERVAL
});

// 1) 每个节点坐标应与 d3 完全一致
let maxDiff = 0, diffCount = 0;
for (const p of data.persons) {
  const d = Math.abs(p.x - d3x.get(p.id));
  if (d > 1e-9) { diffCount++; if (d > maxDiff) maxDiff = d; }
}
assert(diffCount === 0, `与 d3 不一致节点 ${diffCount} 个，最大差 ${maxDiff.toFixed(6)}`);

// 2) 同代（同深度）不重叠
const byGen = new Map();
data.persons.forEach(p => { if (!byGen.has(p.gen)) byGen.set(p.gen, []); byGen.get(p.gen).push(p); });
for (const [gen, arr] of byGen) {
  arr.sort((a, b) => a.x - b.x);
  for (let i = 1; i < arr.length; i++) {
    assert(arr[i].x - arr[i - 1].x >= NODE_W - 1e-6,
      `gen${gen}: 重叠 ${arr[i-1].name}(${arr[i-1].x.toFixed(1)}) vs ${arr[i].name}(${arr[i].x.toFixed(1)})`);
  }
}

// 3) 父节点位于首尾子节点之间
(function c2(v) {
  if (v.children.length) {
    const first = v.children[0], last = v.children[v.children.length - 1];
    assert(v.x >= first.x - 0.01 && v.x <= last.x + 0.01,
      `父 ${v.name} x=${v.x.toFixed(1)} 超出子区间 [${first.x.toFixed(1)}, ${last.x.toFixed(1)}]`);
    v.children.forEach(c2);
  }
})(data.root);

console.log(`d3 节点 ${data.persons.length} 个：${failures === 0 ? '与官方 d3 完全一致 ✓' : failures + ' 处失败'}`);
process.exit(failures ? 1 : 0);
