/* 数据仓库单元测试：node tests/store.test.js */
'use strict';
const FamilyData = require('../js/data.js');
const FamilyStore = require('../js/store.js');

let failures = 0;
function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); failures++; }
}

function freshStore() {
  const store = FamilyStore.create();
  const gen = FamilyData.generate(20250520);
  const res = store.loadFromArray(gen.persons, { surname: gen.surname, poem: gen.poem });
  assert(res.ok, '初始化示例数据');
  return store;
}

// ---------- 基础 ----------
{
  const store = freshStore();
  const stats = store.getStats();
  assert(stats.total === 453, `示例数据 453 人（实际 ${stats.total}）`);
  assert(stats.maxGen === 24, `24 世（实际 ${stats.maxGen}）`);
  assert(store.getRoot() != null, '有始祖');
  assert(store.getSurname() === '林', '姓氏');
}

// ---------- 增 ----------
{
  const store = freshStore();
  const root = store.getRoot();
  const before = store.getStats().total;

  // 成功
  const res = store.addChild(root.id, {
    name: '测试之子', gender: 'M', birthYear: 1990, deathYear: '', spouse: '', note: '单元测试'
  });
  assert(res.ok, 'addChild 成功');
  assert(res.person.gen === 2, `gen 自动 = 2（实际 ${res.person.gen}）`);
  assert(res.person.parent === root, 'parent 引用正确');
  assert(store.getStats().total === before + 1, '人数 +1');
  assert(root.children[root.children.length - 1].id === res.person.id, '挂到父的 children');

  // 校验失败：空名
  const bad1 = store.addChild(root.id, { name: '  ', gender: 'M', birthYear: 1990 });
  assert(!bad1.ok && bad1.error.includes('姓名'), '空姓名被拒绝');

  // 校验失败：卒年早于生年
  const bad2 = store.addChild(root.id, { name: '林某', gender: 'M', birthYear: 1990, deathYear: 1900 });
  assert(!bad2.ok && bad2.error.includes('卒年'), '卒年早于生年被拒绝');

  // 无效父亲
  const bad3 = store.addChild(999999, { name: '林某', gender: 'M', birthYear: 1990 });
  assert(!bad3.ok, '无效父亲被拒绝');
}

// ---------- 改 ----------
{
  const store = freshStore();
  const root = store.getRoot();
  const before = store.getStats().total;
  const res = store.updatePerson(root.id, {
    name: '林始祖改', gender: 'M', birthYear: root.birthYear, deathYear: root.deathYear,
    spouse: root.spouse, note: '改过'
  });
  assert(res.ok, 'updatePerson 成功');
  assert(store.getById(root.id).name === '林始祖改', '姓名已改');
  assert(store.getStats().total === before, '人数不变');

  const bad = store.updatePerson(root.id, { name: 'x', gender: 'M', birthYear: 500 });
  assert(!bad.ok, '非法生年被拒绝');
}

// ---------- 删（含后代，二次确认计数） ----------
{
  const store = freshStore();
  // 找一个有后代的非始祖节点
  let target = null;
  store.getPersons().forEach(p => {
    if (!target && p !== store.getRoot() && p.children.length > 1) target = p;
  });
  assert(target != null, '找到测试目标');
  const subCount = store.countSubtree(target);
  assert(subCount > 1, `其后代子树 ${subCount} 人`);
  const before = store.getStats().total;

  const res = store.removePerson(target.id);
  assert(res.ok, 'removePerson 成功');
  assert(res.removed === subCount, `删除计数一致（${res.removed}）`);
  assert(store.getStats().total === before - subCount, `人数减少 ${subCount}`);
  assert(store.getById(target.id) == null, '目标已不存在');
  assert(!store.getPersons().some(p => p.fatherId === target.id), '无残留子引用');

  // 删除始祖被拒绝
  const rootRes = store.removePerson(store.getRoot().id);
  assert(!rootRes.ok, '删除始祖被拒绝');

  // 不存在
  assert(!store.removePerson(999999).ok, '删除不存在的人被拒绝');
}

