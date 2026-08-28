/* ============================================================
 * 整洁树布局算法（Buchheim et al. 线性时间算法）
 * 实现对齐 d3-hierarchy tree.js 的权威版本：
 *  - firstWalk（后序）：兄弟基本间距直接设置（z = w.z + interval），
 *    用修正量 m 让子树相对父节点居中；apportion 仅处理更深层轮廓冲突。
 *  - secondWalk（先序）：x = z + 累加的父链 mod。
 * 输入：带 children / parent 引用的树根
 * 输出：为每个节点写入 .x（抽象坐标）
 * 使用：TidyTree(root, { nodeWidth, hGap })
 * ============================================================ */
(function (global) {
  'use strict';

  function tidyTree(root, options) {
    options = options || {};
    var nodeWidth = options.nodeWidth || 132;
    var hGap = options.hGap || 26;
    var interval = nodeWidth + hGap; // 相邻兄弟子树中心最小间距
    // 分离函数：默认恒定间距；可传 (a, b) => 兄弟 1 倍、堂亲 2 倍 等
    var separation = options.separation || function () { return interval; };

    // ---------- 内部树节点（不污染业务对象） ----------
    function TreeNode(orig, i) {
      this._ = orig;       // 原节点引用
      this.parent = null;
      this.children = null;
      this.A = null;       // default ancestor
      this.a = this;       // ancestor
      this.z = 0;          // prelim
      this.m = 0;          // mod
      this.c = 0;          // change
      this.s = 0;          // shift
      this.t = null;       // thread
      this.i = i;          // 兄弟序号
    }

    // 构建内部树（保持 children 顺序）
    var tree = new TreeNode(root, 0);
    var stack = [tree], node;
    while ((node = stack.pop())) {
      var kids = node._.children;
      if (kids && kids.length) {
        node.children = new Array(kids.length);
        for (var i = kids.length - 1; i >= 0; i--) {
          var child = node.children[i] = new TreeNode(kids[i], i);
          child.parent = node;
          stack.push(child);
        }
      }
    }
    // 根挂一个虚拟父节点（保证 v.parent 恒非空）
    (tree.parent = new TreeNode(null, 0)).children = [tree];

    // ---------- 算法核心 ----------
    function nextLeft(v) { return v.children ? v.children[0] : v.t; }
    function nextRight(v) { return v.children ? v.children[v.children.length - 1] : v.t; }

    function moveSubtree(wm, wp, shift) {
      var change = shift / (wp.i - wm.i);
      wp.c -= change;
      wp.s += shift;
      wm.c += change;
      wp.z += shift;
      wp.m += shift;
    }

    function executeShifts(v) {
      var shift = 0, change = 0, children = v.children, i = children.length, w;
      while (--i >= 0) {
        w = children[i];
        w.z += shift;
        w.m += shift;
        shift += w.s + (change += w.c);
      }
    }

    function nextAncestor(vim, v, ancestor) {
      return vim.a.parent === v.parent ? vim.a : ancestor;
    }

    function apportion(v, w, ancestor) {
      if (w) {
        var vip = v, vop = v, vim = w, vom = vip.parent.children[0];
        var sip = vip.m, sop = vop.m, sim = vim.m, som = vom.m, shift;
        while ((vim = nextRight(vim), vip = nextLeft(vip), vim && vip)) {
          vom = nextLeft(vom);
          vop = nextRight(vop);
          vop.a = v;
          shift = vim.z + sim - vip.z - sip + separation(vim._, vip._);
          if (shift > 0) {
            moveSubtree(nextAncestor(vim, v, ancestor), v, shift);
            sip += shift;
            sop += shift;
          }
          sim += vim.m;
          sip += vip.m;
          som += vom.m;
          sop += vop.m;
        }
        if (vim && !nextRight(vop)) {
          vop.t = vim;
          vop.m += sim - sop;
        }
        if (vip && !nextLeft(vom)) {
          vom.t = vip;
          vom.m += sip - som;
          ancestor = v;
        }
      }
      return ancestor;
    }

    function firstWalk(v) {
      var children = v.children,
          siblings = v.parent.children,
          w = v.i ? siblings[v.i - 1] : null;
      if (children) {
        executeShifts(v);
        var midpoint = (children[0].z + children[children.length - 1].z) / 2;
        if (w) {
          v.z = w.z + separation(v._, w._);
          v.m = v.z - midpoint;   // 修正量：让子树相对 v 居中
        } else {
          v.z = midpoint;
        }
      } else if (w) {
        v.z = w.z + separation(v._, w._);   // 叶子直接排在前一兄弟之后
      }
      v.parent.A = apportion(v, w, v.parent.A || siblings[0]);
    }

    function secondWalk(v) {
      v._.x = v.z + v.parent.m;
      v.m += v.parent.m;          // mods 沿父链累加
    }

    // 后序遍历 firstWalk，先序遍历 secondWalk
    var order = [];
    (function post(v) {
      if (v.children) for (var i = 0; i < v.children.length; i++) post(v.children[i]);
      order.push(v);
    })(tree);
    for (var oi = 0; oi < order.length; oi++) firstWalk(order[oi]);

    tree.parent.m = -tree.z;      // 根对齐到 x = 0
    (function pre(v) {
      secondWalk(v);
      if (v.children) for (var i = 0; i < v.children.length; i++) pre(v.children[i]);
    })(tree);

    return root;
  }

  global.TidyTree = tidyTree;
  if (typeof module !== 'undefined' && module.exports) module.exports = tidyTree;
})(typeof globalThis !== 'undefined' ? globalThis : this);
