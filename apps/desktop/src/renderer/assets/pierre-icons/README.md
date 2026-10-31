# Pierre 文件图标

这些 SVG 来自 [pierrecomputer/vscode-icons](https://github.com/pierrecomputer/vscode-icons)（npm 包 `@pierre/vscode-icons` 0.0.9）的 Complete 档，按 MIT 许可证使用；完整许可证见同目录 `LICENSE`。

- 配色：Pierre 色板，暗色取 400；亮色取 600 后由脚本提亮饱和度（见 `vivid`），避免白底上发脏。暗色把 20%–40% 透明度的淡底再调低到约 40%（见 `softenTile`），避免混成暗褐。语言、框架和工具图标沿用上游 `theme-complete`；上游仍为灰色的图片、Markdown、JSON、表格、压缩包、数据库、字体、stylelint、Shell、Next.js 由脚本补色（见 `extraHues`），仅未识别文件的通用图标保持灰色。
- 每个图标有 `<name>.svg`（暗色）和 `<name>-light.svg`（亮色）两份，由上游源 SVG 把 `currentColor` 替换成色值生成，路径未作修改，随应用离线打包。
- 文件名与扩展名映射在 `components/pierre-file-icons.ts`，同样由脚本生成。

更新：用 `npm pack @pierre/vscode-icons@<版本>` 解开后运行 `node scripts/sync-pierre-icons.mjs <解压目录>`，再核对本文件中的版本号。
