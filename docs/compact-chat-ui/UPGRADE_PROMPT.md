# 升级提示词：给 dsh-compact-lane 加上「工具图标配色」

用法：在 `dsh-compact-lane` 仓库根目录启动 Agent，把下面围栏里的内容整段贴给它。参考资料（Vela 仓库里的 `docs/compact-chat-ui/`）按绝对路径只读引用，不需要复制进插件仓库；路径不同时替换 `<...>`。

这次升级对应 Vela 的一次改动：紧凑模式最左侧的图标原来全是灰色，现在按种类着色，设置里有开关，「思考」前新增灯泡图标。规格见参考 README 的 5.11。

````text
任务：把 Vela 新增的「紧凑模式图标配色」同步到本仓库（dsh-compact-lane）：每类工具行的最左侧图标按种类着色，「思考」标题前增加灯泡图标，并在插件设置页里增加开关。默认开启，关闭后所有图标回到统一灰色，视觉与升级前一致。

## 参考资料（只读，不要修改）

位于 </Users/chenkaigao/Documents/Program/VelaHarness/docs/compact-chat-ui/>：

- README.md：先读 5.11「图标配色」，再看 3.2（`--tool-icon-*` 变量）、6.2（思考块）、7（偏好）、8.2（选择器范围的坑）。
- compact-chat-ui.html：可直接在浏览器打开的参考页。顶部「工具图标配色」复选框可以对比开/关；`<style id="vela-extracted">` 里搜 `tool-icon-` 和 `thinking-icon` 就是这次新增的全部样式，是视觉验收的基准。
- src/app.js：参考页的渲染逻辑，搜 `thinking` 看灯泡图标和 `Thinking` 的 DOM 结构。

## 这次要做的事

1. **样式**：重新生成 `src/styles/vela-compact.css`：

   ```sh
   node scripts/extract-styles.mjs </Users/chenkaigao/Documents/Program/VelaHarness/docs/compact-chat-ui/compact-chat-ui.html>
   ```

   先看 `git diff src/styles/vela-compact.css`，确认新增的只有图标配色相关规则（`--tool-icon-*` 变量、`data-tool-icon-color` 规则、`.thinking-icon`）；除此之外的 diff 逐条判断是不是这次升级之外 Vela 本身的改动，列在方案里。

   **提取脚本需要先改**：新规则的选择器形如 `:root[data-tool-icon-color="true"] .tool-compact-icon`。当前 `scripts/extract-styles.mjs` 只把整条等于 `:root` 或 `[data-scheme="light"]` 的选择器映射到插件根，其余一律加前缀 `[data-dsh-compact-lane] `，会得到永远匹配不到的 `[data-dsh-compact-lane] :root[...] …`。需要把以 `:root[属性]` 开头的选择器改写成 `[data-dsh-compact-lane][属性] …`（属性放在插件根自身上）。同时检查 `[data-scheme="dark"]` 里的 `--tool-icon-*` 暗色变量被加了前缀后是否无害（插件只做浅色，不生效即可）。改完脚本后重跑，用 grep 确认生成的 CSS 里没有 `:root`。

2. **图标配色开关接到插件根**：`src/ui/lane.tsx` 的根元素 `[data-dsh-compact-lane]` 增加 `data-tool-icon-color="true|false"`，值来自设置，通过 context 下发（参考现有 `FoldModeContext` / `src/ui/fold.ts` 的做法，不要层层传 props）。

3. **设置**：参照 `foldMode` 的全链路（`src/settings.ts` 的类型与 `normalize…`、`src/index.ts` 的 `Config` schema 与 `.volatile()`、`src/client.tsx` 里读取配置表单快照与 `form.set` 的部分、`src/ui/settings.tsx` 的设置页），新增布尔设置 `iconColor`：
   - 默认 `true`；缺失或非法值按 `true` 处理；
   - 设置页「紧凑对话」下新增一行，标题「工具图标配色」，说明「开启后，每类工具调用的左侧图标使用各自的颜色；关闭则统一为灰色。」，用与 `foldMode` 同样的 `SegmentedControl`（选项「关闭 / 开启」），保存失败的提示与 `foldMode` 共用；
   - 修改立即作用于已打开的对话，不需要刷新（与 foldMode 一致）；
   - 仍然只在配置档里持久化；通过 `--patch` 叠加层加载时无法保存的行为保持不变。

