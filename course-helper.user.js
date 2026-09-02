// ==UserScript==
// @name         网课观看辅助（WeLearn / 学习通 / ULearning）
// @namespace    local.dsl-course-helper
// @version      0.2.1
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
//   它不会模拟播放、不会在后台挂机、不伪造任何观看时长。

(function () {
  'use strict';

  var PANEL_ID = 'dsl-helper';
  var SPEED_KEY = 'dsl_speed';
  var POS_KEY = 'dsl_pos_';
  var SPEEDS = [0.5, 1, 1.25, 1.5, 1.75, 2, 3, 4, 8, 16];

  // ---------- 工具 ----------
  function toast(msg) {
    var el = document.getElementById(PANEL_ID + '-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = PANEL_ID + '-toast';
      el.style.cssText = 'position:fixed;right:16px;bottom:64px;z-index:2147483647;' +
        'background:rgba(20,20,20,.85);color:#fff;padding:8px 14px;border-radius:6px;' +
        'font:13px/1.4 sans-serif;opacity:0;transition:opacity .25s;pointer-events:none';
      document.documentElement.appendChild(el);
    }
    el.textContent = msg;
    el.style.opacity = '1';
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.style.opacity = '0'; }, 2500);
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
    var last = 0;
    v.addEventListener('timeupdate', function () {
      var now = Date.now();
      if (now - last > 5000) { last = now; savePos(v); }
    });
  }

  // ---------- 章节链接 ----------
  function chapterLinks() {
    var seen = {}, out = [];
    document.querySelectorAll('a[href]').forEach(function (a) {
      var href = a.href || '';
      var text = (a.textContent || '').replace(/\s+/g, ' ').trim();
      if (text.length < 2 || text.length > 60) return;
      if (!/(video|chapter|learn|course|work|detail|knowledge|card|list)/i.test(href)) return;
      if (seen[href]) return;
      seen[href] = 1;
      out.push({ href: href, text: text });
    });
    return out.slice(0, 50);
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
        item.title = l.href;
        item.style.cssText = 'padding:4px 6px;border-radius:4px;cursor:pointer;overflow:hidden;' +
          'text-overflow:ellipsis;white-space:nowrap';
        item.addEventListener('click', function () { location.href = l.href; });
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
  function maybeCreate() {
    if (created) return;
    if (window.top === window.self) {
      if (looksLikeCourse()) { createPanel(); created = true; }
    } else {
      try {
        if (window.top.document.getElementById(PANEL_ID)) { created = true; return; }
      } catch (e) {}
      // 跨域 iframe：自己就是播放器帧时才建面板，避免满屏重复
      if (document.querySelector('video')) { createPanel(); created = true; }
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
