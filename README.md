# ⚡ 网课观看辅助

浏览器油猴脚本，优化学习通 / WeLearn / ULearning 网课平台的观看与做题体验：

- **倍速播放**：0.5x ~ 16x，调用浏览器原生 `video.playbackRate`，与平台自带倍速同一机制
- **记忆播放位置**：每个视频的进度自动存入 localStorage，刷新页面后自动续播
- **章节跳转**：列出当前页面检测到的章节/课程链接，点击直达（支持普通链接与框架渲染的 JS 菜单）
- **自动下一章节（连播）**：默认关闭，需在面板手动勾选；开启后每 3 秒自动推进——未播完的视频自动续播、本页看完或无视频页面自动进入下一页、弹窗自动关闭
- **自动答题**：默认关闭，需在面板手动勾选；开启后遇到题目页自动选择占位答案，配合“自动提交”可自动完成答题并继续推进

> 自动答题当前为基础框架，默认按“选择首个选项 / 填空填占位符”处理，正确率取决于平台与题型。如需高正确率，请自行接入题库或扩展各平台 `answerXxx` 函数。高倍速 + 连播 + 自动答题可能被平台判定为异常，风险自担。

## 更新日志

见 [CHANGELOG.md](CHANGELOG.md)。

## 安装

支持 **Tampermonkey** 和 **脚本猫（ScriptCat）** 两种脚本管理器，任选其一：

### 方式一：Tampermonkey

1. 浏览器安装 [Tampermonkey](https://www.tampermonkey.net/)（Chrome / Edge 扩展商店均可）
2. 打开 [course-helper.user.js](course-helper.user.js) 原始文件，Tampermonkey 会提示安装；或手动新建脚本后粘贴保存

### 方式二：脚本猫（ScriptCat）

1. 浏览器安装 [脚本猫 ScriptCat](https://github.com/scriptscat/scriptcat)（Chrome / Edge / Firefox 扩展商店均有；MV3 浏览器上如无法运行，需在扩展管理中开启「允许用户脚本」或开发者模式）
2. 打开 [course-helper.user.js](course-helper.user.js) 原始文件（Raw 链接），脚本猫会提示安装；或在脚本猫面板中新建脚本后粘贴保存

3. 打开网课页面，右下角出现 ⚡ 按钮即生效

> 脚本已内置 `@updateURL` / `@downloadURL`（指向本仓库 Raw 文件），两种管理器都会自动检查更新。

## 支持平台

| 平台 | 域名 |
|---|---|
| 学习通 (Chaoxing) | `*.chaoxing.com` |
| WeLearn / U校园 | `*.unipus.cn` |
| ULearning | `*.ulearning.cn` / `*.ulearning.com.cn` |

## 使用提示

- 页面右下角 ⚡ 按钮打开/收起面板
- 倍速档位：0.5x / 1x / 1.25x / 1.5x / 1.75x / 2x / 3x / 4x / 8x / 16x
- 高倍速（4x 以上）会明显跳帧，且可能被平台判定为异常观看或超出视频解码能力，建议按需使用
- 章节列表为通用链接扫描，个别平台的目录结构特殊时可能列不全
- **自动答题**：默认关闭；开启后脚本会自动选择每道题的第一个可见选项，并自动提交（需同时开启“自动提交”）。当前未内置题库，正确率有限，适合快速刷过不计分或允许重做的任务
