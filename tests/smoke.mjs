/* 交互冒烟测试：通过 Chrome DevTools Protocol 驱动真实浏览器
 * 验证：点击节点弹详情、缩放、折叠分支、搜索、移动端布局
 * 运行：node tests/smoke.mjs （需先启动 node server.js）
 */
import { spawn } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const DEBUG_PORT = 9333;
const URL = 'http://127.0.0.1:8090/';
const userData = mkdtempSync(join(tmpdir(), 'ft-smoke-'));

let failures = 0;
function check(cond, msg) {
  console.log((cond ? '  ✓ ' : '  ✗ ') + msg);
  if (!cond) failures++;
}

// ---------- 启动 Chrome ----------
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run',
  '--remote-debugging-port=' + DEBUG_PORT,
  '--user-data-dir=' + userData,
  '--window-size=1400,900',
  URL
], { stdio: 'ignore' });

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ---------- 连接 CDP ----------
async function getPageWs() {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
      const list = await res.json();
      const page = list.find(t => t.type === 'page' && t.url.includes('8090'));
      if (page) return page.webSocketDebuggerUrl;
    } catch (e) { /* chrome 未就绪 */ }
    await sleep(200);
  }
  throw new Error('无法连接 Chrome DevTools');
}

const wsUrl = await getPageWs();
const ws = new WebSocket(wsUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });

let msgId = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
};
function send(method, params = {}) {
  return new Promise((resolve) => {
    const id = ++msgId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evalJs(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.result && r.result.exceptionDetails) {
    throw new Error('JS 异常: ' + JSON.stringify(r.result.exceptionDetails.exception));
  }
  return r.result ? r.result.result.value : undefined;
}

await send('Runtime.enable');
await send('Page.enable');
// 全程收集运行期异常
const errors = [];
const origOn = ws.onmessage;
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.method === 'Runtime.exceptionThrown') {
    errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
  }
  origOn(ev);
};
await sleep(1500);

// ---------- 1. 页面基本渲染 ----------
const cards = await evalJs("document.querySelectorAll('.node .card').length");
const edges = await evalJs("document.querySelectorAll('.edge').length");
const stat = await evalJs("document.getElementById('statLine').textContent");
check(cards === 453, `渲染 453 个节点卡片（实际 ${cards}）`);
check(edges === 452, `渲染 452 条连线（实际 ${edges}）`);
check(stat.includes('24 世'), `统计行显示 24 世：${stat}`);

// ---------- 2. 点击节点 → 详情面板 ----------
const clickRes = await evalJs(`(function(){
  const node = document.querySelector('.node');
  const r = node.getBoundingClientRect();
  const svg = document.getElementById('treeSvg');
  const cx = r.x + r.width/2, cy = r.y + r.height/2;
  svg.dispatchEvent(new PointerEvent('pointerdown', {pointerId:1, clientX:cx, clientY:cy, bubbles:true}));
  svg.dispatchEvent(new PointerEvent('pointerup',   {pointerId:1, clientX:cx, clientY:cy, bubbles:true}));
  return new Promise(res => setTimeout(() => {
    const panel = document.getElementById('detailPanel');
    res({ visible: !panel.classList.contains('hidden'),
          name: (document.querySelector('.dp-name')||{}).textContent || '' });
  }, 100));
})()`);
check(clickRes.visible, `点击节点后详情面板显示`);
check(clickRes.name.length > 0, `详情面板显示姓名：${clickRes.name}`);

// ---------- 3. 缩放按钮 ----------
const z0 = await evalJs("document.getElementById('zoomLabel').textContent");
await evalJs("document.getElementById('zoomIn').click()");
await sleep(200);
const z1 = await evalJs("document.getElementById('zoomLabel').textContent");
check(z0 !== z1, `放大按钮生效：${z0} → ${z1}`);

