/* ============================================================
 * 族谱网站前端逻辑：SVG 渲染、缩放平移、搜索、详情、折叠分支
 * 依赖：js/data.js（FamilyData）、js/tidy-tree.js（TidyTree）、
 *       js/store.js（FamilyStore）、js/editor.js（FamilyEditor）
 * ============================================================ */
(function () {
  'use strict';

  // ---------- 数据仓库 ----------
  var store = FamilyStore.create();
  var editor = FamilyEditor.create(store, { onChanged: handleDataChanged });
  var gen = FamilyData.generate(20250520);
  store.loadFromArray(gen.persons, { surname: gen.surname, poem: gen.poem });

  var root = store.getRoot();
  var persons = store.getPersons();
  var byId = store.getMap();
  var POEM = store.getPoem();
  var SURNAME = store.getSurname();
  var stats = store.getStats();

  // store 数据变更后刷新本地引用
  function refreshRefs() {
    root = store.getRoot();
    persons = store.getPersons();
    byId = store.getMap();
    POEM = store.getPoem();
    SURNAME = store.getSurname();
    stats = store.getStats();
  }

  function handleDataChanged() {
    refreshRefs();
    if (selected && !byId[selected.id]) {
      selected = null;
      dimSet = null;
      detailPanel.classList.add('hidden');
    }
    rerender();
    if (selected && byId[selected.id]) showDetail(selected);
  }

  // ---------- 布局常量 ----------
  var NODE_W = 132, NODE_H = 62, H_GAP = 26, V_GAP = 88, PAD = 66;
  var MIN_SCALE = 0.005, MAX_SCALE = 12;

  // ---------- DOM ----------
  var svg = document.getElementById('treeSvg');
  var NS = 'http://www.w3.org/2000/svg';
  var area = document.getElementById('treeArea');
  var zoomLabel = document.getElementById('zoomLabel');
  var statLine = document.getElementById('statLine');
  var searchInput = document.getElementById('searchInput');
  var searchResults = document.getElementById('searchResults');
  var detailPanel = document.getElementById('detailPanel');
  var detailContent = document.getElementById('detailContent');
  var poemPop = document.getElementById('poemPop');

  // ---------- 状态 ----------
  var camera = { x: 0, y: 0, s: 1 };
  var viewW = 0, viewH = 0;
  var bounds = null;
  var nodeEls = {};
  var selected = null;
  var dimSet = null;
  var animToken = 0;
  var pointers = new Map();
  var downPos = null, moved = false, pinch0 = null;
  var lastTap = 0, lastTapX = 0, lastTapY = 0;

  // ---------- 工具 ----------
  function el(tag, attrs, text) {
    var n = document.createElementNS(NS, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (text != null) n.textContent = text;
    return n;
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---------- 相机（视图变换） ----------
  function sizeSvg() {
    viewW = area.clientWidth;
    viewH = area.clientHeight;
    svg.setAttribute('width', viewW);
    svg.setAttribute('height', viewH);
  }

  function applyCamera() {
    svg.setAttribute('viewBox',
      camera.x + ' ' + camera.y + ' ' + (viewW / camera.s) + ' ' + (viewH / camera.s));
    zoomLabel.textContent = Math.round(camera.s * 100) + '%';
  }

  function worldFromScreen(px, py) {
    return { x: camera.x + px / camera.s, y: camera.y + py / camera.s };
  }

  function zoomAt(px, py, factor) {
    var ns = Math.min(MAX_SCALE, Math.max(MIN_SCALE, camera.s * factor));
    var f = ns / camera.s;
    var w = worldFromScreen(px, py);
    camera.s = ns;
    camera.x = w.x - px / ns;
    camera.y = w.y - py / ns;
    applyCamera();
  }

  function panBy(dx, dy) {
    camera.x -= dx / camera.s;
    camera.y -= dy / camera.s;
    applyCamera();
  }

  function animateCamera(target, dur) {
    var token = ++animToken;
    var from = { x: camera.x, y: camera.y, s: camera.s };
    var t0 = performance.now();
    function step(t) {
      if (token !== animToken) return;
      var k = Math.min(1, (t - t0) / (dur || 320));
      var e = 1 - Math.pow(1 - k, 3); // easeOutCubic
      camera.x = from.x + (target.x - from.x) * e;
      camera.y = from.y + (target.y - from.y) * e;
      camera.s = from.s + (target.s - from.s) * e;
      applyCamera();
      if (k < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function fitAll(animate) {
    if (!bounds) return;
    var bw = bounds.maxX - bounds.minX, bh = bounds.maxY - bounds.minY;
    if (bw <= 0 || bh <= 0) return;
    var s = Math.min(viewW / bw, viewH / bh) * 0.96;
    s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
    var target = {
      s: s,
      x: bounds.minX - (viewW / s - bw) / 2,
      y: bounds.minY - (viewH / s - bh) / 2
    };
    if (animate) animateCamera(target, 380);
    else { camera.x = target.x; camera.y = target.y; camera.s = target.s; applyCamera(); }
  }

  // ---------- 布局 ----------
  function buildLayoutTree(p, parent) {
    var ln = { p: p, parent: parent || null, children: [] };
    if (!p.collapsed) {
      for (var i = 0; i < p.children.length; i++) {
        ln.children.push(buildLayoutTree(p.children[i], ln));
      }
    }
    return ln;
  }

  function runLayout() {
    persons.forEach(function (p) { p.visible = false; });
    var lt = buildLayoutTree(root);
    TidyTree(lt, { nodeWidth: NODE_W, hGap: H_GAP });
    var minX = Infinity, maxX = -Infinity, maxY = 0;
    (function walk(ln) {
      var p = ln.p;
      p.visible = true;
      p.x = ln.x;
      p.y = (p.gen - 1) * V_GAP;
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y + NODE_H > maxY) maxY = p.y + NODE_H;
      for (var i = 0; i < ln.children.length; i++) walk(ln.children[i]);
    })(lt);
    var shift = PAD - minX;
    persons.forEach(function (p) { if (p.visible) p.x += shift; });
    bounds = { minX: 0, maxX: maxX + shift + PAD, minY: 0, maxY: maxY + PAD };
  }

  // ---------- 渲染 ----------
  function buildSvg() {
    svg.innerHTML = '';
    nodeEls = {};
    var gEdges = el('g', { 'class': 'edges' });
    var gNodes = el('g', { 'class': 'nodes' });
    var gLabels = el('g', { 'class': 'genlabels' });
    svg.appendChild(gEdges);
    svg.appendChild(gNodes);
    svg.appendChild(gLabels);

    // 世代标签（左侧）
    var gens = {};
    persons.forEach(function (p) { if (p.visible) gens[p.gen] = true; });
    Object.keys(gens).forEach(function (gen) {
      var y = (gen - 1) * V_GAP + NODE_H / 2;
      gLabels.appendChild(el('text', {
        x: PAD - 18, y: y + 4, 'text-anchor': 'end', 'class': 'genlabel'
      }, '第' + gen + '世'));
    });

    // 连线（父节点底部 → 子节点顶部，肘形）
    persons.forEach(function (p) {
      if (!p.visible || !p.parent || !p.parent.visible) return;
      var x1 = p.parent.x, y1 = p.parent.y + NODE_H / 2;
      var x2 = p.x, y2 = p.y - NODE_H / 2;
      var my = (y1 + y2) / 2;
      var d = 'M' + x1 + ',' + y1 + ' V' + my + ' H' + x2 + ' V' + y2;
      gEdges.appendChild(el('path', { d: d, 'class': 'edge' }));
    });

    // 节点
    persons.forEach(function (p) {
      if (!p.visible) return;
      var g = buildNode(p);
      nodeEls[p.id] = g;
      gNodes.appendChild(g);
    });
  }

  function buildNode(p) {
    var cls = 'node' + (p.isFounder ? ' founder' : '') + (p.gender === 'F' ? ' female' : '') + (p.isAlive ? ' alive' : '');
    if (selected === p) cls += ' selected';
    if (dimSet && !dimSet.has(p.id)) cls += ' dim';
    var g = el('g', { 'class': cls, 'data-id': p.id });
    var cx = p.x, cy = p.y, w = NODE_W, h = NODE_H;

    g.appendChild(el('rect', { x: cx - w / 2, y: cy - h / 2, width: w, height: h, rx: 8, 'class': 'card' }));
    g.appendChild(el('text', { x: cx, y: cy - 5, 'text-anchor': 'middle', 'class': 'nm' }, p.name));
    var line2 = p.gender === 'F' ? (p.marriedTo || '') : (p.spouse || '');
    if (line2) g.appendChild(el('text', { x: cx, y: cy + 12, 'text-anchor': 'middle', 'class': 'sp' }, line2));
    var yr = p.birthYear + (p.deathYear ? '—' + p.deathYear : '—今');
    g.appendChild(el('text', { x: cx, y: cy + 26, 'text-anchor': 'middle', 'class': 'yr' }, yr));

    // 折叠按钮（始祖不提供）
    if (p.children.length && !p.isFounder) {
      var btn = el('g', {
        'class': 'cbtn' + (p.collapsed ? ' collapsed' : ''),
        'transform': 'translate(' + (cx + w / 2 - 12) + ',' + (cy - h / 2 + 12) + ')'
      });
      btn.appendChild(el('circle', { r: 15, 'class': 'cbtn-hit' })); // 扩大命中区
      btn.appendChild(el('circle', { r: 10 }));
      btn.appendChild(el('text', { y: 4.5, 'text-anchor': 'middle' }, p.collapsed ? '+' : '−'));
      g.appendChild(btn);
    }

    // 在世标记（左上角绿点）
    if (p.isAlive) g.appendChild(el('circle', { cx: cx - w / 2 + 9, cy: cy - h / 2 + 9, r: 3, 'class': 'alive-dot' }));
    return g;
  }

  // ---------- 选中 / 高亮 ----------
  function relatedIds(p) {
    var ids = new Set([p.id]);
    var cur = p;
    while (cur.parent) { ids.add(cur.parent.id); cur = cur.parent; }
    var stack = [p];
    while (stack.length) {
      var n = stack.pop();
      for (var i = 0; i < n.children.length; i++) {
        ids.add(n.children[i].id);
        stack.push(n.children[i]);
      }
    }
    return ids;
  }

  function applySelectionClasses() {
    for (var id in nodeEls) {
      var g = nodeEls[id];
      var p = byId[id];
      g.classList.remove('selected', 'dim');
      if (p === selected) g.classList.add('selected');
      else if (dimSet && !dimSet.has(p.id)) g.classList.add('dim');
    }
  }

  function selectPerson(p, openPanel) {
    selected = p;
    dimSet = p ? relatedIds(p) : null;
    applySelectionClasses();
    if (openPanel !== false) {
      if (p) showDetail(p);
      else detailPanel.classList.add('hidden');
    }
  }

  // ---------- 详情面板 ----------
  function showDetail(p) {
    var html = '';
    html += '<div class="dp-head">';
    html += '<span class="dp-name">' + esc(p.name) + '</span>';
    if (p.isFounder) html += '<span class="dp-badge founder-badge">始祖</span>';
    html += '<span class="dp-badge">第' + p.gen + '世</span>';
    html += '<span class="dp-badge">' + (p.gender === 'M' ? '男' : '女') + '</span>';
    html += '</div>';

    html += '<div class="dp-row"><b>生卒：</b>' + p.birthYear + ' — ' + (p.deathYear || '今');
    if (p.deathYear) html += '（享年 ' + (p.deathYear - p.birthYear) + ' 岁）';
    else html += '（在世）';
    html += '</div>';

    if (p.gen > 1) html += '<div class="dp-row"><b>字辈：</b>' + POEM.charAt(p.gen - 1) + '</div>';
    if (p.parent) {
      html += '<div class="dp-row"><b>父亲：</b><a href="#" data-goto="' + p.parent.id + '">' + esc(p.parent.name) + '</a></div>';
    }
    if (p.gender === 'F') {
      if (p.marriedTo) html += '<div class="dp-row"><b>婚配：</b>' + esc(p.marriedTo) + '</div>';
    } else if (p.spouse) {
      html += '<div class="dp-row"><b>配偶：</b>' + esc(p.spouse) + '</div>';
    }

    if (p.children.length) {
      html += '<div class="dp-row"><b>子女（' + p.children.length + '）：</b>';
      p.children.forEach(function (c) {
        html += '<a href="#" data-goto="' + c.id + '" class="chip">' + esc(c.name) + (c.gender === 'F' ? '·女' : '') + '</a>';
      });
      html += '</div>';
    } else {
      html += '<div class="dp-row"><b>子女：</b>暂无记录</div>';
    }

    if (p.note) html += '<div class="dp-note">' + esc(p.note) + '</div>';

    html += '<div class="dp-actions">';
    html += '<button data-act="focus">定位居中</button>';
    html += '<button data-act="addchild">添加子女</button>';
    html += '<button data-act="isolate">只看此支</button>';
    html += '<button data-act="edit">编辑</button>';
    html += '<button data-act="toggle">' + (p.collapsed ? '展开此支' : '收起此支') + '</button>';
    html += '<button data-act="del" class="act-danger">删除</button>';
    html += '</div>';

    detailContent.innerHTML = html;
    detailPanel.classList.remove('hidden');

    detailContent.querySelectorAll('[data-goto]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        focusPerson(byId[Number(a.getAttribute('data-goto'))]);
      });
    });
    detailContent.querySelectorAll('[data-act]').forEach(function (b) {
      b.addEventListener('click', function () {
        var act = b.getAttribute('data-act');
        if (act === 'focus') focusPerson(p);
        else if (act === 'isolate') isolateBranch(p);
        else if (act === 'addchild') editor.openAddChild(p);
        else if (act === 'edit') editor.openEdit(p);
        else if (act === 'del') editor.openDelete(p);
        else if (act === 'toggle') {
          p.collapsed = !p.collapsed;
          rerender();
          showDetail(p);
        }
      });
    });
  }

  function focusPerson(p) {
    var s = Math.min(MAX_SCALE, Math.max(camera.s, 0.9));
    animateCamera({ s: s, x: p.x - viewW / 2 / s, y: p.y - viewH / 2 / s }, 340);
    selectPerson(p, true);
  }

  // ---------- 折叠 / 只看此支 ----------
  function rerender() {
    refreshRefs();
    runLayout();
    statLine.textContent = SURNAME + '氏 ' + stats.maxGen + ' 世 · 共 ' + stats.total + ' 人 · 男 ' + stats.male + ' 女 ' + stats.female + ' · 在世 ' + stats.alive;
    buildSvg();
  }

  function isolateBranch(p) {
    var keep = new Set([p.id]);
    var cur = p;
    while (cur.parent) { keep.add(cur.parent.id); cur = cur.parent; }
    var stack = [p];
    while (stack.length) {
      var n = stack.pop();
      keep.add(n.id);
      for (var i = 0; i < n.children.length; i++) stack.push(n.children[i]);
    }
    persons.forEach(function (x) { if (!keep.has(x.id)) x.collapsed = true; });
    rerender();
    fitAll(true);
    selectPerson(p, true);
  }

  function expandAll() {
    persons.forEach(function (p) { p.collapsed = false; });
    rerender();
    fitAll(true);
  }

  function collapseAll() {
    persons.forEach(function (p) { if (p !== root) p.collapsed = true; });
    rerender();
    fitAll(true);
  }

  // ---------- 指针交互（拖拽 / 双指缩放 / 点按 / 双击） ----------
  function pinchState() {
    var arr = Array.from(pointers.values());
    var a = arr[0], b = arr[1];
    var rect = svg.getBoundingClientRect();
    return {
      d: Math.hypot(b.x - a.x, b.y - a.y),
      mx: (a.x + b.x) / 2 - rect.left,
      my: (a.y + b.y) / 2 - rect.top
    };
  }

  svg.addEventListener('pointerdown', function (e) {
    try { svg.setPointerCapture(e.pointerId); } catch (err) { /* 合成事件等场景下无活动指针，忽略 */ }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    animToken++; // 取消进行中的动画
    if (pointers.size === 1) {
      downPos = { x: e.clientX, y: e.clientY };
      moved = false;
      pinch0 = null;
    } else if (pointers.size === 2) {
      pinch0 = pinchState();
      downPos = null;
    }
  });

  svg.addEventListener('pointermove', function (e) {
    if (!pointers.has(e.pointerId)) return;
    var pt = pointers.get(e.pointerId);
    var dx = e.clientX - pt.x, dy = e.clientY - pt.y;
    pt.x = e.clientX; pt.y = e.clientY;
    if (pointers.size === 1 && downPos) {
      if (Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) > 4) moved = true;
      panBy(dx, dy);
    } else if (pointers.size === 2 && pinch0) {
      var cur = pinchState();
      zoomAt(cur.mx, cur.my, cur.d / pinch0.d);
      camera.x -= (cur.mx - pinch0.mx) / camera.s;
      camera.y -= (cur.my - pinch0.my) / camera.s;
      applyCamera();
      pinch0 = cur;
    }
  });

  function pointerEnd(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch0 = null;
    if (downPos && !moved && pointers.size === 0) handleTap(e);
    if (pointers.size === 0) downPos = null;
  }
  svg.addEventListener('pointerup', pointerEnd);
  svg.addEventListener('pointercancel', pointerEnd);

  function handleTap(e) {
    var rect = svg.getBoundingClientRect();
    var px = e.clientX - rect.left, py = e.clientY - rect.top;
    var now = performance.now();
    // 双击放大
    if (now - lastTap < 320 && Math.hypot(px - lastTapX, py - lastTapY) < 40) {
      lastTap = 0;
      zoomAt(px, py, 1.8);
      return;
    }
    lastTap = now; lastTapX = px; lastTapY = py;

    var el0 = document.elementFromPoint(e.clientX, e.clientY);
    if (el0 && el0.closest) {
      // 折叠按钮
      var cbtn = el0.closest('.cbtn');
      if (cbtn) {
        var g0 = cbtn.closest('.node');
        var p0 = byId[Number(g0.getAttribute('data-id'))];
        p0.collapsed = !p0.collapsed;
        rerender();
        if (selected === p0) showDetail(p0);
        return;
      }
      // 节点 → 选中
      var node = el0.closest('.node');
      if (node) {
        var p = byId[Number(node.getAttribute('data-id'))];
        selectPerson(p, true);
        return;
      }
    }
    // 空白处 → 取消选中
    selectPerson(null);
  }

  svg.addEventListener('wheel', function (e) {
    e.preventDefault();
    var rect = svg.getBoundingClientRect();
    var factor = Math.exp(-e.deltaY * 0.0016);
    zoomAt(e.clientX - rect.left, e.clientY - rect.top, factor);
  }, { passive: false });

  svg.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  // ---------- 顶部按钮 ----------
  document.getElementById('zoomIn').addEventListener('click', function () {
    zoomAt(viewW / 2, viewH / 2, 1.5);
  });
  document.getElementById('zoomOut').addEventListener('click', function () {
    zoomAt(viewW / 2, viewH / 2, 1 / 1.5);
  });
  document.getElementById('btnFit').addEventListener('click', function () { fitAll(true); });
  document.getElementById('btnFull').addEventListener('click', function () {
    zoomAt(viewW / 2, viewH / 2, 1 / camera.s); // 回到 100%
  });
  document.getElementById('btnCollapseAll').addEventListener('click', collapseAll);
  document.getElementById('btnExpandAll').addEventListener('click', expandAll);

  // 数据管理
  document.getElementById('btnAdd').addEventListener('click', function () { editor.openAdd(); });
  document.getElementById('btnImport').addEventListener('click', function () { editor.openImport(); });
  document.getElementById('btnExport').addEventListener('click', function () { editor.openExport(); });
  document.getElementById('btnReset').addEventListener('click', function () {
    editor.openReset(function () { return FamilyData.generate(20250520); });
  });

  document.getElementById('detailClose').addEventListener('click', function () {
    detailPanel.classList.add('hidden');
    selectPerson(null);
  });

  // 字辈诗弹层
  document.getElementById('btnPoem').addEventListener('click', function () {
    if (!poemPop.classList.contains('hidden')) { poemPop.classList.add('hidden'); return; }
    var chars = POEM.split('');
    var html = '<div class="poem-title">字辈诗（' + POEM.length + ' 世）</div><div class="poem-body">';
    for (var i = 0; i < chars.length; i += 4) {
      html += '<div class="poem-line">' + chars.slice(i, i + 4).join(' ') + '</div>';
    }
    html += '</div>';
    poemPop.innerHTML = html;
    poemPop.classList.remove('hidden');
  });
  document.addEventListener('click', function (e) {
    if (!poemPop.classList.contains('hidden') &&
        !poemPop.contains(e.target) && e.target.id !== 'btnPoem') {
      poemPop.classList.add('hidden');
    }
    if (!searchResults.classList.contains('hidden') &&
        !searchResults.contains(e.target) && e.target !== searchInput) {
      searchResults.classList.add('hidden');
    }
  });

  // ---------- 搜索 ----------
  searchInput.addEventListener('input', function () {
    var q = searchInput.value.trim();
    if (!q) { searchResults.classList.add('hidden'); return; }
    var matches = [];
    for (var i = 0; i < persons.length && matches.length < 12; i++) {
      if (persons[i].name.indexOf(q) !== -1) matches.push(persons[i]);
    }
    searchResults.innerHTML = '';
    if (!matches.length) {
      searchResults.innerHTML = '<div class="sr-item sr-empty">未找到「' + esc(q) + '」</div>';
    } else {
      matches.forEach(function (p) {
        var item = document.createElement('div');
        item.className = 'sr-item';
        var sub = '第' + p.gen + '世 · ' + p.birthYear + (p.deathYear ? '—' + p.deathYear : '—今');
        item.innerHTML = esc(p.name) + '<span class="sr-sub">' + sub + '</span>';
        item.addEventListener('click', function () {
          searchInput.value = '';
          searchResults.classList.add('hidden');
          focusPerson(p);
        });
        searchResults.appendChild(item);
      });
    }
    searchResults.classList.remove('hidden');
  });

  searchInput.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      searchInput.blur();
      searchResults.classList.add('hidden');
    }
  });

  // ---------- 键盘快捷键 ----------
  document.addEventListener('keydown', function (e) {
    var tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;
    if (e.key === '+' || e.key === '=') zoomAt(viewW / 2, viewH / 2, 1.4);
    else if (e.key === '-' || e.key === '_') zoomAt(viewW / 2, viewH / 2, 1 / 1.4);
    else if (e.key === '0') fitAll(true);
    else if (e.key === 'Escape') {
      detailPanel.classList.add('hidden');
      selectPerson(null);
    }
  });

  // ---------- 初始化 ----------
  window.addEventListener('resize', function () { sizeSvg(); applyCamera(); });
  sizeSvg();
  rerender();
  fitAll(false);
})();
