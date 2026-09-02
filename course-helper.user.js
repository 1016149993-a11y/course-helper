// ==UserScript==
// @name         网课观看辅助（WeLearn / 学习通 / ULearning）
// @namespace    local.dsl-course-helper
// @version      0.3.2
// @description  记忆播放位置、章节跳转、倍速播放（0.5x~16x）—— 仅优化观看体验，不伪造观看记录、不刷时长、不刷题
// @author       1016149993-a11y
// @license      MIT
// @match        *://*.chaoxing.com/*
// @match        *://*.unipus.cn/*
// @match        *://*.ulearning.cn/*
// @match        *://*.ulearning.com.cn/*
// @run-at       document-idle
// @grant        none
// @homepageURL  https://github.com/1016149993-a11y/course-helper
// @supportURL   https://github.com/1016149993-a11y/course-helper/issues
// @updateURL    https://raw.githubusercontent.com/1016149993-a11y/course-helper/main/course-helper.user.js
// @downloadURL  https://raw.githubusercontent.com/1016149993-a11y/course-helper/main/course-helper.user.js
// ==/UserScript==
//
// 安装：Tampermonkey 或 脚本猫（ScriptCat）→ 直接打开本文件的 Raw 链接会提示安装；
//       或在脚本管理器中新建脚本 → 粘贴本文件内容保存。
//
// 功能：右下角 ⚡ 按钮打开面板 ——
//   1. 倍速：0.5x ~ 16x，只调用浏览器原生 video.playbackRate（和平台自带倍速同一机制）。
//      注意：过高倍速可能被平台记为异常或超出视频解码能力，请按需使用。
//   2. 章节：列出当前页面检测到的章节/课程链接，点击跳转（通用扫描，不针对某平台写死）。
//   3. 记忆位置：每个视频的播放位置存 localStorage，刷新后自动续播（弹提示）。
//   4. 自动下一章节（连播）：默认关闭，需在面板手动勾选；视频正常播完 3 秒后
//      自动进入下一章节。仅是连播辅助，播放本身仍真实进行。
//   它不会模拟播放、不会在后台挂机、不伪造任何观看时长。