// ---------- 4. 折叠分支（在目标按钮处滚轮放大后点击） ----------
const c0 = await evalJs("document.querySelectorAll('.node').length");
const collapseRes = await evalJs(`(async function(){
  const svg = document.getElementById('treeSvg');
  // 取第一个折叠按钮，在其屏幕中心滚轮放大（按钮会固定在指针下变大）
  const btn = document.querySelector('.node .cbtn');
  let r = btn.getBoundingClientRect();
  const cx = r.x + r.width/2, cy = r.y + r.height/2;
  for (let i = 0; i < 8; i++) {
    svg.dispatchEvent(new WheelEvent('wheel', { clientX: cx, clientY: cy, deltaY: -300, bubbles: true, cancelable: true }));
    await new Promise(res => setTimeout(res, 60));
  }
  await new Promise(res => setTimeout(res, 150));
  // 点击按钮
  r = btn.getBoundingClientRect();
  const bx = r.x + r.width/2, by = r.y + r.height/2;
  svg.dispatchEvent(new PointerEvent('pointerdown', {pointerId:2, clientX:bx, clientY:by, bubbles:true}));
  svg.dispatchEvent(new PointerEvent('pointerup',   {pointerId:2, clientX:bx, clientY:by, bubbles:true}));
  await new Promise(res => setTimeout(res, 250));
  return { count: document.querySelectorAll('.node').length, zoom: document.getElementById('zoomLabel').textContent };
})()`);
check(collapseRes.count < c0, `折叠分支后节点减少（缩放 ${collapseRes.zoom}）：${c0} → ${collapseRes.count}`);

// ---------- 5. 展开全部 ----------
await evalJs("document.getElementById('btnExpandAll').click()");
await sleep(300);
const c2 = await evalJs("document.querySelectorAll('.node').length");
check(c2 === 453, `展开全部后恢复 453 节点（实际 ${c2}）`);

// ---------- 6. 搜索 ----------
const searchRes = await evalJs(`(function(){
  const input = document.getElementById('searchInput');
  input.value = '忠';
  input.dispatchEvent(new Event('input', {bubbles:true}));
  return new Promise(res => setTimeout(() => {
    const items = document.querySelectorAll('.sr-item').length;
    const first = document.querySelector('.sr-item');
    if (first) first.click();
    setTimeout(() => {
      res({ items, panel: !document.getElementById('detailPanel').classList.contains('hidden') });
    }, 200);
  }, 100));
})()`);
check(searchRes.items > 0, `搜索「忠」返回 ${searchRes.items} 条结果`);
check(searchRes.panel, '点击搜索结果后定位并显示详情');

// ---------- 7. 移动端布局 ----------
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await sleep(600);
const mobileOk = await evalJs(`(function(){
  const panel = document.getElementById('detailPanel');
  const visible = !panel.classList.contains('hidden');
  const style = getComputedStyle(panel);
  return { visible, bottom: style.bottom, left: style.left, right: style.right, maxH: style.maxHeight };
})()`);
check(mobileOk.visible && mobileOk.bottom === '0px' && mobileOk.left === '0px' && mobileOk.right === '0px',
  `移动端详情面板为底部全宽抽屉（bottom=${mobileOk.bottom}, left=${mobileOk.left}, maxHeight=${mobileOk.maxH}）`);

// ---------- 8. 数据管理：新增成员（详情面板 → 添加子女） ----------
await send('Emulation.clearDeviceMetricsOverride');
await sleep(300);
await evalJs(`(function(){
  const input = document.getElementById('searchInput');
  input.value = '忠';
  input.dispatchEvent(new Event('input', {bubbles:true}));
  return new Promise(res => setTimeout(() => {
    const first = document.querySelector('.sr-item');
    if (first) first.click();
    setTimeout(res, 250);
  }, 100));
})()`);
const addRes = await evalJs(`(async function(){
  document.querySelector('#detailContent [data-act="addchild"]').click();
  await new Promise(res => setTimeout(res, 120));
  const modal = document.querySelector('.modal');
  const nameInput = modal.querySelector('#f-name');
  nameInput.value = '测试新丁';
  modal.querySelector('#f-birth').value = '2000';
  modal.querySelector('[data-act="save"]').click();
  await new Promise(res => setTimeout(res, 350));
  return {
    cards: document.querySelectorAll('.node .card').length,
    modalGone: !document.querySelector('.modal'),
    toast: (document.querySelector('.toast') || {}).textContent || '',
    stat: document.getElementById('statLine').textContent
  };
})()`);
check(addRes.cards === 454, `添加子女后节点 453 → ${addRes.cards}`);
check(addRes.modalGone, '保存后弹窗自动关闭');
check(addRes.toast.includes('已添加'), `toast 提示：${addRes.toast}`);
check(addRes.stat.includes('454'), `统计行更新：${addRes.stat}`);

