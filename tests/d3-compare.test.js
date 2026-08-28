/* 对照实验：用官方 d3-hierarchy 的 tree 布局跑同一份数据，检查相同不变量
 * 运行：node --input-type=module tests/d3-compare.test.js （包内是 ESM）
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const FamilyData = require('../js/data.js');

const d3h = await import('D:/soft/node/node_global/node_modules/@wenyan-md/cli/node_modules/d3-hierarchy/src/index.js');

const NODE_W = 132, INTERVAL = 158;
let failures = 0;
function assert(cond, msg) { if (!cond) { console.error('FAIL:', msg); failures++; } }

const data = FamilyData.generate(20250520);
const hroot = d3h.hierarchy(data.root, d => d.children);
d3h.tree().separation((a, b) => (a.parent === b.parent ? 1 : 2) * INTERVAL)(hroot);

const nodes = hroot.descendants();
for (const n of nodes) { n.data.x = n.x; }

const byGen = new Map();
nodes.forEach(n => { if (!byGen.has(n.depth + 1)) byGen.set(n.depth + 1, []); byGen.get(n.depth + 1).push(n.data); });
for (const [gen, arr] of byGen) {
  arr.sort((a, b) => a.x - b.x);
  for (let i = 1; i < arr.length; i++) {
    assert(arr[i].x - arr[i - 1].x >= NODE_W - 1e-6,
      `gen${gen}: 重叠 ${arr[i-1].name}(${arr[i-1].x.toFixed(1)}) vs ${arr[i].name}(${arr[i].x.toFixed(1)})`);
  }
}

function range(v) {
  let min = v.x, max = v.x;
  for (const c of v.children) { const r = range(c); min = Math.min(min, r.min); max = Math.max(max, r.max); }
  v._r = { min, max };
  return v._r;
}
range(data.root);
let cross = 0;
(function check(v) {
  for (let i = 0; i < v.children.length; i++) {
    for (let j = i + 1; j < v.children.length; j++) {
      const a = v.children[i]._r, b = v.children[j]._r;
      if (!(a.max < b.min || b.max < a.min)) {
        cross++;
        if (cross <= 5) console.error(`FAIL: d3 兄弟子树交叉于 ${v.name}：${v.children[i].name}[${a.min.toFixed(1)},${a.max.toFixed(1)}] vs ${v.children[j].name}[${b.min.toFixed(1)},${b.max.toFixed(1)}]`);
      }
    }
    check(v.children[i]);
  }
})(data.root);
assert(cross === 0, `d3 自身有 ${cross} 处兄弟子树交叉`);

console.log(`d3 共 ${nodes.length} 节点, 失败 ${failures}`);
process.exit(failures ? 1 : 0);
