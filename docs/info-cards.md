# 信息卡片模式

「信息卡片」是信息面板的第三种布局（设置 → 界面 → 信息布局，另两种是「侧栏」和「浮动」）。右侧一列卡片直接浮在对话上，没有边栏；卡片可以拖动排序、折叠和隐藏。设计稿见 [design/right-rail-cards.html](./design/right-rail-cards.html)。

## 卡片

| 卡片 | 内容 | 何时显示 |
| --- | --- | --- |
| 环境 | 工作区、分支（可切换）、PR | 有项目时 |
| 目标 | 当前目标与状态，可恢复 | 存在目标时 |
| 计划 | 计划文档引用和待办进度 | 有计划或待办时 |
| 上下文 | 上下文用量 | 有用量数据时（默认折叠） |
| 产出 | 本对话里 `write` 工具写出的文件，最近的在前，最多 20 个 | 有写入时 |
| 变更 | 工作区 git 变更统计和 PR 入口；点击统计数字区域在右侧面板打开「变更」标签页，不列出具体文件 | 有变更时 |
| 子代理 | 子代理及运行状态 | 有子代理时 |
| 工具 | 已启用的工具 | 默认隐藏，可从「添加卡片」找回 |

没有数据的卡片不显示，也不会出现在「添加卡片」托盘里。

## 交互

- 拖动卡片右上角的六点手柄排序；键盘上聚焦手柄后按 Space 抓起，↑/↓ 移动，Space 放下，Esc 取消，过程由 aria-live 播报。
- 点击卡片标题折叠或展开；折叠后只剩一行摘要。
- 悬停卡片时右上角出现「隐藏」；隐藏的卡片从「添加卡片 · n」托盘找回，找回的卡片放在列表末尾；托盘里还有「恢复默认布局」。
- 卡片栈超出可用高度时在栈内滚动，底部渐隐提示；它避开输入框，不会盖住它。
- 对话区会按卡片栈的左边缘让出空间，逻辑与「浮动」布局共用（`ChatView` 的 `planChatLane`）。
- 尊重 `prefers-reduced-motion`：关闭位移动画。

## 存储

布局保存在 localStorage 的 `vela.infoCards`：`{ order, hidden, collapsed }`。读取时由 `sanitizeLayout` 丢弃未知或重复的 id，新版本新增的卡片补到末尾（默认隐藏的保持隐藏），所以升级不会损坏旧布局。

## 实现位置

- `apps/desktop/src/renderer/components/info-cards/`：`info-cards-layout.ts`（纯函数布局逻辑）、`info-cards-data.ts`（产出与待办进度）、`InfoCardContents.tsx`（各卡片内容）、`InfoCardStack.tsx`（栈、拖动、托盘）。
- `apps/desktop/src/renderer/info-cards.css`：样式。
- 偏好 `infoLayout` 取值 `"sidebar" | "floating" | "cards"`，见 `hooks/usePreferences.ts`。

## 验证

```bash
pnpm --filter @vela/desktop test         # 含 info-cards-layout.test.ts
```

`apps/desktop/test/info-cards-preview.tsx` 是用于浏览器里手动检查的夹具（`?layout=cards`，`?reset` 清空布局，`?agents` 显示子代理卡片）。