// ---------- 9. 数据管理：编辑成员 ----------
const editRes = await evalJs(`(async function(){
  const input = document.getElementById('searchInput');
  input.value = '测试新丁';
  input.dispatchEvent(new Event('input', {bubbles:true}));
  await new Promise(res => setTimeout(res, 150));
  document.querySelector('.sr-item').click();
  await new Promise(res => setTimeout(res, 250));
  const nameBefore = document.querySelector('#detailContent .dp-name').textContent;
  document.querySelector('#detailContent [data-act="edit"]').click();
  await new Promise(res => setTimeout(res, 120));
  const modal = document.querySelector('.modal');
  const nameInput = modal.querySelector('#f-name');
  nameInput.value = '测试新丁改';
  modal.querySelector('[data-act="save"]').click();
  await new Promise(res => setTimeout(res, 350));
  const nameAfter = document.querySelector('#detailContent .dp-name').textContent;
  return { nameBefore, nameAfter, cards: document.querySelectorAll('.node .card').length };
})()`);
check(editRes.nameBefore === '测试新丁' && editRes.nameAfter === '测试新丁改',
  `编辑改名生效：${editRes.nameBefore} → ${editRes.nameAfter}`);
check(editRes.cards === 454, '编辑后节点数不变（454）');

// ---------- 10. 数据管理：删除（二次确认） ----------
const delRes = await evalJs(`(async function(){
  document.querySelector('#detailContent [data-act="del"]').click();
  await new Promise(res => setTimeout(res, 150));
  const confirmModal = document.querySelector('.modal');
  const hasConfirm = !!confirmModal && !!confirmModal.querySelector('.title-danger');
  const confirmText = confirmModal ? confirmModal.querySelector('.confirm-text').textContent : '';
  // 第一次：取消
  confirmModal.querySelector('[data-act="cancel"]').click();
  await new Promise(res => setTimeout(res, 250));
  const afterCancel = document.querySelectorAll('.node .card').length;
  // 第二次：确认删除
  document.querySelector('#detailContent [data-act="del"]').click();
  await new Promise(res => setTimeout(res, 150));
  const m2 = document.querySelector('.modal');
  m2.querySelector('[data-act="confirm"]').click();
  await new Promise(res => setTimeout(res, 350));
  return {
    hasConfirm, confirmText,
    afterCancel,
    afterConfirm: document.querySelectorAll('.node .card').length,
    modalGone: !document.querySelector('.modal'),
    panelHidden: document.getElementById('detailPanel').classList.contains('hidden')
  };
})()`);
check(delRes.hasConfirm, '删除弹出二次确认框');
check(delRes.confirmText.includes('不可恢复'), '确认框含不可恢复警示');
check(delRes.afterCancel === 454, '取消后数据不变（454）');
check(delRes.afterConfirm === 453, `确认后删除成功（454 → ${delRes.afterConfirm}）`);
check(delRes.modalGone, '确认后弹窗关闭');
check(delRes.panelHidden, '删除后详情面板自动关闭');

// ---------- 11. 数据管理：导出 JSON ----------
const expRes = await evalJs(`(async function(){
  document.getElementById('btnExport').click();
  await new Promise(res => setTimeout(res, 150));
  const ta = document.querySelector('#export-json');
  const parsed = JSON.parse(ta.value);
  const hasDeleted = parsed.persons.some(p => p.name === '测试新丁改');
  document.querySelector('.modal [data-act="close"]').click();
  return { len: parsed.persons.length, format: parsed.format, hasDeleted };
})()`);
check(expRes.len === 453, `导出 JSON 含 453 人（实际 ${expRes.len}）`);
check(expRes.format === 'family-tree', '导出格式标记正确');
check(!expRes.hasDeleted, '已删除的人不在导出中');

