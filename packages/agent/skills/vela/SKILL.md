---
name: vela
description: Answer questions about how to use, configure or customize the Vela desktop app itself, such as changing the interface colors or theme, fonts, language, layout, shortcuts, models, permissions, skills, notifications, updates or where Vela stores its data. Use it whenever the user asks "how do I … in Vela" or wants a Vela setting changed.
---

# Vela app guide

Use this skill when the question is about Vela the application, not about the user's project. Read it, then answer from it.

## How to answer

- Reply in the language the user wrote in. Use the interface names of that language; both are listed below.
- Give a short click path first (for example "Settings → Appearance → Theme"), then one or two sentences on what to pick. Do not paste this document back.
- Vela settings are changed in the app's Settings window; there is no config file to edit for them. Do not edit Vela's own files, the application bundle or `~/.vela*` to change a setting, and do not offer to.
- You cannot click inside the app's Settings for the user. Tell them where to go. If a setting is not covered here, say you are not sure instead of inventing a menu or option.
- If what the user wants is not a setting at all (for example a color for one specific component), say so plainly and name the closest setting.

## Opening Settings

- Press `⌘,` (Mod+,) to open or close Settings, or use the Settings button in the navigation bar.
- Settings has a search box at the top; typing a word such as "theme", "主题" or "font" jumps to the matching option.

## Settings map

| English | 中文 | What it holds |
| --- | --- | --- |
| Appearance | 外观 | Color mode, theme and custom colors, fonts, font sizes, file icons |
| Interface | 界面 | Language, sound effects, link and preview behavior, navigation layout, sidebar items, start page |
| Notifications | 通知 | Alerts for approvals and other items when you are away from a conversation |
| Shortcuts | 快捷键 | The keyboard shortcuts that work today |
| About & updates | 关于与更新 | Version, checking for updates, automatic updates |
| Defaults & permissions | 默认与权限 | Default model, thinking level, extra instructions and execution permissions for new conversations |
| Approval records | 审批记录 | What "Always allow" and "Always deny" remembered |
| Subagent models | 子代理模型 | Which models subagents may use |
| Conversation display | 对话显示 | How tool calls and thinking summaries appear |
| Skills | Skills | Enable, disable, add and delete skills |
| Models & accounts | 模型与账号 | Model providers, accounts and API keys |
| Integrations | 集成 | Connected workspace apps |
| MCP servers | MCP 服务器 | External tools |
| Hooks | Hooks | Native commands at session, tool and commit boundaries |
| Web tools | 网页工具 | Providers and keys for web search and fetch |
| Memory | 记忆 | The agent's long-term memory |
| Workspace | 工作区 | Current workspace, recent folders, execution environment |
| Archived chats | 已归档对话 | Bring archived conversations back |
| Usage statistics | 使用统计 | Model requests and token usage |
| Storage | 存储 | Disk space, cleanup, file checkpoints |
| Logs & diagnostics | 日志与诊断 | Log level, location, diagnostics export |

## Changing the interface colors

Everything color-related is in **Settings → Appearance** (设置 → 外观), under the **Colors** (配色) group.

1. **Color mode** (明暗模式): System (跟随系统), Light (浅色) or Dark (深色). With System, Vela switches between the chosen light and dark theme as the OS appearance changes.
2. **Theme** (主题): pick one light theme and one dark theme.
   - Light themes (浅色主题): Daylight 晴空 (white and blue), Paper 宣纸 (warm cream and terracotta), Celadon 青瓷 (pale jade and teal), Lilac 丁香 (violet mist), Blossom 海棠 (blush pink and crabapple red).
   - Dark themes (深色主题): Dark 深色 (neutral gray and blue), Graphite 石墨 (near-black and lavender), Ember 余烬 (warm charcoal and orange), Forest 森林 (deep green and mint), Tide 潮汐 (deep teal and cyan).
   - Picking a theme of the other brightness also switches the color mode to that brightness when the mode is fixed to the other one, so the change is visible at once.
3. **Custom theme**: in each theme group, **New theme** (新建主题) lets the user mix four colors: Background (背景), Cards & panels (卡片与面板), Text (文字) and Accent (强调色). The editor starts from the currently selected theme, shows a warning when the text and background contrast is too low, and **Save and use** (保存并使用) applies it. Existing custom themes can be edited or deleted. At most 12 custom themes can be kept.
4. **Random theme** (随机主题): opens the same editor with a readable random palette; shuffle until it looks right, then save.

Typical questions:

- "Make the interface dark" → Color mode → Dark (or System to follow the OS).
- "Change the accent / highlight color" → create a custom theme and change **Accent**; no built-in option changes only the accent.
- "Make the background warmer" → try Paper (light) or Ember (dark), or a custom theme with a warm Background.
- "Different colors for light and dark" → pick a different theme in each group and set Color mode to System.

Colors cannot be set per component or with custom CSS.

## Fonts, sizes and icons

All under **Settings → Appearance**, in the text and icons group (文字与图标):

- **File icons** (文件图标): the icon style in file previews and tool calls (Pierre, Material, Devicon, Catppuccin).
- **Interface font** (界面字体) and **Reply font** (回复字体): sans-serif or serif; the reply font can follow the interface font.
- **Interface font size** (界面字号, 11–15 px, default 15) and **Code font size** (代码字号, 8–24 px, default 15).

## Interface and language

**Settings → Interface** (设置 → 界面) holds the app language, sound effects, how conversation links and file previews open, the navigation layout (Classic 经典 or Categories 分类), the right-hand info layout, which sidebar tabs show, and the start page.

## Skills

**Settings → Skills** lists every skill the agent can use. Skills can be turned off there, and a skill that is turned off is invisible to the agent. User skills live in the `skills` folder of Vela's data directory; the page has a button that opens it. Vela's own built-in skills, including this one, can be turned off but not deleted.

## Data locations

- Release builds keep their data in `~/.vela`; development builds use `~/.vela-dev`.
- Update logs are in `~/.vela/updates/installer.log`.
- Disk usage and cleanup are in Settings → Storage; diagnostics export is in Settings → Logs & diagnostics.

## Updates

Settings → About & updates (设置 → 关于与更新) shows the current version and has Check for updates (检查更新). Vela downloads the update, asks for a restart, then upgrades in place.
