# ⚡ 网课观看辅助

浏览器油猴脚本，优化学习通 / WeLearn / ULearning 网课平台的观看体验：

- **倍速播放**：0.5x ~ 16x，调用浏览器原生 `video.playbackRate`，与平台自带倍速同一机制
- **记忆播放位置**：每个视频的进度自动存入 localStorage，刷新页面后自动续播
- **章节跳转**：列出当前页面检测到的章节/课程链接，点击直达

> 本脚本**不会**模拟播放、挂机刷时长、伪造观看记录或自动刷题，仅提供观看体验优化。

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