// ---------- 12. 数据管理：导入 JSON（改名后覆盖） ----------
const impRes = await evalJs(`(async function(){
  // 取当前数据并改名
  document.getElementById('btnExport').click();
  await new Promise(res => setTimeout(res, 150));
  const parsed = JSON.parse(document.querySelector('#export-json').value);
  parsed.persons[0].name = '导入改名始祖';
  document.querySelector('.modal [data-act="close"]').click();
  await new Promise(res => setTimeout(res, 120));
  // 导入
  document.getElementById('btnImport').click();
  await new Promise(res => setTimeout(res, 150));
  const modal = document.querySelector('.modal');
  modal.querySelector('#import-json').value = JSON.stringify(parsed);
  modal.querySelector('[data-act="import"]').click();
  await new Promise(res => setTimeout(res, 400));
  const stat = document.getElementById('statLine').textContent;
  // 搜索验证
  const input = document.getElementById('searchInput');
  input.value = '导入改名始祖';
  input.dispatchEvent(new Event('input', {bubbles:true}));
  await new Promise(res => setTimeout(res, 180));
  const items = document.querySelectorAll('.sr-item').length;
  return { stat, items, cards: document.querySelectorAll('.node .card').length };
})()`);
check(impRes.cards === 453, `导入后节点 453（实际 ${impRes.cards}）`);
check(impRes.stat.includes('453'), `导入后统计更新：${impRes.stat}`);
check(impRes.items >= 1, `导入后能搜索到改名始祖（${impRes.items} 条）`);

// ---------- 13. 数据管理：坏 JSON 被拒绝 ----------
const badImp = await evalJs(`(async function(){
  document.getElementById('btnImport').click();
  await new Promise(res => setTimeout(res, 150));
  const modal = document.querySelector('.modal');
  modal.querySelector('#import-json').value = '{"broken"';
  modal.querySelector('[data-act="import"]').click();
  await new Promise(res => setTimeout(res, 220));
  const err = modal.querySelector('.form-err');
  const errText = err.classList.contains('hidden') ? '' : err.textContent;
  const cards = document.querySelectorAll('.node .card').length;
  modal.querySelector('[data-act="close"]').click();
  return { errText, cards };
})()`);
check(badImp.errText.includes('解析失败'), `坏 JSON 显示错误：${badImp.errText}`);
check(badImp.cards === 453, '坏数据导入后原数据不变');

// ---------- 14. 数据管理：重置为示例数据 ----------
const resetRes = await evalJs(`(async function(){
  document.getElementById('btnReset').click();
  await new Promise(res => setTimeout(res, 150));
  const modal = document.querySelector('.modal');
  modal.querySelector('[data-act="confirm"]').click();
  await new Promise(res => setTimeout(res, 400));
  const input = document.getElementById('searchInput');
  input.value = '导入改名始祖';
  input.dispatchEvent(new Event('input', {bubbles:true}));
  await new Promise(res => setTimeout(res, 180));
  const gone = document.querySelectorAll('.sr-item:not(.sr-empty)').length;
  input.value = '';
  return {
    cards: document.querySelectorAll('.node .card').length,
    stat: document.getElementById('statLine').textContent,
    gone
  };
})()`);
check(resetRes.cards === 453, `重置后节点 453（实际 ${resetRes.cards}）`);
check(resetRes.stat.includes('林氏 24 世'), `重置后统计恢复示例：${resetRes.stat}`);
check(resetRes.gone === 0, '重置后导入的改名已消失');

// ---------- 15. 全程无 JS 错误 ----------
check(errors.length === 0, `全程无未捕获异常（${errors.length} 个）`);
errors.forEach(e => console.error('  异常:', e));

console.log(failures === 0 ? '\n冒烟测试全部通过 ✓' : `\n${failures} 项失败`);
try { ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
await sleep(500);
try { rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) {}
process.exit(failures ? 1 : 0);
