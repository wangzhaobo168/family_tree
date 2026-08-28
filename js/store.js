/* ============================================================
 * 数据仓库：族谱数据的增删改查、导入导出、校验
 * 无 DOM 依赖，可在 Node 中直接测试（module.exports 导出）
 * 对外：FamilyStore.create()  → store 实例
 * ============================================================ */
(function (global) {
  'use strict';

  function createStore() {
    var state = {
      persons: [],   // 扁平人员数组（含 parent/children 引用）
      byId: {},      // id → person
      root: null,    // 始祖
      surname: '林',
      poem: ''
    };
    var listeners = [];

    function notify() {
      for (var i = 0; i < listeners.length; i++) listeners[i]();
    }
    function onDidChange(fn) { listeners.push(fn); }

    // ---------- 内部：重建引用 ----------
    function rebuild() {
      var byId = {};
      state.persons.forEach(function (p) { byId[p.id] = p; });
      state.byId = byId;
      state.root = null;
      state.persons.forEach(function (p) {
        p.parent = p.fatherId != null ? (byId[p.fatherId] || null) : null;
        p.children = [];
        p.isAlive = p.deathYear == null && p.birthYear != null;
      });
      state.persons.forEach(function (p) {
        if (p.parent) {
          p.parent.children.push(p);
        } else {
          state.root = p;
          p.isFounder = true; // 根即始祖
        }
      });
      state.persons.forEach(function (p) {
        p.children.sort(function (a, b) { return a.id - b.id; });
      });
    }

    // ---------- 内部：BFS 推 gen、检测环与孤立节点 ----------
    function recomputeAndCheck() {
      if (!state.root) {
        return { ok: false, error: '缺少始祖：存在循环引用，或没有任何无父亲的人' };
      }
      var seen = {}, queue = [state.root], maxGen = 0;
      if (state.root.gen == null) state.root.gen = 1;
      while (queue.length) {
        var cur = queue.shift();
        if (seen[cur.id]) return { ok: false, error: '存在循环的父子引用' };
        seen[cur.id] = true;
        if (cur.gen > maxGen) maxGen = cur.gen;
        cur.children.forEach(function (c) {
          c.gen = cur.gen + 1;
          queue.push(c);
        });
      }
      if (Object.keys(seen).length !== state.persons.length) {
        return { ok: false, error: '存在无法从始祖到达的孤立人员（父子引用无效）' };
      }
      return { ok: true, maxGen: maxGen };
    }

    // ---------- 校验 ----------
    function validateRecord(rec) {
      var errs = [];
      if (rec.name == null || !String(rec.name).trim()) errs.push('姓名不能为空');
      if (rec.gender !== 'M' && rec.gender !== 'F') errs.push('性别须为男或女');
      var by = Number(rec.birthYear);
      if (!isFinite(by) || by < 1000 || by > 2200) errs.push('出生年份须在 1000–2200 之间');
      if (rec.deathYear != null && rec.deathYear !== '') {
        var dy = Number(rec.deathYear);
        if (!isFinite(dy)) errs.push('卒年须为数字');
        else if (dy < by) errs.push('卒年不能早于生年');
      }
      return errs;
    }

    function normalizeRecord(raw, id) {
      var death = raw.deathYear;
      if (death == null || death === '') death = null;
      else death = Number(death);
      return {
        id: id,
        name: String(raw.name == null ? '' : raw.name).trim(),
        gender: raw.gender === 'F' ? 'F' : 'M',
        gen: 1,
        birthYear: Number(raw.birthYear),
        deathYear: death,
        fatherId: raw.fatherId != null ? Number(raw.fatherId) : null,
        spouse: raw.spouse || null,
        marriedTo: raw.marriedTo || null,
        note: raw.note || '',
        isFounder: !!raw.isFounder,
        collapsed: false,
        visible: true,
        x: 0, y: 0
      };
    }

    // ---------- 批量加载（导入 / 初始化 / 重置共用） ----------
    function loadFromArray(arr, meta) {
      meta = meta || {};
      if (!arr || !arr.length) return { ok: false, error: '没有人员数据' };

      // 分配唯一 id（冲突/缺失/非法的 id 重新分配，并记录映射以修复 fatherId）
      var idMap = {};
      var maxId = 0;
      var entries = arr.map(function (raw, i) {
        var id = raw.id != null ? Number(raw.id) : NaN;
        if (!isFinite(id) || id <= 0) id = NaN;
        if (isFinite(id) && id > maxId) maxId = id;
        return { raw: raw, id: id };
      });
      var used = {};
      entries.forEach(function (it) { if (isFinite(it.id)) used[it.id] = (used[it.id] || 0) + 1; });
      entries.forEach(function (it) {
        if (!isFinite(it.id) || used[it.id] > 1) {
          var old = it.id;
          it.id = ++maxId;
          used[it.id] = 1;
          if (isFinite(old)) idMap[old] = it.id;
        }
      });

      var list = entries.map(function (it) {
        var p = normalizeRecord(it.raw, it.id);
        if (p.fatherId != null && idMap[p.fatherId] != null) p.fatherId = idMap[p.fatherId];
        return p;
      });

      // 在临时状态上校验，失败则不动正式数据
      var backup = state.persons;
      state.persons = list;
      rebuild();
      var check = recomputeAndCheck();
      var errs = [];
      if (check.ok) {
        list.forEach(function (p) {
          var e = validateRecord(p);
          if (e.length) errs.push(p.name + '：' + e.join('；'));
        });
      }
      if (!check.ok || errs.length) {
        state.persons = backup;
        rebuild();
        return { ok: false, error: !check.ok ? check.error : ('数据字段有误：' + errs.slice(0, 3).join(' | ')) };
      }

      state.surname = meta.surname || state.surname;
      state.poem = meta.poem || state.poem;
      return { ok: true, stats: computeStats(), maxGen: check.maxGen };
    }

    // ---------- 统计 ----------
    function computeStats() {
      var maxGen = 0, male = 0, female = 0, alive = 0;
      state.persons.forEach(function (p) {
        if (p.gen > maxGen) maxGen = p.gen;
        if (p.gender === 'M') male++; else female++;
        if (p.deathYear == null) alive++;
      });
      return { total: state.persons.length, maxGen: maxGen, male: male, female: female, alive: alive };
    }

    function nextId() {
      var max = 0;
      state.persons.forEach(function (p) { if (p.id > max) max = p.id; });
      return max + 1;
    }

    // ---------- 增 ----------
    function addChild(parentId, data) {
      var parent = state.byId[parentId];
      if (!parent) return { ok: false, error: '父亲不存在' };
      var errs = validateRecord(data);
      if (errs.length) return { ok: false, error: errs.join('；') };
      var p = normalizeRecord(data, nextId());
      p.fatherId = parent.id;
      p.parent = parent;
      p.gen = parent.gen + 1;
      p.children = [];
      state.persons.push(p);
      state.byId[p.id] = p;
      parent.children.push(p);
      parent.children.sort(function (a, b) { return a.id - b.id; });
      notify();
      return { ok: true, person: p, stats: computeStats() };
    }

    // ---------- 改 ----------
    function updatePerson(id, data) {
      var p = state.byId[id];
      if (!p) return { ok: false, error: '人员不存在' };
      var errs = validateRecord(data);
      if (errs.length) return { ok: false, error: errs.join('；') };
      p.name = String(data.name == null ? p.name : data.name).trim();
      p.gender = data.gender === 'F' ? 'F' : 'M';
      p.birthYear = Number(data.birthYear);
      p.deathYear = (data.deathYear == null || data.deathYear === '') ? null : Number(data.deathYear);
      p.spouse = data.spouse || null;
      p.marriedTo = data.marriedTo || null;
      p.note = data.note || '';
      p.isAlive = p.deathYear == null;
      notify();
      return { ok: true, person: p, stats: computeStats() };
    }

    // ---------- 删（连同后代） ----------
    function countSubtree(p) {
      var n = 1;
      p.children.forEach(function (c) { n += countSubtree(c); });
      return n;
    }

    function removePerson(id) {
      var p = state.byId[id];
      if (!p) return { ok: false, error: '人员不存在' };
      if (p === state.root) return { ok: false, error: '不能删除始祖' };
      var doomed = {};
      (function collect(x) {
        doomed[x.id] = true;
        x.children.forEach(collect);
      })(p);
      var n = Object.keys(doomed).length;
      if (p.parent) {
        p.parent.children = p.parent.children.filter(function (c) { return c.id !== id; });
      }
      state.persons = state.persons.filter(function (x) { return !doomed[x.id]; });
      Object.keys(doomed).forEach(function (k) { delete state.byId[k]; });
      notify();
      return { ok: true, removed: n, stats: computeStats() };
    }

    // ---------- 导出 ----------
    function exportJSON() {
      var out = {
        format: 'family-tree',
        version: 1,
        exportedAt: new Date().toISOString(),
        surname: state.surname,
        poem: state.poem,
        persons: state.persons.map(function (p) {
          return {
            id: p.id, name: p.name, gender: p.gender, gen: p.gen,
            birthYear: p.birthYear, deathYear: p.deathYear,
            fatherId: p.fatherId, spouse: p.spouse, marriedTo: p.marriedTo,
            note: p.note, isFounder: p.isFounder
          };
        })
      };
      return JSON.stringify(out, null, 2);
    }

    // ---------- 导入 ----------
    function flatten(parsed) {
      if (Array.isArray(parsed)) return parsed;
      if (parsed && typeof parsed === 'object') {
        if (Array.isArray(parsed.persons)) return parsed.persons;
        if (parsed.root && typeof parsed.root === 'object') {
          var arr = [];
          var tmpId = 0;
          (function walk(node) {
            if (!node) return;
            if (node.id == null) node.id = ++tmpId;
            arr.push(node);
            var kids = node.children || node.childs;
            if (kids && kids.forEach) {
              kids.forEach(function (c) {
                if (c.fatherId == null) c.fatherId = node.id;
                walk(c);
              });
            }
          })(parsed.root);
          return arr;
        }
      }
      return null;
    }

    function importJSON(text) {
      var parsed;
      try { parsed = JSON.parse(text); } catch (e) {
        return { ok: false, error: 'JSON 解析失败：' + e.message };
      }
      var arr = flatten(parsed);
      if (!arr || !arr.length) {
        return { ok: false, error: '无法识别的格式：应为人员数组、{persons:[…]} 或 {root:{…}}' };
      }
      var meta = {};
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        meta.surname = parsed.surname;
        meta.poem = parsed.poem;
      }
      var res = loadFromArray(arr, meta);
      if (res.ok) notify();
      return res;
    }

    // ---------- 对外接口 ----------
    return {
      getPersons: function () { return state.persons; },
      getById: function (id) { return state.byId[id]; },
      getMap: function () { return state.byId; },
      getRoot: function () { return state.root; },
      getStats: function () { return computeStats(); },
      getSurname: function () { return state.surname; },
      getPoem: function () { return state.poem; },
      onDidChange: onDidChange,
      loadFromArray: loadFromArray,
      importJSON: importJSON,
      exportJSON: exportJSON,
      addChild: addChild,
      updatePerson: updatePerson,
      removePerson: removePerson,
      countSubtree: countSubtree,
      validate: validateRecord
    };
  }

  global.FamilyStore = { create: createStore };
  if (typeof module !== 'undefined' && module.exports) module.exports = { create: createStore };
})(typeof globalThis !== 'undefined' ? globalThis : this);
