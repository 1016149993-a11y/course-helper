// ==UserScript==
// @name         网课观看辅助（WeLearn / 学习通 / ULearning）
// @namespace    local.dsl-course-helper
// @version      0.5.3
// @description  记忆播放位置、章节跳转、倍速播放（0.5x~16x）、自动下一章节；支持自动答题（默认关闭，需配合题库/规则使用）
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
// @updateURL    https://cdn.jsdelivr.net/gh/1016149993-a11y/course-helper@main/course-helper.user.js
// @downloadURL  https://cdn.jsdelivr.net/gh/1016149993-a11y/course-helper@main/course-helper.user.js
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
//      自动进入下一章节。播放本身仍真实进行。
//   5. 自动答题：检测到题目页时可自动作答（默认关闭，需在面板手动勾选；
//      需要题库或平台规则支持，请自行扩展）。

(function () {
  'use strict';

  // 学习通各子域（mooc1/i.chaoxing.com 等）靠 document.domain 互通，
  // 提前声明让脚本实例之间能跨 iframe 访问视频
  try {
    if (/(^|\.)chaoxing\.com$/.test(location.hostname) && document.domain !== 'chaoxing.com') {
      document.domain = 'chaoxing.com';
    }
  } catch (e) {}

  var PANEL_ID = 'dsl-helper';
  var SPEED_KEY = 'dsl_speed';
  var POS_KEY = 'dsl_pos_';
  var NEXT_KEY = 'dsl_autonext';
  var CUR_KEY = 'dsl_lastchap';
  var QUIZ_KEY = 'dsl_quizpause_';
  var ANSWER_KEY = 'dsl_autoanswer';
  var SUBMIT_KEY = 'dsl_autosubmit';
  var lastQuizTipAt = 0, lastEndedAt = 0, lastActionLocal = 0, noVideoTicks = 0;
  var SPEEDS = [0.5, 1, 1.25, 1.5, 1.75, 2, 3, 4, 8, 16];

  // 各平台题目页 DOM 特征（用于自动连播时暂停，不是自动答题）
  var QUIZ_SELECTORS = {
    ulearning: '.question-setting-panel, .question-area, .question-wrapper, .question-box, .quiz-wrapper, .exam-container, .test-container, .task-question, .question-list, .question-main',
    chaoxing: '.questionLi, .Zy_TItle, .Zy_Topic, .chaoxingquiz, #chaoxingquiz, .cxQuize, .jobQuize, .preview_title, .pd_title, .subNav_u, .Zy_TItle_c, .TiMu, .Py_Tk, .tkTitle, .topic-list, .questionBox',
    unipus: '.question-box, .question-wrap, .test-container, .exam-wrapper, .quiz-wrapper, .question-container, .question-item, .question-content, .question-main'
  };

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
    var out = [], docs = scanDocs(), i;
    for (i = 0; i < docs.length; i++) {
      out = out.concat(Array.prototype.slice.call(docs[i].querySelectorAll('video')));
    }
    // 常规扫描一无所获时，尝试穿透 Shadow DOM（新版播放器可能把 video 藏进去）
    if (!out.length) {
      for (i = 0; i < docs.length; i++) collectShadowVideos(docs[i], out);
    }
    return out;
  }

  function collectShadowVideos(root, out) {
    try {
      var all = root.querySelectorAll('*');
      for (var i = 0; i < all.length && i < 800; i++) {
        var sr = all[i].shadowRoot;
        if (sr) {
          out = out.concat(Array.prototype.slice.call(sr.querySelectorAll('video')));
          collectShadowVideos(sr, out);
        }
      }
    } catch (e) {}
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
    dbg('发现视频:', String(v.currentSrc || v.src || '(无src/blob)').slice(0, 80));
    v.addEventListener('loadedmetadata', restorePos);
    v.addEventListener('play', restorePos);
    v.addEventListener('ended', function () {
      v._dslEndedFired = true;
      lastEndedAt = Date.now();
      dbg('video ended');
      if (!autoNextEnabled()) return;
      v._dslAdvanced = true; // 该视频已消费，续播扫描时跳过
      toast('本节播完，即将自动继续…');
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
          lastEndedAt = Date.now();
          dbg('接近结尾，兜底触发自动下一章节');
          if (!autoNextEnabled()) return;
          v._dslAdvanced = true;
          toast('本节播完，即将自动继续…');
          setTimeout(function () { autoNext(v); }, 4000);
        }
      } catch (e) {}
    });
  }

  // ---------- 自动下一章节（默认关闭，面板手动开启） ----------
  function autoNextEnabled() {
    try { return localStorage.getItem(NEXT_KEY) === '1'; } catch (e) { return false; }
  }

  // ---------- 自动答题（默认关闭，面板手动开启） ----------
  function autoAnswerEnabled() {
    try { return localStorage.getItem(ANSWER_KEY) === '1'; } catch (e) { return false; }
  }
  function autoSubmitEnabled() {
    try { return localStorage.getItem(SUBMIT_KEY) === '1'; } catch (e) { return false; }
  }

  // ---------- 答案源（AnswerSource）接口 ----------
  // 答案源用于把“题目”映射到“答案”。返回对象约定：
  //   { type: 'index', index: 0 }                单选：选第 index 个选项（从 0 开始）
  //   { type: 'multiple', indexes: [0, 2] }       多选：选中指定索引数组
  //   { type: 'text', value: '...' }              填空：填入文本
  //   { type: 'unknown' }                         不知道，使用兜底策略
  // 外部可以通过 window._courseHelperAnswerSource 注入自定义源，
  // 或注入 window._courseHelperQuestionBank 对象自动启用题库源。

  function normalizeAnswer(ans) {
    if (ans === null || ans === undefined) return { type: 'unknown' };
    if (typeof ans === 'number') return { type: 'index', index: ans };
    if (typeof ans === 'string') return { type: 'text', value: ans };
    if (ans && typeof ans === 'object') {
      if (ans.type === 'index' || ans.type === 'multiple' || ans.type === 'text') return ans;
      if (Array.isArray(ans.indexes)) return { type: 'multiple', indexes: ans.indexes };
      if (typeof ans.index === 'number') return { type: 'index', index: ans.index };
      if (typeof ans.value === 'string') return { type: 'text', value: ans.value };
    }
    return { type: 'unknown' };
  }

  // 默认答案源：返回 unknown，让答题器使用兜底策略（选首个选项）
  function firstOptionSource() {
    return { name: 'first-option', getAnswer: function () { return { type: 'unknown' }; } };
  }

  // 题库答案源：根据题目文本从题库对象查答案
  function questionBankSource(bank) {
    return {
      name: 'question-bank',
      getAnswer: function (question) {
        if (!bank) return { type: 'unknown' };
        var text = (question.text || '').replace(/\s+/g, ' ').trim();
        if (!text) return { type: 'unknown' };
        // 精确匹配
        if (bank[text]) return normalizeAnswer(bank[text]);
        // 去掉首尾数字编号等干扰后匹配
        var key2 = text.replace(/^\s*[\d一二三四五六七八九十]+[\.、]\s*/, '');
        if (key2 !== text && bank[key2]) return normalizeAnswer(bank[key2]);
        // 前 30 字模糊匹配（题库 key 通常以题目开头）
        var head = text.slice(0, 30);
        for (var k in bank) {
          if (k.indexOf(head) === 0 || head.indexOf(k) === 0) return normalizeAnswer(bank[k]);
        }
        return { type: 'unknown' };
      }
    };
  }

  // 远程 LLM / API 答案源（占位）：可扩展为异步预加载题库，
  // 油猴脚本内不建议同步请求网络，避免卡死页面。
  function llmAnswerSource(config) {
    return {
      name: 'llm',
      getAnswer: function (question) {
        dbg('LLM 答案源占位：', question.text.slice(0, 40));
        return { type: 'unknown' };
      }
    };
  }

  // 获取当前答案源。优先级：
  // 1. window._courseHelperAnswerSource（用户自定义源）
  // 2. window._courseHelperQuestionBank（题库对象）
  // 3. 默认首个选项兜底源
  function getAnswerSource() {
    try {
      if (window._courseHelperAnswerSource) return window._courseHelperAnswerSource;
      if (window._courseHelperQuestionBank) return questionBankSource(window._courseHelperQuestionBank);
    } catch (e) { dbg('读取答案源异常', e); }
    return firstOptionSource();
  }

  // 提取题目文本（优先题目主干元素，回退到整个题目容器）
  function getQuestionText(qEl) {
    try {
      var title = qEl.querySelector('.Zy_TItle, .Zy_TItle_c, .title, .question-title, .topic-title, .stem, .q-stem, .questionName, .question-name');
      if (title) return title.textContent.replace(/\s+/g, ' ').trim();
      return qEl.textContent.replace(/\s+/g, ' ').trim();
    } catch (e) { return ''; }
  }

  // 根据答案对象在题目容器上执行选择/填写
  function applyAnswer(qEl, answer) {
    if (!answer || answer.type === 'unknown') return false;
    var changed = false;
    if (answer.type === 'index') {
      var radios = qEl.querySelectorAll('input[type="radio"]');
      if (answer.index >= 0 && answer.index < radios.length && !radios[answer.index].checked) {
        radios[answer.index].click(); changed = true;
      }
      var checks = qEl.querySelectorAll('input[type="checkbox"]');
      if (!changed && answer.index >= 0 && answer.index < checks.length && !checks[answer.index].checked) {
        checks[answer.index].click(); changed = true;
      }
    }
    if (answer.type === 'multiple') {
      var checks2 = qEl.querySelectorAll('input[type="checkbox"]');
      for (var i = 0; i < answer.indexes.length; i++) {
        var idx = answer.indexes[i];
        if (idx >= 0 && idx < checks2.length && !checks2[idx].checked) {
          checks2[idx].click(); changed = true;
        }
      }
    }
    if (answer.type === 'text') {
      var inputs = qEl.querySelectorAll('input[type="text"], textarea, input:not([type])');
      for (var j = 0; j < inputs.length; j++) {
        if (!inputs[j].value) { inputs[j].value = answer.value; changed = true; break; }
      }
    }
    return changed;
  }

  // 兜底策略：单选/多选选第一个未选项，填空填占位符
  function fallbackFirstOption(qEl) {
    var changed = false;
    var radios = qEl.querySelectorAll('input[type="radio"]');
    if (radios.length && !qEl.querySelector('input[type="radio"]:checked')) {
      radios[0].click(); changed = true;
    }
    var checks = qEl.querySelectorAll('input[type="checkbox"]');
    if (checks.length && !qEl.querySelector('input[type="checkbox"]:checked')) {
      checks[0].click(); changed = true;
    }
    var inputs = qEl.querySelectorAll('input[type="text"], textarea, input:not([type])');
    for (var i = 0; i < inputs.length; i++) {
      if (!inputs[i].value) { inputs[i].value = '1'; changed = true; }
    }
    return changed;
  }

  // 通用提交：匹配常见提交按钮，点击后清除暂停
  function maybeSubmit(doc) {
    if (!autoSubmitEnabled()) return false;
    var submitBtn = doc.querySelector('.Zy_bottom input[value="提交"], .Zy_bottom button, .preview_submit, .Btn_cx, .Btn_blue_2, .btn_submit, .Btn_blue_1, .btn-submit, .submit-btn, input[type="submit"], button[type="submit"]');
    if (!submitBtn) return false;
    try {
      submitBtn.click();
      setQuizPaused(false);
      toast('已自动提交答案');
      dbg('已点击提交按钮');
      return true;
    } catch (e) { return false; }
  }

  // 自动答题入口。按平台调用对应的答题器；答题器内部使用 getAnswerSource() 获取答案。
  function autoAnswer() {
    if (!autoAnswerEnabled()) return false;
    var q = detectQuizPage();
    if (!q || isQuizDone(q)) return false;
    try {
      var source = getAnswerSource();
      var changed = false;
      if (q.platform === 'chaoxing') changed = answerChaoxing(q.doc, source);
      else if (q.platform === 'ulearning') changed = answerUlearning(q.doc, source);
      else if (q.platform === 'unipus') changed = answerUnipus(q.doc, source);
      else { dbg('未支持的题目页平台，跳过自动答题：', q.platform); return false; }
      if (changed) {
        toast('已自动选择答案（源：' + source.name + '），准备提交');
        setTimeout(function () { maybeSubmit(q.doc); }, 800);
      }
      return changed;
    } catch (e) { dbg('自动答题异常', e); }
    return false;
  }

  // 学习通答题器：遍历题目，先查询答案源，无答案则兜底选首个选项
  function answerChaoxing(doc, source) {
    var questions = doc.querySelectorAll('.questionLi, .TiMu, .Zy_TItle, .Py_Tk');
    if (!questions.length) { dbg('学习通题目页未识别到题目'); return false; }
    var changed = false;
    questions.forEach(function (q) {
      var text = getQuestionText(q);
      var answer = source.getAnswer({ text: text, platform: 'chaoxing', type: 'unknown', el: q });
      if (applyAnswer(q, answer)) { changed = true; return; }
      // 题库源未命中时回退兜底
      if (fallbackFirstOption(q)) { changed = true; dbg('学习通：题库未命中，兜底作答'); }
    });
    if (changed) dbg('学习通：已自动作答');
    return changed;
  }

  // 优学院答题器
  function answerUlearning(doc, source) {
    var questions = doc.querySelectorAll('.question-setting-panel, .question-area, .question-wrapper, .question-box');
    if (!questions.length) { dbg('优学院题目页未识别到题目'); return false; }
    var changed = false;
    questions.forEach(function (q) {
      var text = getQuestionText(q);
      var answer = source.getAnswer({ text: text, platform: 'ulearning', type: 'unknown', el: q });
      if (applyAnswer(q, answer)) { changed = true; return; }
      if (fallbackFirstOption(q)) { changed = true; dbg('优学院：题库未命中，兜底作答'); }
    });
    if (changed) dbg('优学院：已自动作答');
    return changed;
  }

  // U校园/WeLearn 答题器
  function answerUnipus(doc, source) {
    var questions = doc.querySelectorAll('.question-box, .question-item, .question-content, .question-wrap');
    if (!questions.length) { dbg('U校园题目页未识别到题目'); return false; }
    var changed = false;
    questions.forEach(function (q) {
      var text = getQuestionText(q);
      var answer = source.getAnswer({ text: text, platform: 'unipus', type: 'unknown', el: q });
      if (applyAnswer(q, answer)) { changed = true; return; }
      if (fallbackFirstOption(q)) { changed = true; dbg('U校园：题库未命中，兜底作答'); }
    });
    if (changed) dbg('U校园：已自动作答');
    return changed;
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

  // 跨帧节流：所有帧共享 localStorage 时间戳，避免多个帧同时触发重复动作
  function advanceThrottled() {
    try {
      var last = parseInt(localStorage.getItem('dsl_nextat'), 10) || 0;
      if (Date.now() - last < 5000) return false;
      localStorage.setItem('dsl_nextat', String(Date.now()));
      return true;
    } catch (e) {
      if (Date.now() - lastActionLocal < 5000) return false;
      lastActionLocal = Date.now();
      return true;
    }
  }

  // ---------- 题目页检测（连播暂停与自动答题用） ----------
  // 跨平台识别学习通 / 优学院 / U校园 的题目页，返回首次命中的信息对象；
  // 不是题目页或已检测不到时返回 null。
  function detectQuizPage() {
    var docs = frameDocs();
    var urlHint = /\/(quiz|exam|test|work)(\/|_|\.|$)/i.test(location.pathname) ||
                  /(quiz|exam|test|work|question)/i.test(document.title || '');
    for (var i = 0; i < docs.length; i++) {
      var d = docs[i];
      for (var platform in QUIZ_SELECTORS) {
        if (d.querySelector(QUIZ_SELECTORS[platform])) {
          return { doc: d, platform: platform, reason: 'selector' };
        }
      }
      // 通用兜底：URL 疑似题目页且页面存在单选/多选/填空等作答元素
      if (urlHint && (
        d.querySelector('input[type="radio"], input[type="checkbox"]') ||
        d.querySelector('.option, .answer, [class*="question"], [id*="question"], textarea, select')
      )) {
        return { doc: d, platform: 'generic', reason: 'url+options' };
      }
    }
    return null;
  }

  // 判断当前题目页是否已经作答/完成，已完成则允许继续推进
  function isQuizDone(info) {
    if (!info || !info.doc) return false;
    var d = info.doc;
    // 优学院：结果面板、完成标记、或"下一页"已出现但题目区已消失
    if (info.platform === 'ulearning') {
      if (d.querySelector('.test-result, .result-panel, .score, .correct-rate, .finished, .completed, .submit-success')) return true;
      if (!d.querySelector('.question-setting-panel, .question-area, .question-wrapper') && d.querySelector('.next-page-btn.cursor')) return true;
    }
    // 学习通：提交按钮仍可见视为未提交；否则若出现分数/答案/完成标记视为已提交
    if (info.platform === 'chaoxing') {
      if (d.querySelector('.Zy_bottom input[value="提交"], .Zy_bottom button, .preview_submit, .Btn_cx, .Btn_blue_2, .btn_submit, .Btn_blue_1')) return false;
      var bodyText = (d.body && d.body.textContent) || '';
      if (/(\d{1,3}\s*分|已完成|答案正确|成绩[：:]?\s*\d|得分[：:]?\s*\d|100\s*分)/.test(bodyText)) return true;
      if (d.querySelector('.right_answer, .answer_p, .right-answer, .answerRight, .answer-right, .complete-btn')) return true;
    }
    // U校园
    if (info.platform === 'unipus') {
      if (d.querySelector('.result, .score, .correct, .finished, .completed, .submit-success, .test-result')) return true;
    }
    // 通用兜底：提交成功/得分/完成等文案
    var bodyText2 = (d.body && d.body.textContent) || '';
    if (/(提交成功|已完成|得分|成绩|满分|100\s*分|答案正确|回答正确)/.test(bodyText2)) return true;
    return false;
  }

  function setQuizPaused(paused, reason) {
    try {
      var key = QUIZ_KEY + location.hostname;
      if (!paused) { localStorage.removeItem(key); return; }
      localStorage.setItem(key, JSON.stringify({ at: Date.now(), reason: reason || '', href: location.href }));
    } catch (e) {}
  }
  function isQuizPaused() {
    try {
      var key = QUIZ_KEY + location.hostname;
      var p = localStorage.getItem(key);
      if (!p) return false;
      var o = JSON.parse(p);
      // 10 分钟自动过期，防止异常残留阻塞连播
      if (Date.now() - (o.at || 0) > 600000) { localStorage.removeItem(key); return false; }
      // 已经切页则不再暂停
      if (o.href && o.href !== location.href) { localStorage.removeItem(key); return false; }
      return true;
    } catch (e) { return false; }
  }

  function quizTip() {
    if (Date.now() - lastQuizTipAt > 30000) {
      lastQuizTipAt = Date.now();
      toast('本页是题目页，请手动作答后继续');
    }
  }

  // 监听提交按钮，点击后尝试恢复连播；使用事件委托避免动态渲染导致绑定失效
  function watchQuizSubmission() {
    var q = detectQuizPage();
    if (!q) return;
    if (!q.doc._dslQuizDelegated) {
      q.doc._dslQuizDelegated = true;
      q.doc.addEventListener('click', function (e) {
        var target = e.target;
        var isSubmit = false;
        if (target.closest) {
          isSubmit = !!target.closest('input[type="submit"], button[type="submit"], .btn-submit, .submit-btn, .Zy_bottom input, .Btn_cx, .btn_submit, .Btn_blue_1, .Btn_blue_2, .preview_submit, .savePaper');
        }
        if (!isSubmit && target.nodeName === 'INPUT') {
          var type = target.getAttribute('type') || '';
          if (/submit/i.test(type)) isSubmit = true;
        }
        if (isSubmit) {
          // 延迟等待平台渲染结果/切换页面
          setTimeout(function () { setQuizPaused(false); dbg('检测到提交按钮点击，清除题目页暂停'); }, 1500);
        }
      });
    }
  }

  // 在文档中找实际的滚动容器：优先整页滚动，其次overflow为auto/scroll且内容溢出的最大容器
  function findScroller(doc) {
    try {
      var se = doc.scrollingElement || doc.documentElement;
      if (se && se.scrollHeight > se.clientHeight + 50) return se;
      var all = doc.querySelectorAll('div,main,section');
      var best = null;
      for (var i = 0; i < all.length && i < 400; i++) {
        var el = all[i];
        var oy;
        try { oy = doc.defaultView.getComputedStyle(el).overflowY; } catch (e) { continue; }
        if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 100) {
          if (!best || el.scrollHeight > best.scrollHeight) best = el;
        }
      }
      return best;
    } catch (e) { return null; }
  }

  // 优学院/ULearning 推进核心（主循环每 3 秒驱动一次，ended 事件可提前触发）
  // 返回：'quiz'（题目页不自动推进）| 'modal'（弹窗已点，等下轮）| 'play'（续播中）
  //      | 'next'（已点下一页）| 'wait'（节流或等待完成标记）| null（非优学院页面）
  function ulearningAdvance(endedVideo) {
    var docs = frameDocs();
    var i, j;
    // 0) 题目页（章节测试）：未完成时优先自动答题，否则暂停连播
    var q = detectQuizPage();
    if (q) {
      if (!isQuizDone(q)) {
        if (autoAnswerEnabled()) {
          autoAnswer();
          // 如果开启了自动提交，本轮已触发提交，下轮再看结果
          if (autoSubmitEnabled()) return 'quiz';
        }
        setQuizPaused(true, 'quiz');
        quizTip();
        return 'quiz';
      }
      // 题目页但已作答/已完成，允许继续推进
      setQuizPaused(false);
    }
    // 1) 平台弹窗（统计/提示）挡路 → 点掉，下一轮继续
    for (i = 0; i < docs.length; i++) {
      var modal = docs[i].querySelector('.modal.fade.in');
      if (modal) {
        if (advanceThrottled()) {
          var btns = modal.querySelectorAll('.btn-hollow, .btn-submit');
          if (btns.length) { try { btns[btns.length - 1].click(); dbg('已关闭平台弹窗'); } catch (e) {} }
        }
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
        var pp = docs[i].querySelectorAll('.mejs__button.mejs__playpause-button button');
        var isPaused = true;
        try {
          if (pp[j]) isPaused = pp[j].getAttribute('title') === '播放';
          else isPaused = native.paused;
        } catch (e) {}
        if (!isPaused) return 'play'; // 正在播，等它播完
        if (advanceThrottled()) {
          try {
            if (pp[j]) pp[j].click(); else native.play();
            dbg('续播第', j + 1, '个视频');
            return 'play';
          } catch (e) {}
        }
        return 'wait';
      }
      // 本页视频全部看完 → 继续下方滚动/翻页检查
    }
    // 3) 文档/课件页：自动向下滚动，滚到底才允许翻页
    for (i = 0; i < docs.length; i++) {
      if (docs[i].querySelector('.file-media')) continue; // 视频页不滚动
      if (!docs[i].querySelector('.doc-wrapper, .doc-player-component, .file-doc')) continue;
      var sc = findScroller(docs[i]);
      if (sc) {
        var atBottom = sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 10;
        if (!atBottom) {
          if (advanceThrottled()) {
            try {
              sc.scrollTop += Math.max(300, Math.floor(sc.clientHeight * 0.9));
              dbg('课件页自动滚动：', Math.floor(sc.scrollTop), '/', sc.scrollHeight);
            } catch (e) {}
          }
          return 'scroll';
        }
        dbg('课件页已滚动到底');
      }
      // 已到底或找不到滚动容器 → 继续翻页
    }
    // 4) 官方"下一页"按钮
    for (i = 0; i < docs.length; i++) {
      var np = docs[i].querySelector('.next-page-btn.cursor');
      if (np) {
        // 刚播完的视频给平台完成标记留时间（≥8 秒）
        if (lastEndedAt && Date.now() - lastEndedAt < 8000) return 'wait';
        if (advanceThrottled()) { try { np.click(); dbg('已点击官方下一页按钮'); } catch (e) {} return 'next'; }
        return 'wait';
      }
    }
    return null;
  }

  // 学习通专用推进：点击"下一节"按钮（PCount.next）翻到下一张卡，不跳过同章节卡
  // 三种按钮形态：#prevNextFocusNext（卡内翻页）、.prev_next.next、.nextChapter（测试/末尾卡翻页）
  // 当前卡有未播完的视频时不翻卡，让视频先播
  function chaoxingAdvance() {
    // 学习通题目页：未完成时优先自动答题，否则暂停连播
    var q = detectQuizPage();
    if (q) {
      if (!isQuizDone(q)) {
        if (autoAnswerEnabled()) {
          autoAnswer();
          if (autoSubmitEnabled()) return 'quiz';
        }
        setQuizPaused(true, 'quiz');
        quizTip();
        return 'quiz';
      }
      setQuizPaused(false);
    }
    var vids = allVideos();
    for (var i = 0; i < vids.length; i++) {
      if (!vids[i]._dslAdvanced) return null; // 有未播完视频，不翻卡
    }
    var docs = frameDocs();
    for (i = 0; i < docs.length; i++) {
      var btn = docs[i].querySelector('#prevNextFocusNext, .prev_next.next, .nextChapter');
      if (btn && btn.style.display !== 'none' && btn.offsetWidth > 0) {
        if (advanceThrottled()) {
          try { btn.click(); dbg('点击学习通"下一节"按钮'); } catch (e) {}
          return 'next';
        }
        return 'wait';
      }
    }
    return null;
  }

  // 通用自动播放：非优学院页面（学习通等）下，主循环自动播放暂停中的视频
  function autoPlayVideos() {
    var vids = allVideos();
    for (var i = 0; i < vids.length; i++) {
      var v = vids[i];
      if (v._dslAdvanced) continue; // 跳过刚播完、等待推进的
      try {
        if (!v.paused) continue;
        var p = v.play();
        if (p && p.catch) {
          p.catch(function () {
            // 被浏览器策略拦截（iframe 无用户手势）→ 降级为静音播放
            try {
              v.muted = true;
              var p2 = v.play();
              if (p2 && p2.catch) p2.catch(function () { dbg('静音自动播放也被拦截'); });
              dbg('自动播放被拦截，已转为静音播放');
            } catch (e) {}
          });
        }
        dbg('尝试自动播放视频');
        return;
      } catch (e) {}
    }
  }

  function autoNext(endedVideo) {
    // 优学院/ULearning：轮询推进（弹窗 → 续播 → 课件滚动 → 翻页）
    var r = ulearningAdvance(endedVideo);
    if (r) { if (r === 'next') toast('已自动进入下一节'); return; }
    // 学习通：点击"下一节"翻下一张卡
    r = chaoxingAdvance();
    if (r) { if (r === 'next') toast('已进入下一节'); return; }
    // —— 通用路径：章节列表定位 ——
    // 兜底再次检测题目页，防止通用路径误跳到下一章
    var q = detectQuizPage();
    if (q) {
      if (!isQuizDone(q)) {
        if (autoAnswerEnabled()) {
          autoAnswer();
          if (autoSubmitEnabled()) return;
        }
        setQuizPaused(true, 'quiz');
        quizTip();
        return;
      }
      setQuizPaused(false);
    }
    // tick 驱动（endedVideo 为空）时做冷却，避免无视频页连续跳章；ended 触发不限制
    if (!endedVideo) {
      try {
        if (Date.now() - (parseInt(localStorage.getItem('dsl_chapat'), 10) || 0) < 10000) {
          dbg('章节切换冷却中');
          return;
        }
      } catch (e) {}
    }
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
    try { localStorage.setItem('dsl_chapat', String(Date.now())); } catch (e) {}
    toast('本节播完，3 秒后进入：' + next.text);
    setTimeout(function () {
      try {
        if (next.href) { location.href = next.href; return; }
        // 重新扫描最新引用，避免学习通卡片区重渲染导致元素失效
        var fresh = null, links2 = chapterLinks();
        for (var k = 0; k < links2.length; k++) {
          if (links2[k].text === next.text) { fresh = links2[k]; break; }
        }
        var target = (fresh && fresh.el && fresh.el.isConnected) ? fresh.el
                   : (next.el && next.el.isConnected ? next.el : null);
        if (target) { target.click(); toast('已切换：' + next.text); return; }
        // 兜底：直接执行内联 onclick（学习通 getTeacherAjax）
        var oc = (fresh && fresh.onclick) || next.onclick;
        if (oc) {
          try { var w = window.top || window; w.eval(oc); toast('已切换：' + next.text); return; }
          catch (e) { dbg('eval onclick 失败', e); }
        }
        toast('下一节入口已失效，请手动切换');
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
  // 章节文本特征：第X章/节/单元、Unit/Lesson/Chapter，或数字编号开头（学习通样式如 "2.2 应力"）
  var CHAPTER_TEXT_RE = /(第\s*[\d一二三四五六七八九十百]+\s*[章节讲单元课]|chapter|unit\s*[\d一二三四五六七八九十]|lesson|section\s*\d|module\s*\d|^\s*\d+(\.\d+)+\s)/i;

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
    function addTarget(target, text, href, onclick) {
      if (!target || seenTargets.indexOf(target) !== -1) return;
      seenTargets.push(target);
      out.push({ href: href || '', text: text, el: target, onclick: onclick || '' });
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
            addTarget(a, text, realHref, '');
          }
        } else if (CHAPTER_TEXT_RE.test(text)) {
          addTarget(el_closestClickable(a) || a, text, '', a.getAttribute('onclick') || '');
        }
      });
      // Pass B：Knockout 等框架的 data-bind 文本节点
      doc.querySelectorAll('[data-bind]').forEach(function (el) {
        var bind = el.getAttribute('data-bind') || '';
        if (!/text\s*:/.test(bind)) return;
        var text = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (text.length < 2 || text.length > 60) return;
        addTarget(el_closestClickable(el) || (el.tagName === 'A' ? el : null), text, '', el.getAttribute('onclick') || '');
      });
      // Pass C：内联 onclick 菜单项（学习通等 jQuery 时代页面，无 href 无 data-bind）
      // 文本符合章节特征，或类名含 catalog/chapter（如学习通 posCatalog_name）
      doc.querySelectorAll('[onclick]').forEach(function (el) {
        var text = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (text.length < 2 || text.length > 60) return;
        var cls = '';
        try { cls = String(el.className || ''); } catch (e) {}
        if (!CHAPTER_TEXT_RE.test(text) && !/catalog|chapter/i.test(cls)) return;
        addTarget(el, text, '', el.getAttribute('onclick') || '');
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
      '<label style="display:flex;align-items:center;gap:6px;margin:0 0 6px;user-select:none;cursor:pointer">' +
      '<input type="checkbox" id="' + PANEL_ID + '-autoanswer">自动答题（选首个选项）</label>' +
      '<label style="display:flex;align-items:center;gap:6px;margin:0 0 10px;user-select:none;cursor:pointer">' +
      '<input type="checkbox" id="' + PANEL_ID + '-autosubmit">自动提交</label>' +
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

    var autoAnswerChk = panel.querySelector('#' + PANEL_ID + '-autoanswer');
    autoAnswerChk.checked = autoAnswerEnabled();
    autoAnswerChk.addEventListener('change', function () {
      try { localStorage.setItem(ANSWER_KEY, autoAnswerChk.checked ? '1' : '0'); } catch (e) {}
      toast(autoAnswerChk.checked ? '已开启自动答题' : '已关闭自动答题');
    });

    var autoSubmitChk = panel.querySelector('#' + PANEL_ID + '-autosubmit');
    autoSubmitChk.checked = autoSubmitEnabled();
    autoSubmitChk.addEventListener('change', function () {
      try { localStorage.setItem(SUBMIT_KEY, autoSubmitChk.checked ? '1' : '0'); } catch (e) {}
      toast(autoSubmitChk.checked ? '已开启自动提交' : '已关闭自动提交');
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
    watchQuizSubmission();
    if (autoAnswerEnabled()) autoAnswer(); // 自动答题独立运行
    if (autoNextEnabled() && !isQuizPaused()) {
      var r = ulearningAdvance(null); // 连播：每轮驱动一次推进（含无视频页自动跳下一页）
      if (!r) r = chaoxingAdvance(); // 学习通：点"下一节"翻下一张卡
      if (!r) {
        if (allVideos().length === 0) {
          // 课件页（学习通等）常伴随同章节视频卡，不自动跳章避免跳过
          var hasCw = false;
          frameDocs().forEach(function (d) {
            if (d.querySelector('.doc-wrapper, .doc-player-component, .file-doc, .file-ppt, .doc-iframe')) hasCw = true;
          });
          if (hasCw) {
            dbg('课件页，暂不自动跳章');
          } else if (++noVideoTicks >= 3) {
            // 连续 3 轮（约 9 秒）确认无视频，给懒加载的视频 iframe 留时间
            noVideoTicks = 0;
            autoNext(null);
          }
        } else {
          noVideoTicks = 0;
          autoPlayVideos();
        }
      }
    }
    if (!hasUserSpeed()) return; // 用户没选过倍速时不干预，保留平台自带倍速
    var s = savedSpeed();
    allVideos().forEach(function (v) {
      try { if (v.playbackRate !== s) v.playbackRate = s; } catch (e) {}
    });
  }, 3000);
})();
