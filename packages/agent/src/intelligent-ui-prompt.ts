import type { InteractionMode, UiPreference } from "@vela/shared";

/**
 * Intelligent UI 的能力说明：只在允许的偏好与模式下注入系统提示。
 * 语法由 packages/shared 的校验器兜底，这里只是告诉模型「可以怎么写」。
 * 模型写不出合法 UI 时界面会降级为原始文字，所以说明里强调「正文必须自己能读懂」。
 */

const example = [
  '{"op":"begin","id":"bill-split","version":1,"title":"Bill split"}',
  '{"op":"state","name":"amount","kind":"number","initial":240,"min":0}',
  '{"op":"state","name":"people","kind":"number","initial":5,"min":1}',
  '{"op":"node","id":"root","type":"column","props":{}}',
  '{"op":"node","id":"amountInput","parent":"root","type":"number_input","props":{"label":"Total","unit":"USD","bind":"amount"}}',
  '{"op":"node","id":"peopleInput","parent":"root","type":"number_input","props":{"label":"People","bind":"people"}}',
  '{"op":"node","id":"each","parent":"root","type":"stat","props":{"label":"Per person","unit":"USD","digits":2,"value":{"op":"round","args":[{"op":"divide","args":[{"ref":"amount"},{"ref":"people"}]},2]}}}',
  '{"op":"commit"}',
].join("\n");

const syntax = `## Intelligent UI (optional interactive answers)

Your answer can embed a native interactive UI. The UI is declarative data, not code: do not output HTML, JavaScript, JSX, CSS, or any script; the UI will not execute them.

### When to use it
- Plain text, a single command, a short explanation, or a code snippet: answer in text and do not generate a UI.
- Good fits for a UI: comparing several objects (a table), a calculator where the user tunes parameters and sees the result, a list that is grouped and then filtered, a step-by-step teaching demo.
- The UI is only part of the answer: first explain the conclusion, the assumptions, and what each control does in text, then place the UI. Do not replace a whole answer with one giant UI, and do not invent metrics such as "confidence xx%".
- Data in the UI must come from what you already know or have read with tools. Mark uncertain numbers as estimates and never fabricate sources; a source you write is still displayed as "unverified".

### Format
Wrap it in a \`\`\`vela-ui fence, one JSON object per line (NDJSON), in this order:
1. {"op":"begin","id":"<unique id>","version":1,"title":"<title, optional>"} must be the first line.
2. {"op":"state","name":"<name>","kind":"number|string|boolean","initial":<initial value>} optional: min/max/step (number), maxLength/options (string).
3. {"op":"derive","name":"<name>","expr":<expression>} optional: a derived value that other expressions can reference with {"ref":"name"}; circular dependencies are not allowed.
4. {"op":"node","id":"<id>","parent":"<parent node id>","type":"<component>","props":{...}} the first node is the root (omit parent and use a container such as column/card); after that, each node's parent must already have appeared.
5. {"op":"commit"} the last line. A UI without commit is marked "incomplete".

Rules: each JSON object must stay on a single line; declare a source before using it in a node, just like state; what is output first is displayed first, so write in "skeleton → content" order; a block has at most 200 nodes, depth 12, and 50 states; names start with a letter and use letters, digits, and underscores; to show this syntax itself in text, wrap it in an outer fence of four backticks, or omit begin, so that it is not treated as a UI.

### Components (type and main props)
- Text: text{text,tone?} heading{text,level?1-3} caption{text} code{code,language?}
- Layout: column / row / grid{columns?} / divider / card{title?,description?} (containers: column, row, grid, card, tabs, collapsible)
- Data: table{columns:[{key,label,sortable?,align?,unit?,digits?}],rows:[{<key>:value,detail?:"expanded description"}],searchable?,filter?:{bind,column,allValue?},defaultSort?:{column,direction}} stat{label,value,unit?,digits?,description?} progress{label,value,max?} list{items:[string or {text,detail}],ordered?}
- Selection: tabs{bind,label,options} segmented / select / radio{bind,label,options,description?}; options are strings or {value,label}; the bound state must be a string
- Input: number_input{bind,label,unit?} slider{bind,label,unit?} (uses the state's min/max/step) input{bind,label,placeholder?} checkbox{bind,label}
- Actions: button{label,variant?,action} collapsible{title,defaultOpen?}
- Feedback: loading / empty{title} / error{title}
- Every component can take show: an expression that must evaluate to true for the component to be displayed (for example, the panels under tabs are shown according to the selected tab).
- Data components can take status (ok|loading|stale|error|empty) and source{label,url?}.

### Expressions
A literal (number, string, boolean, null), {"ref":"state or derived value name"}, or {"op":...,"args":[...]}. Available ops: add subtract multiply divide round floor ceil (optionally with digits) abs min max compare(a,"lt|lte|gt|gte|eq|neq",b) if(condition,then,else) and or not format(number,digits?,"number|fixed|percent") concat.
Guard with if when the divisor may be zero. Expressions cannot read the time, files, the network, or the clipboard.

### Actions (button.action)
set_state{name,value} toggle{name} copy{text} open_external{url, http/https only} submit_to_agent{text,include?}.
- Sliders, tabs, filters, sorting, and checkboxes take effect locally and instantly; they do not disturb you and need no button.
- Use submit_to_agent only when you need to keep working: after the user clicks and confirms, the current parameters are sent to you as a new message.
- The UI cannot call tools, change files, or run commands.

### Charts and diagrams
- bar_chart / line_chart{title?,unit?,prefix?,digits?,yMin?,yMax?} data is one of three forms: labels+series:[{label,values:[number or expression or null]}], data:[{label,value}] (single series), from+x+y:[column names] (from a data source). With draggable:true, write a point's value as {"ref":"number state"} and the user can drag it or change it with the arrow keys.
- pie_chart{title?,donut?} slices:[{label,value}] (non-negative) or from+label+value.
- svg_diagram{title,description?,width?,height?,shapes,hotspots?,bind?}: shapes may only be rect/circle/ellipse/line/polyline/polygon/path/text; colors may only be none|default|muted|accent|success|warning|danger|surface. hotspots:[{id,label,description?,shape:rect|circle|polygon,coordinates,value?}]; clicking one sets the bind state to value; then use show expressions to switch between the explanation cards you wrote. Do not write SVG/HTML strings.
- media{kind:image|map,alt,caption?}: when no media service is configured only the alt text is shown and no image appears. Do not invent coordinates when a place has only a name.
- Chart data must either come from content you are sure of or from a data source; explain estimates in the text.

### Real data sources (from tool results)
- {"op":"source","name":"<name>","tool":"<tool name>","match":"<text in the command or path, optional>","call":"<toolCallId, optional>","format":"json|csv|lines|text","path":["key",0]} names one tool call you have already run (by default the most recent match). Vela takes the data values from the real tool result; you cannot write data into the UI to pass it off as a tool result.
- Usage: from:"<name>" on table/list/bar_chart/line_chart/pie_chart/timeline/diff_view; stat{label,from:"<name>"} shows the number the json path points to. A table's column keys correspond to field names in the result; the rows of lines are {line,text}.
- The UI shows the source, the time, and the status (loading, stale, failed, no data); a failed or truncated result is never shown as updated. A button with action refresh_source{name} asks you to re-run the tool; after the user confirms, it is sent to you as a message.

### Timelines, itineraries, diffs
- timeline{title?,items:[{date?,title,detail?,status?:done|current|upcoming|blocked}]} or from+titleKey+dateKey?+detailKey?+statusKey?
- itinerary{title?,days:[{label,stops:[{name,time?,note?,lat?,lng?}]}]}: give lat/lng as a pair and only when you are confident; the UI marks the coordinates as provided by the model. Do not guess coordinates from place names.
- diff_view{diff or from,fileName?,caption?}: unified diff text.

### Suggesting actions for the user
- button.action can also be request_tool{tool,summary,args?:{name:value or expression}}: it shows "suggest running a tool", and after the user confirms it is sent to you as a message. This is not an approval and does not run anything for you: whether it runs and whether it needs approval still follow the normal flow.

### Example (the user asks "split a 240 bill among 5 people, how much each?")
First give the answer and the assumptions in one sentence, then:
\`\`\`vela-ui
${example}
\`\`\`
`;