4. **「思考」图标**：`src/ui/turn.tsx` 的 `Thinking` 里，在 `<span>思考</span>`（含「思考中」状态）前加 `<span className="thinking-icon" aria-hidden="true">`，内放灯泡图标。在 `src/ui/primitives.tsx` 的图标表里加 `thinking`，路径取参考页 `ICON.thinking`（`M9 18h6M10 21.5h4` 加灯泡外廓 `M12 2.5a6.5 6.5 0 0 0-3.7 11.85c.45.32.7.8.7 1.35V16h6v-.3c0-.55.25-1.03.7-1.35A6.5 6.5 0 0 0 12 2.5Z`，24×24 视口，13px）。`.thinking-icon` 的显示/隐藏、尺寸、颜色全在 CSS 里，组件不要判断模式。

5. **图标类名对齐**：检查各图标的外层元素与参考 5.11 的「命中的元素」一列一致：
   - 命令/读取/编辑/写入的行：`.tool-kind-<kind>` 内的 `.tool-compact-icon`；
   - 混合摘要：`.tool-compact-group.tool-kind-other` 的摘要按钮里的 `.tool-compact-icon`（混合时用 `stack` 图标）；
   - 子代理：`.agent-compact` 里的 `.tool-compact-icon`；
   - 其他工具/执行清单：`.tool-card-list.is-compact` 里的 `.tool-card-icon`。
   插件没有 MCP 卡片和提问卡，对应的 `is-mcp`、`.question-compact-icon` 规则不用处理，保留在生成的 CSS 里即可。

## 必须遵守的细节

- 配色只改 `color`，不加背景；图标保持 16×16。失败和运行中仍由状态位表达，图标颜色不随状态变。
- **混合摘要的图标规则用子代选择器**（`.tool-compact-group.tool-kind-other > .tool-compact-summary .tool-compact-icon`）。如果被写成后代选择器，展开后的逐行明细图标会全部被染成摘要的靛蓝。验收时展开一个「读取 + 命令」的混合摘要，逐行确认各自的颜色。
- 生成的 CSS 是检出物，不要手改 `src/styles/vela-compact.css`；需要调整就改提取脚本或 `src/styles/host.css`。
- 不要改动工具与消息的适配层（`src/adapter/`）、滚动逻辑、折叠逻辑。`foldMode` 的现有行为和测试必须保持通过。
- 不要升版本号，不要提交，不要推送。

## 验证

先跑 `pnpm typecheck`、`pnpm test`、`pnpm build`，都要通过。然后补测试，至少覆盖：

- 设置：`iconColor` 的 normalize（缺失、非法值、`false`）；Config schema 默认值为 `true`；
- 开关：`iconColor` 为 `true` / `false` 时根元素的 `data-tool-icon-color` 属性；修改设置后已挂载的对话立即更新；
- 思考：渲染的「思考」「思考中」标题前都有 `.thinking-icon`。

jsdom 不计算样式，颜色必须在真实浏览器里验证：运行 `pnpm replay`（或 `pnpm preview`），打开示例对话，在浏览器里用 `getComputedStyle` 读取各图标颜色，浅色下应为：

| 图标 | 颜色 |
| --- | --- |
| 命令 | `#7c5cd6` |
| 读取 | `#0f8a8a` |
| 编辑 | `#c2710c` |
| 写入 | `#1f9d55` |
| 混合摘要 | `#5b6fd6` |
| 子代理 | `#b43fc7` |
| 其他工具 / 执行清单 | `#e0603c` |
| 思考 | `#84a10d` |

把开关关掉后，上表所有图标应变为 `--text-muted`（`#686d75`）。同时对比参考页的同一位置，截图留档。无法验证的部分（例如没有触发子代理的会话）如实说明。

## 收尾

- `README.md` 与 `README.zh-CN.md` 的「What changes / 带来哪些变化」里各补一句图标配色，以及设置页里可以关闭；
- `VALIDATION.md` 追加本次实际执行过的检查和未覆盖项，只写真的跑过的；
- 最后给我一份改动清单：改了哪些文件、提取脚本改了什么、`vela-compact.css` 的 diff 里有没有这次升级之外的变化、验证了什么、没验证什么。
````
