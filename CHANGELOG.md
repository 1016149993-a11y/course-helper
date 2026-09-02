# 更新日志

本项目的所有重要变更将记录在此文件中。
格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.3.0] - 2026-09-02

### 新增

- **自动下一章节（连播）**：面板新增开关，默认关闭；视频正常播完（`ended` 事件）3 秒后自动进入下一章节
  - 当前章节定位：优先按页面 URL 匹配章节链接，其次按菜单项的 active/current/selected 高亮样式
  - 边界处理：定位不到当前章节时不跳转；最后一节提示；入口失效提示手动切换

### 变更

- README 增加连播功能说明及高倍速 + 连播的风险提示

## [0.2.3] - 2026-09-02

### 新增

- **框架绑定菜单识别**（针对优学院 / U学院 等 Knockout SPA）：扫描 `data-bind="text: ..."` 文本节点，
  向上查找 `data-bind` 含 `click:` 的可点击祖先容器，点击时模拟原生 `click()`
- 同一点击容器只收录一次，避免多个绑定节点重复入列

## [0.2.2] - 2026-09-02

### 新增

- **JS 驱动章节菜单识别**：`javascript:;` / `#` / 无 href 的菜单按文本特征识别
  （第X章 / 第X节 / 第X单元 / Unit X / Chapter / Lesson 等），点击时模拟原生点击
- 章节扫描扩展到**同源 iframe**（含嵌套）
- 顶层无面板时，包含视频或章节菜单的 iframe 帧可自建面板（带去重保护）

### 变更

- 章节列表上限从 50 提升到 80

## [0.2.1] - 2026-09-02

### 修复

- **平台倍速被覆盖**：主循环不再无条件强制应用倍速；只有用户在面板中主动选择过倍速后才干预，
  保留平台自带倍速控制
- **沙盒 iframe 崩溃**：`localStorage` 访问（`savedSpeed` / `hasUserSpeed` / 倍速按钮写入）
  全部加 try/catch 保护，避免独立源 iframe 抛 `SecurityError` 导致功能失效

### 变更

- 倍速按钮高亮以「用户已主动选择过倍速」为前提

## [0.2.0] - 2026-09-02

### 新增

- **脚本猫（ScriptCat）支持**：补齐 `@author` / `@license` / `@homepageURL` / `@supportURL`
  元数据；添加 `@updateURL` / `@downloadURL` 指向 GitHub Raw，Tampermonkey 与脚本猫均可自动更新
- **倍速扩展至 16x**：档位新增 3x / 4x / 8x / 16x

### 变更

- README 更新安装说明（Tampermonkey / 脚本猫双通道）

## [0.1.0] - 2026-09-02

### 新增

- 首个版本：倍速播放（0.5x ~ 2x）、记忆播放位置（localStorage 续播）、章节跳转（通用链接扫描）
- 右下角 ⚡ 悬浮面板，适配学习通 / WeLearn（U校园）/ ULearning
