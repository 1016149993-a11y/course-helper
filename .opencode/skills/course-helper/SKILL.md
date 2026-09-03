---
name: course-helper
description: |
  Use when the user is working on the course-helper userscript project (网课观看辅助 / auto-answer for Chaoxing/ULearning/Unipus).
  Triggers: "course-helper", "网课辅助", "自动答题", "学习通脚本", "优学院脚本", "刷课脚本", "course-helper.user.js".
  This skill tells agents how the script is structured, how auto-answer is implemented, and how to install/update/publish the script via browser automation.
metadata:
  version: "0.5.3"
---

# course-helper 网课观看辅助

这是一个油猴脚本（Tampermonkey / 脚本猫）项目，用于辅助学习通、优学院/ULearning、U校园/WeLearn 网课平台的观看与做题体验。

仓库地址：https://github.com/1016149993-a11y/course-helper

## 文件结构

```
course-helper/
├── course-helper.user.js   # 主脚本（油猴脚本本体）
├── README.md               # 面向用户的说明文档
├── CHANGELOG.md            # 版本变更日志
├── .opencode/
│   └── skills/course-helper/SKILL.md  # 本文件
```

## 核心功能

1. **倍速播放**：`0.5x ~ 16x`，调用浏览器原生 `video.playbackRate`
2. **记忆播放位置**：每个视频进度写入 `localStorage`，刷新后自动续播
3. **章节跳转**：扫描页面章节链接/JS菜单，右下角面板一键跳转
4. **自动下一章节（连播）**：默认关闭，视频播完/课件滚动到底后自动进入下一节
5. **自动答题**：默认关闭，检测题目页后可自动选择答案并提交

## 自动答题实现（重要）

自动答题代码集中在 `course-helper.user.js` 的以下函数：

| 函数 | 作用 |
|------|------|
| `detectQuizPage()` | 跨平台检测题目页（学习通/优学院/U校园），含 iframe 扫描 |
| `isQuizDone()` | 判断当前题目页是否已经提交/完成 |
| `autoAnswer()` | 自动答题入口，读取开关后分发到平台答题器 |
| `answerChaoxing(doc, source)` | 学习通答题器 |
| `answerUlearning(doc, source)` | 优学院答题器 |
| `answerUnipus(doc, source)` | U校园/WeLearn 答题器 |
| `maybeSubmit(doc)` | 自动点击提交按钮 |
| `setQuizPaused()` / `isQuizPaused()` | 题目页暂停状态持久化 |

### 答案源接口（AnswerSource）

脚本已抽象出可插拔的答案源，默认策略是"未命中则选首个选项"，优先保证完成率：

| 答案源 | 说明 |
|--------|------|
| `firstOptionSource()` | 默认源，返回 `unknown`，让答题器兜底 |
| `questionBankSource(bank)` | 从 `window._courseHelperQuestionBank` 或本地积累题库查答案 |
| `llmAnswerSource(config)` | 远程 LLM / API 源（占位） |

优先级：`window._courseHelperAnswerSource` > 本地积累题库 + `window._courseHelperQuestionBank` > 默认兜底。

### 如何提高正确率

1. **做题后自动积累（最轻量）**：开启"自动提交"，脚本提交后会读取页面上的正确答案并存入 `localStorage`。下次遇到同一道题自动使用正确答案。
2. **注入外部题库**：

```javascript
window._courseHelperQuestionBank = {
  "题目文本": { type: "index", index: 2 },
  "填空题文本": { type: "text", value: "答案" }
};
```

3. **自定义答案源**：

```javascript
window._courseHelperAnswerSource = {
  name: "my-source",
  getAnswer: function (question) {
    // question = { text, platform, type, el }
    return { type: "unknown" };
  }
};
```

4. **修改源码**：扩展 `questionBankSource` 或 `llmAnswerSource`，接入本地/远程题库 API。

## 修改流程

1. 编辑 `course-helper.user.js`
2. 运行 `node --check course-helper.user.js` 做语法检查
3. 更新版本号（`// @version`）
4. 更新 `CHANGELOG.md`（新增一节）
5. 更新 `README.md`（如功能或声明有变）
6. `git add -A && git commit -m "feat: ..."`
7. `git push origin main`

## 浏览器安装/更新脚本

油猴脚本通过浏览器脚本管理器运行。可以使用 `kimi-webbridge` 技能帮助用户：

1. 打开浏览器扩展商店安装 Tampermonkey 或 脚本猫
2. 访问脚本 Raw 链接：https://raw.githubusercontent.com/1016149993-a11y/course-helper/main/course-helper.user.js
3. 脚本管理器会自动提示安装/更新
4. 刷新网课页面，右下角出现 ⚡ 按钮即生效

## 常见任务

### 用户说"完善自动答题"

通常意味着：
1. 增强题目页检测（扩展 `QUIZ_SELECTORS`）
2. 优化 `isQuizDone()` 判断逻辑
3. 扩展 `answerChaoxing` / `answerUlearning` / `answerUnipus` 支持更多题型
4. 接入题库或外部答案源
5. 优化提交按钮选择器（`maybeSubmit`）

### 用户说"发布新版本"

1. 改 `course-helper.user.js` 里的 `// @version`
2. 在 `CHANGELOG.md` 顶部新增版本节
3. commit + push
4. 如用到 CDN（jsDelivr），缓存可能需要几分钟刷新

## 注意事项

- 脚本默认不开启自动答题/自动提交，用户必须在面板手动勾选
- 自动答题属于辅助刷题行为，存在被平台判定为异常的风险，README/CHANGELOG 中需保留风险提示
- 所有 `localStorage` 访问必须包在 `try/catch` 中，防止沙盒 iframe 抛 `SecurityError`
- 修改时保持 ES5 风格，避免箭头函数/`let`/`const`，确保脚本在油猴环境中兼容