// ---------- 导出 / 导入往返 ----------
{
  const store = freshStore();
  const json = store.exportJSON();
  const parsed = JSON.parse(json);
  assert(parsed.format === 'family-tree', '导出格式标记');
  assert(parsed.persons.length === 453, '导出 453 人');
  assert(parsed.persons[0].id != null && parsed.persons[0].name, '字段完整');

  // 导入导出的数据 → 重建
  const store2 = FamilyStore.create();
  const imp = store2.importJSON(json);
  assert(imp.ok, '导入成功');
  assert(store2.getStats().total === 453, '导入后人数一致');
  assert(store2.getStats().maxGen === 24, '导入后世代一致');
  assert(store2.getRoot().isFounder, '导入后始祖标记');

  // 树形结构校验一致性：导出再导入后名字集合一致
  const names1 = new Set(store.getPersons().map(p => p.name + p.gen + p.birthYear));
  const names2 = new Set(store2.getPersons().map(p => p.name + p.gen + p.birthYear));
  assert(names1.size === names2.size && [...names1].every(n => names2.has(n)), '导入导出内容一致');
}

// ---------- 导入格式兼容 ----------
{
  const store = FamilyStore.create();
  // 纯数组（始祖显式 id，其余引用其 id）
  const arr = [
    { name: '王始祖', gender: 'M', birthYear: 1500, id: 1 },
    { name: '王二代', gender: 'M', birthYear: 1530, fatherId: 1 },
    { name: '王二代女', gender: 'F', birthYear: 1535, fatherId: 1 }
  ];
  const res = store.importJSON(JSON.stringify(arr));
  assert(res.ok, '纯数组导入成功');
  assert(store.getStats().total === 3, '纯数组 3 人');
  assert(store.getRoot().name === '王始祖', '根为无父亲者');

  // 树形 {root}
  const store3 = FamilyStore.create();
  const tree = {
    root: {
      name: '赵始祖', gender: 'M', birthYear: 1400,
      children: [
        { name: '赵二', gender: 'M', birthYear: 1430, children: [{ name: '赵三', gender: 'F', birthYear: 1460 }] },
        { name: '赵二妹', gender: 'F', birthYear: 1435 }
      ]
    }
  };
  const res3 = store3.importJSON(JSON.stringify(tree));
  assert(res3.ok, '树形导入成功');
  assert(store3.getStats().total === 4, '树形 4 人');
  const root3 = store3.getRoot();
  assert(root3.name === '赵始祖', '树形根正确');
  assert(root3.children.length === 2, '树形二代 2 人');
  assert(root3.children[1].name === '赵二妹', '树形子女顺序');
  assert(store3.getById(root3.children[0].children[0].id).gen === 3, '树形 gen 推导');
}

// ---------- 导入坏数据 ----------
{
  const store = freshStore();
  const before = store.getStats().total;

  // 语法错误
  const r1 = store.importJSON('{oops');
  assert(!r1.ok, 'JSON 语法错误被拒绝');

  // 多根
  const r2 = store.importJSON(JSON.stringify([
    { name: '甲', gender: 'M', birthYear: 1500 },
    { name: '乙', gender: 'M', birthYear: 1510 }
  ]));
  assert(!r2.ok && r2.error.includes('始祖'), '多根被拒绝');

  // 环
  const r3 = store.importJSON(JSON.stringify([
    { name: '甲', gender: 'M', birthYear: 1500, id: 1, fatherId: 2 },
    { name: '乙', gender: 'M', birthYear: 1520, id: 2, fatherId: 1 }
  ]));
  assert(!r3.ok && r3.error.includes('循环'), '父子环被拒绝');

  // 孤立人员（父亲不存在且非唯一无父者）
  const r4 = store.importJSON(JSON.stringify([
    { name: '甲', gender: 'M', birthYear: 1500 },
    { name: '乙', gender: 'M', birthYear: 1520, fatherId: 999 }
  ]));
  assert(!r4.ok, '孤立人员被拒绝');

  // 字段非法
  const r5 = store.importJSON(JSON.stringify([
    { name: '甲', gender: 'M', birthYear: 1500 },
    { name: '', gender: 'M', birthYear: 1520, fatherId: 1 }
  ]));
  assert(!r5.ok && r5.error.includes('字段'), '空姓名被拒绝');

  // 全部失败后原数据未受影响
  assert(store.getStats().total === before, '失败导入不改动原数据');
  assert(store.getRoot().isFounder, '原数据完好');
}

// ---------- 编辑后导出再导入（改名流程） ----------
{
  const store = freshStore();
  const root = store.getRoot();
  store.updatePerson(root.id, { name: '林改新名', gender: 'M', birthYear: root.birthYear, deathYear: root.deathYear });
  const json = store.exportJSON();
  const store2 = FamilyStore.create();
  const res = store2.importJSON(json);
  assert(res.ok && store2.getRoot().name === '林改新名', '改名后导出导入保持');
}

console.log(failures ? `\n${failures} 处失败` : '\nstore 单元测试全部通过 ✓');
process.exit(failures ? 1 : 0);
