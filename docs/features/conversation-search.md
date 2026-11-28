# 对话全文搜索

侧边栏的搜索框（搜索会话）除了匹配标题和工作区路径，还会搜索所有对话的消息正文、工具调用与工具输出，包括已归档的对话。可以按项目、日期筛选，点击命中项会打开对应对话并滚动到那条消息。

## 使用方式

- 输入关键词，会话标题命中的结果立即出现在「会话」区；消息命中的结果在「消息」区随检索进度陆续出现，最新的消息在前，不需要等检索结束。
- 多个关键词用空格分隔，必须全部出现；用双引号包住的内容作为一个关键词，例如 `"npm ERR!"`。匹配不区分大小写，任意长度不少于 3 个字符的片段都能命中（中文、命令、路径同样适用），不要求是完整的词。
- 筛选条：项目（含「无项目」）、日期（过去 24 小时 / 7 / 30 / 90 天或自定义起止日期）、「工具输出」与「已归档」两个开关，默认都开启。
- 命中数量较多时每次显示 50 条，「显示更多结果」继续向更早的消息检索。
- 打开命中项：滚动到那条消息并高亮命中文字（每次高亮保留约 6 秒）。命中的是工具调用或工具输出时，滚动到发起该调用的消息；折叠的内容不会被展开，也就没有文字高亮。
- 命中已归档对话时，先把它恢复到侧边栏再打开，并沿用恢复时的提示。
- 首次使用或有大量新内容时，索引仍在后台建立，列表底部会提示「正在建立索引，结果可能不完整」；索引追上后，正在进行的搜索会自动再查一次。

## 索引

- 位置：`<home>/search-index.sqlite`（含 `-wal`、`-shm`），是会话文件的缓存，可以随时删除，下次搜索会重建。在存储概览里计入「其他」。
- 内容：用户消息、助手回复正文、每次工具调用的命令或参数（最多 2000 字符），以及工具输出（保留开头 6000 与结尾 2000 字符；`read` 只保留开头 2000 字符）。不索引思考内容、图片和 MCP 工具的调用与结果（它们在界面上要经过脱敏，原文不进入索引），也不索引常驻助手等被隐藏的对话。
- 存储：SQLite FTS5，分词器为 `trigram`，所以不需要分词，中文也按子串匹配。不足 3 个字符的关键词无法使用索引，改为在时间窗口里逐行扫描，仍然分片、可取消。
- 行 id 就是时间：`秒 × 2^20 + 序号`。按 id 倒序读取就是按时间从新到旧，无需排序；日期筛选是 id 范围；翻页用上一页最后一条的 id 作游标。
- 增量：会话文件只追加，索引记录每个文件已读到的字节偏移和偏移前 64 字节的指纹，之后只读新增部分，只处理完整的行。文件被缩短或前缀对不上时，该对话从头重建。已不在列表中的对话和已不存在的文件，会在下次同步时清掉。标题、归档状态的变化只更新元数据，不重读文件。
- 同步时机：应用启动约 10 秒后一次，之后每次打开搜索框一次。最近更新的对话先索引。
- 数据库结构版本（`PRAGMA user_version`）不一致或文件损坏时，直接删除重建。

## 进程与性能

- 索引和检索都在单独的 utility 进程（`search-worker`）里，主进程不碰数据库；进程崩溃后，下一次同步或搜索会重新拉起。
- 工作进程里的所有任务都切成几毫秒的小片：索引每片最多约 200 KB 文本或 40 ms，检索每片按时间窗口取最多 20 条命中。片与片之间让出事件循环，所以新的按键、取消能立刻被处理；检索优先于索引。
- 每一片的命中立刻推送给发起搜索的窗口，渲染层逐批追加；新搜索开始时，上一次的结果保留到新结果的第一批到达，避免闪烁。输入后 80 ms 才发起搜索。
- 时间窗口根据上一片的耗时自适应：过慢就缩小，没有命中就放大。
- 在约 345 MB 的真实会话上（522 个对话）：首次建立索引约 7 秒，数据库约 200 MB；常见查询的第一批命中在几毫秒内返回，最慢的一片约 20 ms。

## 实现位置

| 位置 | 作用 |
| --- | --- |
| `packages/shared/src/conversation-search.ts` | IPC 通道、请求/命中/事件类型，`parseSearchQuery`、`snippetSegments`。 |
| `apps/desktop/src/main/search-extract.ts` 的 `extractRows` | 会话文件的一行 → 索引行。 |
| `apps/desktop/src/main/search-index.ts` 的 `SearchIndex`、`SearchRun` | 索引、增量读取、分片检索与摘要。无 Electron 依赖。 |
| `apps/desktop/src/main/search-service.ts` 的 `SearchWorkerCore` | 工作进程里的调度：检索优先、索引让位、状态节流。 |
| `apps/desktop/src/main/search-worker.ts` | utility 进程入口。 |
| `apps/desktop/src/main/search-host.ts`、`search-request.ts` | 主进程：拉起进程、校验请求、把命中推给发起窗口。 |
| `packages/agent/src/runtime.ts` 的 `listSearchSources` | 提供要索引的对话（会话文件路径、标题、归档状态）。 |
| `packages/agent/src/transcript.ts` | 界面消息带上 `entryId`，供命中项定位。 |
| `apps/desktop/src/renderer/hooks/useConversationSearch.ts` | 渲染层：流式接收、取消、翻页、索引追上后重查。 |
| `apps/desktop/src/renderer/components/ConversationSearchDialog.tsx`、`conversation-search.ts` | 搜索框、筛选、标题匹配。 |
| `apps/desktop/src/renderer/components/search-jump.ts`、`useSearchJumpScroll.ts`、`search-highlight.ts` | 跳转：定位消息、滚动、高亮。 |

跳转用会话条目 id 定位消息。本次运行中产生的消息没有条目 id，`useSession` 的 `hydrateEntryIds` 会在跳转前把磁盘上的消息按顺序对应回去（`alignEntryIds`）。

## 验证

```bash
node --import ../../packages/agent/test/register-ts.mjs --experimental-transform-types --test \
  test/search-extract.test.ts test/search-index.test.ts test/search-service.test.ts \
  test/search-request.test.ts test/search-jump.test.ts test/conversation-search.test.ts   # 在 apps/desktop 下
pnpm build && pnpm --filter @vela/desktop test:search:electron   # 真实 Electron：工作进程、筛选、跳转、归档恢复
```

## 已知限制

- 已被回退、不在当前分支上的消息也在索引里；命中它们时只能打开对话，找不到对应消息就不滚动。
- 工具输出只保留头尾；`read` 的文件内容基本不可搜索。
- 不足 3 个字符的关键词按扫描匹配，罕见的两字关键词在大索引上要扫描很久（仍然分片、可取消），大小写只对 ASCII 不敏感。
- 子代理的对话记录没有进入索引。
- 命中折叠的工具卡片时只滚动到所在消息，不展开卡片。
