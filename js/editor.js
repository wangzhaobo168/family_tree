/* ============================================================
 * 编辑器 UI：新增/编辑/删除（二次确认）、导入/导出弹窗、toast 提示
 * 依赖：FamilyStore（store 实例）
 * ============================================================ */
(function (global) {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function createEditor(store, hooks) {
    hooks = hooks || {};
    var modalRoot = document.getElementById('modalRoot');

    // ---------- 通用弹窗 ----------
    function openModal(html) {
      var mask = document.createElement('div');
      mask.className = 'modal-mask';
      mask.innerHTML = '<div class="modal" role="dialog" aria-modal="true">' + html + '</div>';
      modalRoot.appendChild(mask);
      mask.addEventListener('click', function (e) {
        if (e.target === mask) closeModal(mask);
      });
      return mask;
    }

    function closeModal(mask) {
      if (mask && mask.parentNode) mask.parentNode.removeChild(mask);
    }

    function showErr(mask, msg) {
      var box = mask.querySelector('.form-err');
      if (box) {
        box.textContent = msg;
        box.classList.remove('hidden');
      } else {
        toast(msg, 'error');
      }
    }

    function hideErr(mask) {
      var box = mask.querySelector('.form-err');
      if (box) box.classList.add('hidden');
    }

    // ---------- toast ----------
    function toast(msg, type) {
      var t = document.createElement('div');
      t.className = 'toast' + (type === 'error' ? ' toast-error' : '');
      t.textContent = msg;
      document.body.appendChild(t);
      setTimeout(function () {
        t.classList.add('toast-out');
        setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 320);
      }, 2400);
    }

    // ---------- 表单（新增 / 添加子女 / 编辑共用） ----------
    function formHtml(person, mode) {
      var isEdit = mode === 'edit';
      var isAdd = mode === 'add';
      var fatherLocked = mode === 'add'; // 添加子女：父亲锁定
      var title = isEdit ? '编辑成员' : (mode === 'add' ? '添加子女' : '新增成员');
      var v = person || {};
      // 仅编辑模式预填当前值；新增/添加子女一律留空（避免继承父亲的字段）
      var useVals = isEdit;
      var nameVal = useVals ? (v.name || '') : '';
      var birthVal = useVals ? (v.birthYear != null ? v.birthYear : '') : '';
      var deathVal = useVals ? (v.deathYear == null ? '' : v.deathYear) : '';
      var spouseVal = useVals ? (v.spouse || v.marriedTo || '') : '';
      var noteVal = useVals ? (v.note || '') : '';
      var fatherRow = '';
      if (isEdit) {
        var fp = v.parent;
        fatherRow = '<label class="f-row">父亲<input type="text" value="' + esc(fp ? fp.name : '（始祖）') + '" disabled></label>';
      } else if (isAdd) {
        fatherRow = '<label class="f-row">父亲<input type="text" value="' + esc(person.name) + '" readonly data-father-locked="' + person.id + '"></label>';
      } else {
        fatherRow = '<label class="f-row">父亲（必填）<input type="text" id="f-father" placeholder="输入姓名搜索并选择…" autocomplete="off"><div class="father-cands hidden"></div></label>';
      }
      return (
        '<h3 class="modal-title">' + title + '</h3>' +
        '<div class="form">' +
          '<label class="f-row">姓名 *<input type="text" id="f-name" value="' + esc(nameVal) + '" maxlength="20" placeholder="如 林承祖"></label>' +
          '<label class="f-row">性别<select id="f-gender">' +
            '<option value="M"' + (useVals && v.gender !== 'F' ? ' selected' : '') + '>男</option>' +
            '<option value="F"' + (useVals && v.gender === 'F' ? ' selected' : '') + '>女</option>' +
          '</select></label>' +
          '<div class="f-row2">' +
            '<label class="f-row">生年 *<input type="number" id="f-birth" value="' + esc(birthVal) + '" min="1000" max="2200" placeholder="如 1935"></label>' +
            '<label class="f-row">卒年<small>（留空=在世）</small><input type="number" id="f-death" value="' + esc(deathVal) + '" min="1000" max="2200" placeholder="如 2008"></label>' +
          '</div>' +
          fatherRow +
          '<label class="f-row"><span id="f-spouse-label">' + (person && person.gender === 'F' ? '适' : '配偶') + '</span><input type="text" id="f-spouse" value="' + esc(spouseVal) + '" maxlength="30" placeholder="如 配 李氏 / 适 陈志远"></label>' +
          '<label class="f-row">备注<textarea id="f-note" rows="2" maxlength="200">' + esc(noteVal) + '</textarea></label>' +
        '</div>' +
        '<div class="form-err hidden"></div>' +
        '<div class="modal-actions">' +
          '<button type="button" class="btn-ghost" data-act="cancel">取消</button>' +
          '<button type="button" class="btn-primary" data-act="save">保存</button>' +
        '</div>'
      );
    }

    function bindFormActions(mask, person, mode) {
      // 性别切换 → 配偶/适 文案联动
      var genderSel = mask.querySelector('#f-gender');
      genderSel.addEventListener('change', function () {
        var label = mask.querySelector('#f-spouse-label');
        if (label) label.textContent = genderSel.value === 'F' ? '适' : '配偶';
      });

      mask.querySelectorAll('[data-act]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var act = btn.getAttribute('data-act');
          if (act === 'cancel') { closeModal(mask); return; }
          if (act === 'save') {
            hideErr(mask);
            var data = {
              name: mask.querySelector('#f-name').value,
              gender: mask.querySelector('#f-gender').value,
              birthYear: mask.querySelector('#f-birth').value,
              deathYear: mask.querySelector('#f-death').value,
              spouse: mask.querySelector('#f-spouse').value.trim(),
              note: mask.querySelector('#f-note').value.trim()
            };
            var res;
            if (mode === 'edit') {
              res = store.updatePerson(person.id, data);
            } else {
              var fatherId;
              if (mode === 'add') {
                fatherId = Number(mask.querySelector('[data-father-locked]').getAttribute('data-father-locked'));
              } else {
                fatherId = Number(mask.querySelector('#f-father').dataset.fatherId);
                if (!fatherId) {
                  showErr(mask, '请先选择父亲（输入姓名后从候选列表点选）');
                  return;
                }
              }
              res = store.addChild(fatherId, data);
            }
            if (!res.ok) { showErr(mask, res.error); return; }
            closeModal(mask);
            if (hooks.onChanged) hooks.onChanged();
            toast(mode === 'edit' ? '已保存修改' : '已添加「' + data.name + '」');
          }
        });
      });
    }

    function setupFatherSearch(mask) {
      var input = mask.querySelector('#f-father');
      if (!input) return;
      var cands = mask.querySelector('.father-cands');
      input.addEventListener('input', function () {
        var q = input.value.trim();
        cands.innerHTML = '';
        if (!q) { cands.classList.add('hidden'); return; }
        var list = store.getPersons().filter(function (p) {
          return p.gender === 'M' && p.name.indexOf(q) !== -1;
        }).slice(0, 15);
        if (!list.length) { cands.classList.add('hidden'); return; }
        cands.classList.remove('hidden');
        list.forEach(function (p) {
          var d = document.createElement('div');
          d.className = 'fc-item';
          d.textContent = p.name + '（第' + p.gen + '世）';
          d.addEventListener('click', function () {
            input.value = p.name;
            input.dataset.fatherId = p.id;
            cands.classList.add('hidden');
          });
          cands.appendChild(d);
        });
      });
    }

    // ---------- 对外：新增 / 添加子女 / 编辑 ----------
    function openAddChild(person) {
      var mask = openModal(formHtml(person, 'add'));
      bindFormActions(mask, person, 'add');
    }

    function openAdd() {
      var mask = openModal(formHtml(null, 'new'));
      bindFormActions(mask, null, 'new');
      setupFatherSearch(mask);
    }

    function openEdit(person) {
      var mask = openModal(formHtml(person, 'edit'));
      bindFormActions(mask, person, 'edit');
    }

    // ---------- 对外：删除（二次确认） ----------
    function openDelete(person) {
      var n = store.countSubtree(person);
      var mask = openModal(
        '<h3 class="modal-title title-danger">确认删除</h3>' +
        '<div class="confirm-text">' +
          '确定要删除 <b>' + esc(person.name) + '</b> 吗？<br>' +
          '其名下后裔共 <b>' + n + '</b> 人将一并删除，此操作<b>不可恢复</b>。' +
        '</div>' +
        '<div class="modal-actions">' +
          '<button type="button" class="btn-ghost" data-act="cancel">取消</button>' +
          '<button type="button" class="btn-danger" data-act="confirm">确认删除</button>' +
        '</div>'
      );
      mask.querySelectorAll('[data-act]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var act = btn.getAttribute('data-act');
          if (act === 'cancel') { closeModal(mask); return; }
          if (act === 'confirm') {
            var res = store.removePerson(person.id);
            if (!res.ok) { toast(res.error, 'error'); closeModal(mask); return; }
            closeModal(mask);
            if (hooks.onChanged) hooks.onChanged();
            toast('已删除「' + person.name + '」及其后裔共 ' + res.removed + ' 人');
          }
        });
      });
    }

    // ---------- 对外：导出 ----------
    function openExport() {
      var json = store.exportJSON();
      var n = store.getStats().total;
      var mask = openModal(
        '<h3 class="modal-title">导出数据（JSON）</h3>' +
        '<div class="modal-hint">当前共 <b>' + n + '</b> 人。可下载保存，或复制后通过「导入」恢复。</div>' +
        '<textarea class="json-area" id="export-json" readonly spellcheck="false"></textarea>' +
        '<div class="modal-actions">' +
          '<button type="button" class="btn-primary" data-act="download">下载 .json</button>' +
          '<button type="button" class="btn-ghost" data-act="copy">复制</button>' +
          '<button type="button" class="btn-ghost" data-act="close">关闭</button>' +
        '</div>'
      );
      var ta = mask.querySelector('#export-json');
      ta.value = json;
      ta.addEventListener('click', function () { ta.select(); });

      mask.querySelectorAll('[data-act]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var act = btn.getAttribute('data-act');
          if (act === 'close') { closeModal(mask); return; }
          if (act === 'copy') {
            var ok = false;
            if (navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(json).then(function () {
                toast('已复制到剪贴板');
              }, function () { toast('复制失败，请手动选择复制', 'error'); });
              ok = true;
            }
            if (!ok) {
              ta.select();
              try { document.execCommand('copy'); toast('已复制到剪贴板'); }
              catch (e) { toast('复制失败，请手动选择复制', 'error'); }
            }
          }
          if (act === 'download') {
            var blob = new Blob([json], { type: 'application/json;charset=utf-8' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            var d = new Date();
            var pad = function (x) { return String(x).padStart(2, '0'); };
            a.href = url;
            a.download = store.getSurname() + '氏族谱_' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '.json';
            document.body.appendChild(a);
            a.click();
            setTimeout(function () {
              document.body.removeChild(a);
              URL.revokeObjectURL(url);
            }, 200);
            toast('已开始下载 JSON 文件');
          }
        });
      });
    }

    // ---------- 对外：导入 ----------
    function openImport() {
      var n = store.getStats().total;
      var mask = openModal(
        '<h3 class="modal-title">导入数据（JSON）</h3>' +
        '<div class="modal-hint">支持：本页导出的格式、人员数组 <code>[{…}]</code>、树形 <code>{root:{…}}</code>。<br>导入将<b>覆盖</b>当前 <b>' + n + '</b> 条数据。</div>' +
        '<textarea class="json-area" id="import-json" spellcheck="false" placeholder="在此粘贴 JSON，或从文件选择…"></textarea>' +
        '<div class="modal-actions">' +
          '<label class="btn btn-ghost btn-file">从文件选择<input type="file" id="import-file" accept=".json,application/json" hidden></label>' +
          '<button type="button" class="btn-primary" data-act="import">导入</button>' +
          '<button type="button" class="btn-ghost" data-act="close">取消</button>' +
        '</div>' +
        '<div class="form-err hidden"></div>'
      );
      var ta = mask.querySelector('#import-json');
      var fileInput = mask.querySelector('#import-file');
      fileInput.addEventListener('change', function () {
        var file = fileInput.files && fileInput.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function () { ta.value = String(reader.result || ''); };
        reader.readAsText(file, 'utf-8');
      });

      mask.querySelectorAll('[data-act]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var act = btn.getAttribute('data-act');
          if (act === 'close') { closeModal(mask); return; }
          if (act === 'import') {
            var text = ta.value.trim();
            if (!text) { showErr(mask, '请先粘贴 JSON 或选择文件'); return; }
            var res = store.importJSON(text);
            if (!res.ok) { showErr(mask, res.error); return; }
            closeModal(mask);
            if (hooks.onChanged) hooks.onChanged();
            toast('导入成功：共 ' + res.stats.total + ' 人，' + res.maxGen + ' 世');
          }
        });
      });
    }

    // ---------- 对外：重置为示例数据 ----------
    function openReset(loader) {
      var n = store.getStats().total;
      var mask = openModal(
        '<h3 class="modal-title">确认重置</h3>' +
        '<div class="confirm-text">将用<b>示例数据</b>替换当前全部 <b>' + n + '</b> 条数据，此操作不可恢复。继续？</div>' +
        '<div class="modal-actions">' +
          '<button type="button" class="btn-ghost" data-act="cancel">取消</button>' +
          '<button type="button" class="btn-danger" data-act="confirm">重置</button>' +
        '</div>'
      );
      mask.querySelectorAll('[data-act]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var act = btn.getAttribute('data-act');
          if (act === 'cancel') { closeModal(mask); return; }
          if (act === 'confirm') {
            var gen = loader();
            var res = store.loadFromArray(gen.persons, { surname: gen.surname, poem: gen.poem });
            if (!res.ok) { toast(res.error, 'error'); closeModal(mask); return; }
            closeModal(mask);
            if (hooks.onChanged) hooks.onChanged();
            toast('已重置为示例数据：' + res.stats.total + ' 人');
          }
        });
      });
    }

    return {
      openAddChild: openAddChild,
      openAdd: openAdd,
      openEdit: openEdit,
      openDelete: openDelete,
      openExport: openExport,
      openImport: openImport,
      openReset: openReset,
      toast: toast
    };
  }

  global.FamilyEditor = { create: createEditor };
  if (typeof module !== 'undefined' && module.exports) module.exports = { create: createEditor };
})(typeof globalThis !== 'undefined' ? globalThis : this);