(function () {
  'use strict';

  var PANEL_ID = 'dsl-helper';
  var SPEED_KEY = 'dsl_speed';
  var POS_KEY = 'dsl_pos_';
  var NEXT_KEY = 'dsl_autonext';
  var CUR_KEY = 'dsl_lastchap';
  var SPEEDS = [0.5, 1, 1.25, 1.5, 1.75, 2, 3, 4, 8, 16];

  // ---------- 工具 ----------
  function dbg() {
    try {
      var args = ['[course-helper]'].concat(Array.prototype.slice.call(arguments));
      console.log.apply(console, args);
    } catch (e) {}
  }

  function toastIn(doc, msg) {
    try {
      var el = doc.getElementById(PANEL_ID + '-toast');
      if (!el) {
        el = doc.createElement('div');
        el.id = PANEL_ID + '-toast';
        el.style.cssText = 'position:fixed;right:16px;bottom:64px;z-index:2147483647;' +
          'background:rgba(20,20,20,.85);color:#fff;padding:8px 14px;border-radius:6px;' +
          'font:13px/1.4 sans-serif;opacity:0;transition:opacity .25s;pointer-events:none';
        doc.documentElement.appendChild(el);
      }
      el.textContent = msg;
      el.style.opacity = '1';
      clearTimeout(el._t);
      el._t = setTimeout(function () { el.style.opacity = '0'; }, 2500);
    } catch (e) {}
  }

  function toast(msg) {
    toastIn(document, msg);
    // iframe 里的提示同步到顶层页面，避免视频帧看不到
    try {
      var td = window.top && window.top.document;
      if (td && td !== document) toastIn(td, msg);
    } catch (e) {}
  }

  // 收集当前文档及所有同源 iframe（含嵌套）里的 video，跨域 iframe 直接跳过
  function allVideos() {
    var out = [], docs = [document];
    for (var i = 0; i < docs.length && docs.length < 20; i++) {
      out = out.concat(Array.prototype.slice.call(docs[i].querySelectorAll('video')));
      docs[i].querySelectorAll('iframe').forEach(function (f) {
        try { if (f.contentDocument) docs.push(f.contentDocument); } catch (e) {}
      });
    }
    return out;
  }

  function fmt(s) {
    s = Math.floor(s || 0);
    return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
  }

  // ---------- 倍速 ----------
  // localStorage 在沙盒 iframe（独立源）中会抛 SecurityError，必须保护
  function savedSpeed() {
    try {
      var s = parseFloat(localStorage.getItem(SPEED_KEY));
      if (s > 0) return s;
    } catch (e) {}
    return 1;
  }
  // 只有用户在面板里主动选过倍速才强制应用，避免覆盖平台自带的倍速控制
  function hasUserSpeed() {
    try { return localStorage.getItem(SPEED_KEY) !== null; } catch (e) { return false; }
  }

  function applySpeedAll(s) {
    allVideos().forEach(function (v) {
      try { if (v.playbackRate !== s) v.playbackRate = s; } catch (e) {}
    });
  }

  // ---------- 位置记忆 ----------
  function posKey(v) {
    var src = v.currentSrc || v.src || '';
    if (!src || src.indexOf('blob:') === 0) src = location.pathname;
    return POS_KEY + encodeURIComponent(src).slice(0, 200);
  }

  function savePos(v) {
    try {
      var d = v.duration;
      if (isFinite(d) && v.currentTime > 5 && v.currentTime < d - 5) {
        localStorage.setItem(posKey(v), JSON.stringify({ t: v.currentTime, d: d, at: Date.now() }));
      }
    } catch (e) {}
  }

  function restorePos(v) {
    if (v._dslRestored) return;
    v._dslRestored = true;
    try {
      var p = JSON.parse(localStorage.getItem(posKey(v)));
      if (!p || !(p.t > 30) || !(isFinite(v.duration) && p.t < v.duration - 30)) return;
      v.currentTime = p.t;
      toast('已恢复到上次位置 ' + fmt(p.t));
    } catch (e) {}
  }

  function watchVideo(v) {
    if (v._dslWatched) return;
    v._dslWatched = true;
    v.addEventListener('loadedmetadata', restorePos);
    v.addEventListener('play', restorePos);
    v.addEventListener('ended', function () {
      v._dslEndedFired = true;
      dbg('video ended');
      if (!autoNextEnabled()) return;
      v._dslAdvanced = true; // 该视频已消费，续播扫描时跳过
      toast('本节播完，4 秒后进入下一节…');
      setTimeout(function () { autoNext(v); }, 4000);
    });
    var last = 0;
    v.addEventListener('timeupdate', function () {
      var now = Date.now();
      if (now - last > 5000) { last = now; savePos(v); }
      // 兜底：个别平台在结束前拦截 ended 事件，接近结尾时直接触发
      try {
        var d = v.duration;
        if (!v._dslEndedFired && isFinite(d) && d > 0 && v.currentTime > 5 && d - v.currentTime < 1.5) {
          v._dslEndedFired = true;
          dbg('接近结尾，兜底触发自动下一章节');
          if (!autoNextEnabled()) return;
          v._dslAdvanced = true;
          toast('本节播完，4 秒后进入下一节…');
          setTimeout(function () { autoNext(v); }, 4000);
        }
      } catch (e) {}
    });
  }

  // ---------- 自动下一章节（默认关闭，面板手动开启） ----------
  function autoNextEnabled() {
    try { return localStorage.getItem(NEXT_KEY) === '1'; } catch (e) { return false; }
  }

  // 判断章节条目是否是"当前章节"：自身或近邻祖先带选中态样式/属性
  function entryIsActive(e) {
    var el = e.el;
    if (!el || !el.isConnected) return false;
    var node = el;
    for (var i = 0; i < 5 && node; i++, node = node.parentElement) {
      if (node.getAttribute && node.getAttribute('aria-current')) return true;
      var cls = '';
      try { cls = String(node.className || '').toLowerCase(); } catch (e2) {}
      var toks = cls.split(/\s+/);
      for (var j = 0; j < toks.length; j++) {
        var t = toks[j];
        if (!t) continue;
        if (/(active|current|selected|chosen|highlight|checked)/.test(t)) return true;
        if (t === 'on' || t === 'cur' || /-on$/.test(t) || /^on-/.test(t)) return true;
      }
    }
    return false;
  }

  function rememberChapter(text) {
    try { localStorage.setItem(CUR_KEY, JSON.stringify({ t: text, at: Date.now() })); } catch (e) {}
  }
  function rememberedChapter() {
    try {
      var p = JSON.parse(localStorage.getItem(CUR_KEY));
      if (p && p.t) return p.t;
    } catch (e) {}
    return '';
  }

  // 优学院/ULearning 专用推进逻辑（基于官方"下一页"按钮与 KO 完成标记，参考社区实现机制）
  // 返回：'modal'（弹窗已处理需重试）| 'play'（已续播下个视频）| 'next'（已点下一页）| null（不适用）
  function ulearningAdvance(endedVideo) {
    var docs = frameDocs();
    var i, j;
    // 1) 平台弹窗（统计/提示）挡路 → 点掉后重试
    for (i = 0; i < docs.length; i++) {
      var modal = docs[i].querySelector('.modal.fade.in');
      if (modal) {
        var btns = modal.querySelectorAll('.btn-hollow, .btn-submit');
        if (btns.length) { try { btns[btns.length - 1].click(); dbg('已关闭平台弹窗'); } catch (e) {} }
        return 'modal';
      }
    }
    // 2) 视频页：先播完当前页未完成的视频
    for (i = 0; i < docs.length; i++) {
      var videos = docs[i].querySelectorAll('.file-media');
      if (!videos.length) continue;
      var finished = docs[i].querySelectorAll("[data-bind='text: $root.i18nMessageText().finished']");
      for (j = 0; j < videos.length; j++) {
        var box = videos[j];
        var native = box.querySelector ? (box.querySelector('video') || box) : box;
        if (native === endedVideo || native._dslAdvanced) continue;
        if (finished[j]) continue; // 平台已标记看完
        try {
          var pp = docs[i].querySelectorAll('.mejs__button.mejs__playpause-button button');
          if (pp[j] && pp[j].getAttribute('title') === '播放') { pp[j].click(); dbg('续播第', j + 1, '个视频'); return 'play'; }
          if (native.paused) { native.play(); dbg('原生续播第', j + 1, '个视频'); return 'play'; }
        } catch (e) {}
      }
      // 3) 本页全部看完 → 官方"下一页"按钮
      var np = docs[i].querySelector('.next-page-btn.cursor');
      if (np) { try { np.click(); dbg('已点击官方下一页按钮'); } catch (e) {} return 'next'; }
    }
    return null;
  }

  function autoNext(endedVideo) {
    // 优学院/ULearning：官方"下一页"按钮路径优先
    var r = ulearningAdvance(endedVideo);
    if (r === 'modal') { toast('页面有弹窗，3 秒后重试'); setTimeout(function () { autoNext(endedVideo); }, 3000); return; }
    if (r === 'play') return;
    if (r === 'next') { toast('已自动进入下一节'); return; }
    // —— 通用路径：章节列表定位 ——
    var links = chapterLinks();
    dbg('自动下一章节触发，检测到章节条目：', links.length);
    if (!links.length) { toast('未检测到章节列表，无法自动切换'); return; }
    var idx = -1, how = '';
    var curHref = location.href.replace(/#.*$/, '');
    var lastT = rememberedChapter();
    for (var i = 0; i < links.length; i++) {
      var e = links[i];
      if (!how && e.href && e.href.replace(/#.*$/, '') === curHref) { idx = i; how = 'url'; }
      if (idx < 0 && entryIsActive(e)) { idx = i; how = '样式'; }
      if (idx < 0 && lastT && e.text === lastT) { idx = i; how = '上次记录'; }
    }
    dbg('当前章节定位：', idx, how || '（未定位到）');
    if (idx < 0) { toast('无法定位当前章节，未自动切换'); return; }
    if (idx >= links.length - 1) { toast('已是最后一节'); return; }
    var next = links[idx + 1];
    rememberChapter(next.text);
    toast('本节播完，3 秒后进入：' + next.text);
    setTimeout(function () {
      try {
        if (next.href) { location.href = next.href; return; }
        if (next.el && next.el.isConnected) { next.el.click(); toast('已切换：' + next.text); }
        else { toast('下一节入口已失效，请手动切换'); }
      } catch (e) { dbg('切换失败', e); }
    }, 3000);
  }

  // ---------- 章节链接 ----------
  // 三类可识别的章节入口：
  //   A. 真链接：href 为 http(s) 且包含平台常见关键词 → 直接跳转
  //   B. JS 菜单：<a href="javascript:;"> 等，按文本特征识别（第X章/Unit X...），模拟 click
  //   C. 框架绑定菜单：Knockout data-bind="text: ..." 文本节点（优学院/U学院等 SPA），
  //      向上找 data-bind 含 click: 的可点击容器（li/a），模拟 click
  var CHAPTER_HREF_RE = /(video|chapter|learn|course|work|detail|knowledge|card|list)/i;
  var CHAPTER_TEXT_RE = /(第\s*[\d一二三四五六七八九十百]+\s*[章节讲单元课]|chapter|unit\s*[\d一二三四五六七八九十]|lesson|section\s*\d|module\s*\d)/i;

  // 收集当前文档 + 同源 iframe（含嵌套）
  function scanDocs() {
    var docs = [document];
    for (var i = 0; i < docs.length && docs.length < 20; i++) {
      docs[i].querySelectorAll('iframe').forEach(function (f) {
        try { if (f.contentDocument) docs.push(f.contentDocument); } catch (e) {}
      });
    }
    return docs;
  }
  // 章节扫描用：再加上同源的父页面/顶层页面（视频在 iframe、章节菜单在父页的场景）
  function frameDocs() {
    var docs = scanDocs();
    try { var pd = window.parent && window.parent.document; if (pd && docs.indexOf(pd) === -1) docs.push(pd); } catch (e) {}
    try { var td = window.top && window.top.document; if (td && docs.indexOf(td) === -1) docs.push(td); } catch (e) {}
    return docs;
  }

  function chapterLinks() {
    var seenHref = {}, seenTargets = [], out = [];
    function addTarget(target, text, href) {
      if (!target || seenTargets.indexOf(target) !== -1) return;
      seenTargets.push(target);
      out.push({ href: href || '', text: text, el: target });
    }
    frameDocs().forEach(function (doc) {
      // Pass A：<a> 真链接 / 章节文本 JS 菜单
      doc.querySelectorAll('a').forEach(function (a) {
        var text = (a.textContent || '').replace(/\s+/g, ' ').trim();
        if (text.length < 2 || text.length > 60) return;
        var realHref = '';
        try { realHref = a.href || ''; } catch (e) {}
        if (/^https?:/i.test(realHref)) {
          if (CHAPTER_HREF_RE.test(realHref) && !seenHref[realHref]) {
            seenHref[realHref] = 1;
            addTarget(a, text, realHref);
          }
        } else if (CHAPTER_TEXT_RE.test(text)) {
          addTarget(el_closestClickable(a) || a, text, '');
        }
      });
      // Pass B：Knockout 等框架的 data-bind 文本节点
      doc.querySelectorAll('[data-bind]').forEach(function (el) {
        var bind = el.getAttribute('data-bind') || '';
        if (!/text\s*:/.test(bind)) return;
        var text = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (text.length < 2 || text.length > 60) return;
        addTarget(el_closestClickable(el) || (el.tagName === 'A' ? el : null), text, '');
      });
    });
    return out.slice(0, 80);
  }

  // 仅统计当前文档自身的章节入口（用于 iframe 是否自建面板的判断，不含父页）
  function ownLinkCount() {
    var n = 0;
    document.querySelectorAll('a').forEach(function (a) {
      var text = (a.textContent || '').replace(/\s+/g, ' ').trim();
      if (text.length < 2 || text.length > 60) return;
      var href = '';
      try { href = a.href || ''; } catch (e) {}
      if (/^https?:/i.test(href) ? CHAPTER_HREF_RE.test(href) : CHAPTER_TEXT_RE.test(text)) n++;
    });
    return n;
  }

  // 找元素自身或祖先中带 click: 绑定的可点击容器
  function el_closestClickable(el) {
    try { return el.closest('[data-bind*="click:"]'); } catch (e) { return null; }
  }

  // ---------- 面板 ----------
  function createPanel() {
    var panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.style.cssText = 'position:fixed;right:14px;bottom:58px;z-index:2147483646;width:200px;display:none;' +
      'background:#fff;border:1px solid #d0d0d0;border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,.18);' +
      'font:13px/1.5 -apple-system,"Segoe UI",sans-serif;color:#222';
    panel.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;user-select:none">' +
      '<b>⚡ 观看辅助</b><span id="' + PANEL_ID + '-close" style="color:#999;cursor:pointer;padding:0 4px">✕</span></div>' +
      '<div style="padding:0 10px 10px">' +
      '<div style="margin:4px 0">倍速</div>' +
      '<div id="' + PANEL_ID + '-speeds" style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px"></div>' +
      '<label style="display:flex;align-items:center;gap:6px;margin:0 0 10px;user-select:none;cursor:pointer">' +
      '<input type="checkbox" id="' + PANEL_ID + '-autonext">自动下一章节（连播）</label>' +
      '<div style="margin:4px 0">章节</div>' +
      '<div id="' + PANEL_ID + '-links" style="max-height:180px;overflow:auto"></div></div>';
    document.documentElement.appendChild(panel);

    var btn = document.createElement('div');
    btn.id = PANEL_ID + '-btn';
    btn.textContent = '⚡';
    btn.title = '观看辅助：倍速 / 记忆位置 / 章节跳转';
    btn.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483646;width:36px;height:36px;' +
      'border-radius:50%;background:#1a73e8;color:#fff;font-size:18px;line-height:36px;text-align:center;' +
      'cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.25);user-select:none';
    document.documentElement.appendChild(btn);

    btn.addEventListener('click', function () {
      var show = panel.style.display === 'none';
      panel.style.display = show ? 'block' : 'none';
      if (show) renderLinks();
    });
    panel.querySelector('#' + PANEL_ID + '-close').addEventListener('click', function () {
      panel.style.display = 'none';
    });

    var speedsBox = panel.querySelector('#' + PANEL_ID + '-speeds');
    SPEEDS.forEach(function (s) {
      var b = document.createElement('button');
      b.textContent = s + 'x';
      b.style.cssText = 'border:1px solid #c5c5c5;background:#f5f5f5;border-radius:4px;padding:2px 7px;cursor:pointer';
      b.addEventListener('click', function () {
        try { localStorage.setItem(SPEED_KEY, String(s)); } catch (e) {}
        applySpeedAll(s);
        refreshSpeedBtns();
        toast('已设为 ' + s + 'x');
      });
      speedsBox.appendChild(b);
    });
    function refreshSpeedBtns() {
      Array.prototype.forEach.call(speedsBox.children, function (b) {
        var active = hasUserSpeed() && parseFloat(b.textContent) === savedSpeed();
        b.style.background = active ? '#1a73e8' : '#f5f5f5';
        b.style.color = active ? '#fff' : '#222';
      });
    }
    refreshSpeedBtns();

    var autoNextChk = panel.querySelector('#' + PANEL_ID + '-autonext');
    autoNextChk.checked = autoNextEnabled();
    autoNextChk.addEventListener('change', function () {
      try { localStorage.setItem(NEXT_KEY, autoNextChk.checked ? '1' : '0'); } catch (e) {}
      toast(autoNextChk.checked ? '已开启自动下一章节' : '已关闭自动下一章节');
    });

    var linksBox = panel.querySelector('#' + PANEL_ID + '-links');
    function renderLinks() {
      var links = chapterLinks();
      linksBox.innerHTML = '';
      if (!links.length) {
        linksBox.textContent = '未检测到章节链接';
        linksBox.style.color = '#999';
        return;
      }
      linksBox.style.color = '#222';
      links.forEach(function (l) {
        var item = document.createElement('div');
        item.textContent = l.text;
        item.title = l.href || l.text + '（页面内菜单，点击模拟）';
        item.style.cssText = 'padding:4px 6px;border-radius:4px;cursor:pointer;overflow:hidden;' +
          'text-overflow:ellipsis;white-space:nowrap';
        item.addEventListener('click', function () {
          rememberChapter(l.text);
          if (l.href) { location.href = l.href; return; }
          try {
            if (l.el && l.el.isConnected) { l.el.click(); toast('已点击「' + l.text + '」'); }
            else { toast('菜单已失效，请刷新页面后重开面板'); }
          } catch (e) { toast('跳转失败'); }
        });
        linksBox.appendChild(item);
      });
    }
  }

  // ---------- 初始化 ----------
  var created = false;
  function looksLikeCourse() {
    return !!document.querySelector('video') || chapterLinks().length > 0 ||
      /(course|learn|mooc|knowledge|student|work|video)/i.test(location.href);
  }
  // 检查顶层文档及其同源 iframe 里是否已有面板，避免多面板重复
  function panelExistsUpstairs() {
    try {
      var top = window.top;
      if (top.document.getElementById(PANEL_ID)) return true;
      var found = false;
      top.document.querySelectorAll('iframe').forEach(function (f) {
        try {
          var d = f.contentDocument;
          if (d && d.getElementById(PANEL_ID)) found = true;
        } catch (e) {}
      });
      return found;
    } catch (e) { return false; }
  }
  function maybeCreate() {
    if (created) return;
    if (window.top === window.self) {
      if (looksLikeCourse()) { createPanel(); created = true; }
      return;
    }
    if (panelExistsUpstairs()) { created = true; return; }
    // 顶层没建面板时：有视频的播放器帧、或有章节菜单的目录帧都自己建面板
    if (document.querySelector('video') || ownLinkCount() > 0) {
      createPanel(); created = true;
    }
  }

  maybeCreate();
  setInterval(function () {
    maybeCreate();
    allVideos().forEach(function (v) { watchVideo(v); });
    if (!hasUserSpeed()) return; // 用户没选过倍速时不干预，保留平台自带倍速
    var s = savedSpeed();
    allVideos().forEach(function (v) {
      try { if (v.playbackRate !== s) v.playbackRate = s; } catch (e) {}
    });
  }, 3000);
})();