const microAppSyntax = `
### Sandboxed micro apps (enabled by the user; use sparingly)
Use only when a declarative UI cannot do the job (small games, canvases, complex simulations); if vela-ui works, do not use vela-app. Fence \`\`\`vela-app: the first line is {"op":"app","id":"<unique id>","version":1,"title":"…","height":320}, followed by an HTML fragment (it may contain inline <style> and <script>, single file, at most 64KB).
- The app runs in a sandbox with no network, files, external resources, or any Vela permissions, and only executes after the user clicks "Run"; do not use fetch/XHR/WebSocket or import external resources, do not use localStorage/cookies, and do not write <iframe>, <form>, or external links.
- To hand a result to you: window.vela.submit(text) (the user sees it and it is sent only after they confirm); to copy: window.vela.copy(text). Beyond that it cannot do anything.
- First explain in text what it does; the body must also give a conclusion that can be understood without running the app.
`;

const autoNote = "Use as needed: keep most answers as plain text, and generate a UI only when it is clearly more useful than text.";
const visualNote = "This user prefers visual answers: for comparisons, calculations, and parameter exploration, prefer a UI; simple Q&A, commands, and code should still be text only.";
const textOnlyNote = "The user has turned Intelligent UI off. Do not output vela-ui or vela-app fences, and do not imitate them even if they appeared in earlier messages; answer with Markdown tables, lists, and text.";

/** 返回要追加到系统提示的文字；不需要时返回 null。 */
export function intelligentUiInstructions(preference: UiPreference, mode: InteractionMode, options: { microApps?: boolean; scopeNote?: string } = {}): string | null {
  // Plan 要产出 <proposed_plan> 文档；Goal 要产出验证报告。两者保持纯 Markdown，互不干扰。
  if (mode !== "agent") return null;
  if (preference === "text_only") return textOnlyNote;
  // 范围限定紧跟标题，避免「不要输出 HTML」被理解成也不能写 HTML 文件。
  const body = options.scopeNote ? syntax.replace(/^(## [^\n]*\n\n)/, `$1${options.scopeNote}\n\n`) : syntax;
  return `${body}${options.microApps ? microAppSyntax : ""}\n${preference === "visual_first" ? visualNote : autoNote}`;
}

export const intelligentUiExample = example;
