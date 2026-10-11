# 成果驗收面板

一輪工作完成後，回覆下方的「驗收」入口會顯示通過的需求數與待確認事項數。點擊後在右側 Workbench 開啟驗收分頁，逐項檢視需求、修改、驗證證據與待確認事項。

## 使用方式

- 左側選擇需求，右側顯示 agent 提交的完成狀態；`done` 代表 agent 的完成聲明。只有沒有待確認事項、且所有證據均通過並未過期的需求，才計入入口的「通過」數。
- 點擊可審查的修改，開啟該輪 `turn-review` 分頁並定位到檔案／編輯。沒有工具 diff 的檔案會列為待確認。
- 點擊驗證證據，在面板內透過 `BashView` 顯示記錄的完整指令與輸出。失敗的證據預設展開。驗證後又有成功的 `edit`／`write`，會標記結果可能已過期。
- 未歸屬的修改與驗證仍會顯示，不會因 agent 遺漏而消失。

分頁狀態只保存在記憶體，依 workspace 與 conversation 隔離；重新載入後，可從回覆的驗收入口再次開啟。

## 事實與歸屬

`packages/shared/src/outcome.ts` 的 `buildTurnOutcome` 是 renderer 與 agent 共用的純函式。agent 透過 `submit_outcome` 提交 `OutcomeSubmission`，每條需求列出完成狀態、修改檔案、已完成的 bash `toolCallId` 及待確認事項。修改統計、diff 來源、驗證結果、退出碼與過期狀態，全部由本輪工具記錄確定性推導。

執行期拒絕不存在於本輪完成記錄中的檔案與 bash ID，回傳 `ok: false` 讓 agent 修正。renderer 再次核對引用；即使舊 transcript 含有假引用，也會丟棄並加入待確認，不會產生虛構證據。失敗的 `submit_outcome` 不會被採用。

`ToolActivity.outcome` 隨工具呼叫保存在既有 session JSONL，live 事件與 transcript 恢復共用 `activityFromCall`。不增加 IPC、主進程資料存儲或額外模型呼叫。`plan` 模式不提供此工具；`agent` 與 `goal` 模式提供。`goal` 模式先提交 `record_goal_validation`，再提交驗收歸屬。

未提交時，面板把本輪使用者訊息與所有修改／可辨識的驗證組成一個 `source: derived` 項目，保守標記為 `partial`。沒有修改、沒有驗證、沒有提交的純問答，不顯示入口。

## 邊界

- 完成狀態與需求拆分由 agent 提交，面板不自行推斷每條需求已完成，也不增加 Goal 完成閘門。
- bash 的成敗、退出碼與過期判斷沿用 handoff 規則。一般 bash 只有被明確歸屬時才作為 `other` 證據；降級只自動辨識 test、build、typecheck 與 lint。
- 資料推導支援 `changedFiles`，`outcomeByFinalMessage` 支援依最後回覆 ID 傳入 `changedFilesByTurn`。目前聊天接線使用工具記錄，尚未消費 checkpoint IPC，因此 bash／子代理直接造成的磁碟修改可能不會出現在入口。接入時可沿用既有 `getCheckpoints`，無須新增通道。
- 工具 diff 與 bash 輸出是當時記錄；截斷的原始記錄無法還原成完整內容。面板不新增聊天工具錨點。

## 驗證

`pnpm --filter @vela/desktop test:outcome` 覆蓋歸屬、虛構引用、stale／failed／no-evidence／no-diff／unattributed、fallback、解析與上限。`apps/desktop/test/outcome-stream.test.ts` 覆蓋 renderer live 事件清理、增量合併及 transcript 重載，避免結構化歸屬被丟棄。`packages/agent/test/outcome-tool.test.ts` 覆蓋模式、提示詞、工具、runtime 驗證與 activity 恢復。`apps/desktop/test/acceptance-ui.mjs` 使用真實 Electron 驗證入口、分頁、diff 定位與內嵌失敗輸出，納入 `pnpm test:ui`。

目視預覽為 `apps/desktop/test/acceptance-preview.html`；使用 `pnpm --filter @vela/desktop test:trace:preview` 啟動本機預覽服務，再開啟 `/test/acceptance-preview.html`。完整單元與型別檢查使用 `pnpm test`。

## 本次實作驗收紀錄

- `pnpm test` 通過所有 workspace 型別檢查與 1,593 項單元測試。
- `pnpm test:ui` 執行 9 個套件，其中 8 個通過；新增的 `acceptance-ui` 通過。既有 `mcp-settings-ui` 在傳入舊語言代碼 `zh` 後等待 `MCP 服务器` 標題逾時，未修改這個無關測試。
- `pnpm dev` 中使用實際模型寫入 `/tmp` 測試檔並執行 `node --test`。第一次提交假 verification ID 被 runtime 拒絕；使用真實 ID 重試成功。重載後需求歸屬仍存在，修改連結開啟真實 diff，證據展開顯示完整測試輸出。
- 實際模型為取得 toolCallId 額外搜尋 session 記錄；搜尋命令含有 `node --test` 字樣，被沿用的 handoff 分類規則識別為驗證，因此面板如實列為未歸屬記錄，入口保留待確認。這是命令文字分類的限制，不是另一次測試。
- 內建瀏覽器檢查亮色、暗色與 420px／780px 面板；Electron 另檢查 200% 縮放。獨立視覺評審後，縮小窄面板需求列表的空白，並在需求標題旁顯示失敗／過期證據，避免 agent 的完成聲明掩蓋驗證問題。檔案列保持現有箭頭與逐次編輯入口，不新增內嵌 diff。
