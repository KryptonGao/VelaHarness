import type {
  ContextUsage,
  FileAttachmentPayload,
  ImageAttachment,
  InteractionMode,
  RuntimeInstruction,
  RuntimeInstructionMode,
  SkillSummary,
  TaskRecipe,
  ThinkingLevel,
  ThinkingSummaryModel,
} from "@vela/shared";
import { forwardRef, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { useModels } from "../hooks/useModels";
import type { ProjectApi } from "../hooks/useProject";
import type { SendButtonIcon } from "../hooks/usePreferences";
import { ArrowUpIcon, CloseIcon, FileIcon, SendIcon, SkillIcon, SteerIcon } from "./icons";
import { MotionList } from "./BatchMotion";
import { useReducedMotion } from "../hooks/useMotionPresence";
import { PopoverPresence } from "./MotionPresence";
import { ModelControls } from "./ModelControls";
import { RecipeStageDock, useRecipeRun } from "./RecipeChatContext";
import { ApprovalSlot } from "./composer/ApprovalBanner";
import { AttachMenu } from "./composer/AttachMenu";
import { BranchChip } from "./composer/BranchChip";
import { ComposerStatsRow } from "./composer/ComposerStatsRow";
import { EnvironmentChip } from "./composer/EnvironmentChip";
import { ModeChip } from "./composer/ModeChip";
import { SandboxPill } from "./composer/SandboxPill";
import { SkillMenu } from "./composer/SkillMenu";
import { WorkspaceChip } from "./composer/WorkspaceChip";
import {
  createSkillChip,
  editorSlash,
  insertSkillChip,
  pruneChips,
  removeSlashText,
  serializeEditor,
  setEditorText,
  skillAttr,
  type EditorSlash,
} from "./composer/skill-editor";
import { modKeyLabel } from "../platform";
import { slashMenuItems, type SlashMenuItem } from "./composer/slash-picker";
import { formatTokens, slashCommands, statusItems, type SlashCommand, type StatusItem } from "./composer/slash-commands";
import { RecipeActionsContext } from "./recipe-actions-context";
import { RaceActionsContext } from "./race-actions-context";
import { RaceSetupDialog } from "./RaceSetupDialog";
import { useComposerSeed } from "./composer-seed-context";
import { elementNumber, hasReplyText as anyReplyText, isElementReply, replyCardText, replyMessage, type ReplyCard } from "./selection-actions";
import { collectAnnotationImages, planAnnotationImages } from "./annotation-images";
import { useAnnotationTracking } from "../browser/reply-store";
import { localizeError, tr, useAppLocale, trf } from "../locale";
import { useInputPrediction } from "../hooks/useInputPrediction";
import { useComposerLayout } from "../hooks/useComposerLayout";

export interface ComposerProps {
  embedded?: boolean;
  sandboxMode?: import("@vela/shared").SandboxMode;
  disabled: boolean;
  streaming: boolean;
  /** 用于把快捷键提示里的修饰键适配成当前平台。 */
  platform: string;
  /** 已提交、等待执行的排队/调整指令。 */
  instructions: RuntimeInstruction[];
  /** 工作区、执行环境和分支仅在当前聊天第一轮开始前显示。 */
  showSetupControls: boolean;
  model: string | null | undefined;
  modelProvider: string | null;
  modelId: string | null;
  modelReady: boolean;
  thinkingLevel: ThinkingLevel;
  thinkingLevels: ThinkingLevel[];
  /** 在输入框模型列表中隐藏的模型，key 为 `provider/id`。 */
  hiddenModels: string[];
  sendButtonIcon?: SendButtonIcon;
  /** 输入预测开关；关闭时完全不请求模型。 */
  predictionEnabled?: boolean;
  /** 预测所用的模型；null 表示跟随当前对话模型。 */
  predictionModel?: ThinkingSummaryModel | null;
  /** 当前对话末条已结束助手回复的标识；没有可预测的回复时为 null。 */
  predictionKey?: string | null;
  conversationId?: string | null;
  models: ReturnType<typeof useModels>;
  mode: InteractionMode;
  sendError: string | null;
  /** 会话统计条数据，来自主进程的 Context 用量快照。 */
  usage: ContextUsage | null;
  contextPopover?: boolean;
  project: ProjectApi;
  /** 在对话里选中文字并写好的回复：每条一张卡片，发送时各自的原文作为引用块放在回复前面。 */
  replies?: readonly ReplyCard[];
  onRemoveReply?: (id: string) => void;
  /** 点元素批注卡片：在浏览器里定位对应元素。 */
  onFocusReply?: (id: string) => void;
  /** 开始发送：卡片离开输入框上方，返回发出去的卡片。 */
  onBeginReplies?: () => readonly ReplyCard[];
  /** 发送结束：消息留下了就释放页面里的元素，没有留下就把卡片原样放回。 */
  onSettleReplies?: (sent: readonly ReplyCard[], kept: boolean) => void;
  onSend: (text: string, images?: ImageAttachment[], deliverAs?: RuntimeInstructionMode) => Promise<void | boolean>;
  /** 撤销一条还没被模型消费的排队/调整指令。 */
  onRemoveInstruction: (instructionId: string) => Promise<void>;
  onAbort: () => Promise<void>;
  onMode: (mode: InteractionMode) => void;
}

/** 输入框上方命令卡片的内容：`/status` 的条目，或 `/compact` 的进度与结果。 */
type CommandCard =
  | { kind: "status"; items: StatusItem[] }
  | { kind: "compact"; phase: "busy" | "done" | "error"; before: number | null; error?: string };

function commandCardView(card: CommandCard, usage: ContextUsage | null): { title: string; message?: string; items: StatusItem[]; busy: boolean; tone: "info" | "error" } {
  if (card.kind === "status") return { title: tr("状态", "Status"), items: card.items, busy: false, tone: "info" };
  if (card.phase === "busy") return { title: tr("正在压缩上下文…", "Compacting context…"), message: tr("把较早的对话总结成摘要，完成后可以继续发送。", "Summarizing earlier turns. You can keep chatting once it finishes."), items: [], busy: true, tone: "info" };
  if (card.phase === "error") return { title: tr("无法压缩上下文", "Could not compact the context"), message: card.error, items: [], busy: false, tone: "error" };
  const after = usage?.tokens ?? null;
  const items = card.before !== null && after !== null && after < card.before
    ? [{ label: tr("上下文", "Context"), value: `${formatTokens(card.before)} → ${formatTokens(after)}` }]
    : [];
  return { title: tr("上下文已压缩", "Context compacted"), items, busy: false, tone: "info" };
}

/** 上限由样式表决定（随字号和窗口高度变化）；读不到时退回 140px。 */
function maxInputHeight(input: HTMLElement): number {
  const value = Number.parseFloat(getComputedStyle(input).maxHeight);
  return Number.isFinite(value) ? value : 140;
}

export const Composer = forwardRef<HTMLDivElement, ComposerProps>(function Composer({
  embedded = false,
  sandboxMode,
  disabled,
  streaming,
  platform,
  instructions,
  showSetupControls,
  model,
  modelProvider,
  modelId,
  modelReady,
  thinkingLevel,
  thinkingLevels,
  hiddenModels,
  sendButtonIcon = "paper-plane",
  predictionEnabled = false,
  predictionModel = null,
  predictionKey = null,
  conversationId = null,
  models,
  mode,
  sendError,
  usage,
  contextPopover = false,
  project,
  replies = [],
  onRemoveReply,
  onFocusReply,
  onBeginReplies,
  onSettleReplies,
  onSend,
  onRemoveInstruction,
  onAbort,
  onMode,
}, ref) {
  const instanceId = useId();
  const promptId = embedded ? `prompt-${instanceId}` : "prompt";
  const menuId = embedded ? `skill-menu-${instanceId}` : "skill-menu";
  const optionIdPrefix = embedded ? `skill-option-${instanceId}` : "skill-option";
  const recipeActions = useContext(RecipeActionsContext);
  const raceActions = useContext(RaceActionsContext);
  const [raceOpen, setRaceOpen] = useState(false);
  const locale = useAppLocale();
  const layout = useComposerLayout();
  const [recipes, setRecipes] = useState<TaskRecipe[] | null>(null);
  const [recipesError, setRecipesError] = useState<string | null>(null);
  const recipeRun = useRecipeRun();
  const recipeActive = !!recipeRun?.stages && ["starting", "running", "waiting_for_user"].includes(recipeRun.status);
  const [value, setValue] = useState("");
  const [skills, setSkills] = useState<SkillSummary[] | null>(null);
  const [skillsError, setSkillsError] = useState<string | null>(null);
  const [slash, setSlash] = useState<EditorSlash | null>(null);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [modelOpenRequest, setModelOpenRequest] = useState(0);
  const [commandCard, setCommandCard] = useState<CommandCard | null>(null);
  const cardToken = useRef(0);
  const usageRef = useRef(usage);
  usageRef.current = usage;
  const [attachments, setAttachments] = useState<FileAttachmentPayload[]>([]);
  const attachmentsRef = useRef<FileAttachmentPayload[]>([]);
  attachmentsRef.current = attachments;
  const [attachNotice, setAttachNotice] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const reducedMotion = useReducedMotion();
  const measuredInput = useRef(false);
  const inputRef = useRef<HTMLDivElement>(null);
  const iconsRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const skillRequest = useRef(0);
  const dragCounter = useRef(0);
  const workspacePath = project.workspace?.current ?? null;
  const slashKey = slash ? `${slash.start}:${slash.query}` : "";
  const menuOpen = Boolean(slash) && dismissedKey !== slashKey && (!disabled || streaming);
  const recipesEnabled = !!recipeActions?.useRecipe && !streaming && !recipeActive;
  const commandsAvailable = useMemo(() => slashCommands({
    canChangeModel: !streaming && !recipeActive,
    canCompact: !disabled && !streaming && !recipeActive && modelReady && (usage?.turnCount ?? 0) > 0,
  }), [streaming, recipeActive, disabled, modelReady, usage?.turnCount]);
  const filtered = useMemo(() => slashMenuItems(skills ?? [], recipesEnabled ? recipes ?? [] : [], slash?.query ?? "", commandsAvailable), [skills, recipes, recipesEnabled, slash?.query, commandsAvailable]);
  const safeIndex = filtered.length === 0 ? 0 : Math.min(activeIndex, filtered.length - 1);
  // 输入框里的 Skill 芯片会写成文字中的 `/skill:名称`，所以 value 本身就是要发送的内容。
  const prompt = value.trim();
  // 卡片里的回复本身就是要发送的内容，输入框可以留空。
  const hasReplyText = anyReplyText(replies);
  const tracking = useAnnotationTracking();
  const submitting = useRef(false);
  const prediction = useInputPrediction({
    enabled: predictionEnabled && !disabled && !recipeActive,
    conversationId,
    predictionKey,
    streaming,
    model: predictionModel,
    locale,
  });
  // 只有空输入框（没有文字、技能和附件）才显示预测；一旦开始输入就让位。
  const suggestion = !prompt && !hasReplyText && attachments.length === 0 && !streaming ? prediction : "";

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    let appliedHeight = -1;
    const fit = () => {
      const currentHeight = input.getBoundingClientRect().height;
      // Measure at natural height without animating the temporary auto value.
      input.style.transition = "none";
      input.style.height = "auto";
      const targetHeight = Math.min(input.scrollHeight, maxInputHeight(input));
      if (targetHeight === appliedHeight) {
        input.style.height = `${targetHeight}px`;
        input.style.transition = "";
        return;
      }
      input.style.height = `${currentHeight}px`;
      void input.offsetHeight;
      input.style.transition = measuredInput.current && !reducedMotion ? "" : "none";
      input.style.height = `${targetHeight}px`;
      appliedHeight = targetHeight;
      measuredInput.current = true;
    };
    fit();
    let measuredWidth = input.getBoundingClientRect().width;
    const resizeObserver = new ResizeObserver(() => {
      // Width changes (sidebar resize/window resize) can change line wrapping too.
      if (Math.abs(input.getBoundingClientRect().width - measuredWidth) < 1) return;
      measuredWidth = input.getBoundingClientRect().width;
      appliedHeight = -1;
      fit();
    });
    resizeObserver.observe(input);
    // 输入法组字（注音、拼音）会直接改 DOM 而不一定带来 value 变化；换行那一刻也要跟着撑高，
    // 否则要多输入几个字才会长高。
    const mutationObserver = new MutationObserver(fit);
    mutationObserver.observe(input, { childList: true, characterData: true, subtree: true });
    input.addEventListener("compositionupdate", fit);
    input.addEventListener("compositionend", fit);
    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      input.removeEventListener("compositionupdate", fit);
      input.removeEventListener("compositionend", fit);
    };
  }, [value, reducedMotion]);

  useEffect(() => {
    setActiveIndex(0);
  }, [slash?.start, slash?.query]);

  useEffect(() => {
    // 选区移动时重新判断光标是否停在 `/查询` 上；输入框不是 textarea，没有 onSelect 可用。
    const onSelectionChange = () => {
      const root = inputRef.current;
      if (!root || document.activeElement !== root) return;
      const next = editorSlash(root);
      setSlash((current) =>
        current === next || (current && next && current.node === next.node
          && current.start === next.start && current.end === next.end && current.query === next.query)
          ? current
          : next);
    };
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, []);

  // 任务交接包等外部预填：只在目标对话的输入框里取走，并把光标放到末尾方便补一句指令。
  useComposerSeed(recipeActions?.conversationId ?? null, text => setText(text));

  // 选中文字点「回复」后，光标直接进输入框等用户写回复。
  useEffect(() => {
    if (replies.length > 0) inputRef.current?.focus();
  }, [replies.length]);

  useEffect(() => {
    const root = inputRef.current;
    if (!root || !skills) return;
    // Skill 被停用或删除后，输入框里已有的芯片一并去掉。
    const enabled = new Set(skills.filter((item) => item.enabled).map((item) => item.name));
    if (pruneChips(root, enabled)) setValue(serializeEditor(root));
  }, [skills]);

  useEffect(() => {
    const api = window.vela;
    if (!api) {
      setSkills([]);
      return;
    }
    const id = ++skillRequest.current;
    let active = true;
    void api.listSkills().then(
      (catalog) => {
        if (!active || skillRequest.current !== id) return;
        setSkills(catalog.skills);
        setSkillsError(null);
      },
      (caught: unknown) => {
        if (!active || skillRequest.current !== id) return;
        setSkillsError(caught instanceof Error ? caught.message : tr("无法读取 Skill", "Unable to read skills"));
      },
    );
    return () => {
      active = false;
    };
  }, [workspacePath, menuOpen]);

  useEffect(() => {
    if (!menuOpen || !recipesEnabled) return;
    const api = window.vela?.taskRecipes;
    if (!api) { setRecipes([]); return; }
    let active = true, request = 0;
    const update = async () => {
      const current = ++request;
      try { const state = await api.list(locale); if (active && current === request) { setRecipes(state.recipes); setRecipesError(state.error); } }
      catch (e) { if (active && current === request) { setRecipes([]); setRecipesError(e instanceof Error ? e.message : tr('无法读取配方', 'Could not load recipes')); } }
    };
    setRecipes(null); setRecipesError(null); void update();
    const unsubscribe = api.subscribe(() => { void update(); });
    window.addEventListener('focus', update);
    return () => { active = false; unsubscribe(); window.removeEventListener('focus', update); };
  }, [menuOpen, recipesEnabled, workspacePath, locale]);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (menuRef.current?.contains(target) || inputRef.current?.contains(target)) return;
      setDismissedKey(slashKey);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [menuOpen, slashKey]);

  /** 附件被丢弃（超出数量、读取或解码失败）时给出可见提示，几秒后自行收起。 */
  function addAttachments(payloads: FileAttachmentPayload[], failed = 0): void {
    // 粘贴图片没有路径，用图片数据本身去重，避免同一张图被剪贴板的多个表示重复加入。
    const keyOf = (entry: FileAttachmentPayload) => entry.path || entry.image?.data || entry.name;
    const current = attachmentsRef.current;
    const known = new Set(current.map(keyOf));
    const merged = [...current];
    let overflow = 0;
    for (const payload of payloads) {
      const key = keyOf(payload);
      if (known.has(key)) continue;
      known.add(key);
      if (merged.length >= maxAttachments) { overflow += 1; continue; }
      merged.push(payload);
    }
    attachmentsRef.current = merged;
    setAttachments(merged);
    const notes: string[] = [];
    if (overflow > 0) notes.push(trf("已忽略 {0} 个文件：最多附加 {1} 个", "Ignored {0} files: up to {1} attachments", overflow, maxAttachments));
    if (failed > 0) notes.push(trf("{0} 个文件无法读取", "{0} files could not be read", failed));
    if (notes.length > 0) setAttachNotice(notes.join("；"));
  }

  async function handleDrop(event: React.DragEvent): Promise<void> {
    event.preventDefault();
    dragCounter.current = 0;
    setDragging(false);
    const api = window.vela;
    if (!api) return;
    const files = Array.from(event.dataTransfer.files);
    if (files.length === 0) return;
    const paths = files
      .map((file) => api.pathForFile(file))
      .filter((path) => path && !path.startsWith("/dev/"));
    if (paths.length === 0) return;
    const payloads = await api.hydrateAttachments(paths).catch(() => []);
    const failed = Math.max(0, paths.length - payloads.length);
    if (payloads.length > 0 || failed > 0) addAttachments(payloads, failed);
  }

  async function handlePaste(event: React.ClipboardEvent): Promise<void> {
    // Chromium 从系统剪贴板取图片时常常把 item.type 留空（图片字节已经转成 PNG），
    // 所以不能只按 image/* 过滤，否则这类图片会被静默丢掉。
    const pasted = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file" && (item.type === "" || item.type.startsWith("image/")))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null && file.size > 0);
    const files = pasted.slice(0, maxPastedImages);
    const truncated = pasted.length - files.length;
    if (files.length === 0) {
      // 输入框是 contenteditable，默认会带着样式粘贴；这里只收纯文本。
      const text = event.clipboardData.getData("text/plain");
      if (text) {
        event.preventDefault();
        document.execCommand("insertText", false, text);
      }
      return;
    }
    event.preventDefault();
    const payloads: FileAttachmentPayload[] = [];
    const seen = new Set<string>();
    let failed = truncated;
    for (const file of files) {
      const prepared = await preparePastedImage(file);
      if (!prepared) { failed += 1; continue; }
      if (prepared.fingerprint) {
        if (seen.has(prepared.fingerprint)) continue;
        seen.add(prepared.fingerprint);
      }
      payloads.push(prepared.payload);
    }
    if (payloads.length > 0 || failed > 0) addAttachments(payloads, failed);
  }

  /** 输入框内容有变化时，把它同步成发送用的文字，并重新判断 `/查询`。 */
  function syncEditor(): void {
    const root = inputRef.current;
    if (!root) return;
    setValue(serializeEditor(root));
    setSlash(editorSlash(root));
  }

  function setText(text: string): void {
    const root = inputRef.current;
    if (!root) return;
    root.focus();
    setEditorText(root, text);
    setValue(text);
    setSlash(null);
  }

  function clearEditor(): void {
    inputRef.current?.replaceChildren();
    setValue("");
    setSlash(null);
  }

  function selectSkill(nextSkill: SkillSummary): void {
    const root = inputRef.current;
    const skillIcon = iconsRef.current?.firstChild;
    const closeIcon = iconsRef.current?.lastChild;
    const token = root ? editorSlash(root) ?? slash : null;
    if (!root || !skillIcon || !closeIcon || !token) return;
    insertSkillChip(token, createSkillChip(nextSkill, { skill: skillIcon, close: closeIcon }));
    setValue(serializeEditor(root));
    setSlash(null);
    setDismissedKey(null);
  }

  /** 内置命令：去掉输入框里的 `/查询` 后直接执行。 */
  function runCommand(command: SlashCommand): void {
    const root = inputRef.current;
    const token = root ? editorSlash(root) ?? slash : null;
    if (!root || !token) return;
    removeSlashText(token);
    setValue(serializeEditor(root)); setSlash(null); setDismissedKey(null);
    if (command.id === "model") { setModelOpenRequest((count) => count + 1); return; }
    const token_ = ++cardToken.current;
    if (command.id === "status") {
      setCommandCard({ kind: "status", items: statusItems({ model, thinkingLevel, mode, usage }) });
      return;
    }
    const api = window.vela;
    if (!api) return;
    const before = usageRef.current?.tokens ?? null;
    setCommandCard({ kind: "compact", phase: "busy", before });
    void api.compactConversation(conversationId ?? undefined)
      .catch((caught: unknown) => ({ error: caught instanceof Error ? caught.message : tr("无法压缩上下文", "Could not compact the context") }))
      // 用户中途关掉卡片，或又开了别的命令卡片，就不再回写结果。
      .then((result) => {
        if (cardToken.current !== token_) return;
        setCommandCard(result.error
          ? { kind: "compact", phase: "error", before, error: localizeError(result.error) }
          : { kind: "compact", phase: "done", before });
      });
  }

  function selectSlashItem(item: SlashMenuItem): void {
    if (item.type === 'command') { runCommand(item.command); return; }
    if (item.type === 'skill') { selectSkill(item.skill); return; }
    const root = inputRef.current;
    const token = root ? editorSlash(root) ?? slash : null;
    if (!root || !token || !recipesEnabled) return;
    removeSlashText(token);
    setValue(serializeEditor(root)); setSlash(null); setDismissedKey(null);
    recipeActions?.useRecipe?.(item.recipe);
  }

  async function submit(steerIntent = false): Promise<void> {
    if (submitting.current) return;
    const root = inputRef.current;
    const typed = (root ? serializeEditor(root).trim() : prompt) || (hasReplyText ? "" : suggestion);
    const cards = replies;
    // 只有元素、没有批注文字时，输入框必须有内容才能发送。
    if (!typed && !hasReplyText && cards.some(isElementReply)) return;
    if ((!typed && cards.length === 0) || disabled || recipeActive || !modelReady) return;
    // 取回元素截图需要一点时间；这段时间内不重复提交。发出之后运行中的追加指令仍可继续提交。
    submitting.current = true;
    let prepared: { text: string; images: ImageAttachment[]; draftAttachments: FileAttachmentPayload[]; sent: readonly ReplyCard[] } | null = null;
    try {
      const userImages = attachments
        .map((entry) => entry.image)
        .filter((image): image is ImageAttachment => image !== null);
      // 元素截图占用的名额：优先保留用户自己添加的附件。
      const capacity = Math.min(maxMessageImages - userImages.length, maxAttachments - attachments.length);
      const plan = planAnnotationImages(cards, tracking, capacity);
      const annotation = await collectAnnotationImages(cards, plan, userImages.length + 1,
        (tabId, ids) => window.vela?.browser?.annotationImages(tabId, ids) ?? Promise.resolve({}));
      const text = replyMessage(cards, typed, { stale: annotation.stale, images: annotation.refs, t: tr });
      if (text) {
        const draftAttachments = attachments;
        clearEditor();
        setAttachments([]);
        prepared = { text, images: [...userImages, ...annotation.images], draftAttachments, sent: onBeginReplies?.() ?? [] };
      }
    } finally {
      submitting.current = false;
    }
    if (!prepared) return;
    const { text, images, draftAttachments, sent } = prepared;
    // 运行中按追加指令投递:Enter 排队,⌘/Ctrl+Enter 调整当前任务。
    const deliverAs: RuntimeInstructionMode | undefined = streaming
      ? (steerIntent ? "steer" : "queue")
      : undefined;
    let kept = true;
    try {
      kept = (await onSend(text, images.length > 0 ? images : undefined, deliverAs)) !== false;
    } catch {
      kept = false;
    }
    onSettleReplies?.(sent, kept);
    // 消息没有留下(没进对话也没排上队)时把草稿放回去;卡片已原样放回,用户已经开始写新内容就不覆盖。
    if (!kept) restoreDraft(typed, draftAttachments);
  }

  function restoreDraft(text: string, draftAttachments: FileAttachmentPayload[]): void {
    const root = inputRef.current;
    if (!root || serializeEditor(root).trim()) return;
    setText(text);
    setAttachments((current) => (current.length === 0 ? draftAttachments : current));
  }

  // 压缩完成的提示几秒后自行收起；状态卡片和报错保留到用户关闭。
  useEffect(() => {
    if (commandCard?.kind !== "compact" || commandCard.phase !== "done") return;
    const timer = window.setTimeout(() => closeCommandCard(), 8_000);
    return () => window.clearTimeout(timer);
  }, [commandCard]);

  // 换了对话就不再显示上一个对话的命令结果。
  useEffect(() => { closeCommandCard(); }, [conversationId]);

  useEffect(() => {
    if (!attachNotice) return;
    const timer = window.setTimeout(() => setAttachNotice(null), 6_000);
    return () => window.clearTimeout(timer);
  }, [attachNotice]);

  function closeCommandCard(): void {
    cardToken.current += 1;
    setCommandCard(null);
  }

  const showError = sendError ? localizeError(sendError) : project.error ? localizeError(project.error) : null;
  const modifier = modKeyLabel(platform);
  const sendHint = disabled
    ? tr("会话还没有准备好", "Chat is not ready yet")
    : !modelReady
      ? tr("先选择一个可用的模型", "Choose an available model first")
      : !prompt && !hasReplyText && suggestion
        ? tr("发送预测的内容", "Send the predicted message")
      : !prompt && !hasReplyText
        ? tr("输入内容后发送", "Enter a message to send")
        : streaming
          ? tr("排队发送 (Enter)", "Queue (Enter)")
          : tr("发送 (Enter)", "Send (Enter)");
  const steerHint = trf("调整当前任务 ({0}Enter)", "Steer current task ({0}Enter)", modifier);

  const approvalSlots = (
  <>
    <ApprovalSlot approval={project.approval} onReply={project.replyApproval} />
    <RecipeStageDock run={recipeRun} />
  </>
  );

  const statusBar = (
    <>
      {showSetupControls || showError || attachNotice ? (
        <div className="composer-status-bar">
          {showSetupControls ? (
            <>
              <WorkspaceChip project={project} />
              <EnvironmentChip project={project} />
              <BranchChip project={project} />
            </>
          ) : null}
          {showError ? (
            <span className="composer-status-notice" role="alert" title={showError}>
              {showError}
            </span>
          ) : null}
          {attachNotice ? (
            <span className="composer-status-notice" role="status" title={attachNotice}>
              {attachNotice}
            </span>
          ) : null}
        </div>
      ) : null}
    </>
  );

  const skillMenu = (
    <PopoverPresence present={menuOpen}>
      <div className="skill-menu-anchor" ref={menuRef}>
        <SkillMenu
          id={menuId}
          optionIdPrefix={optionIdPrefix}
          items={filtered}
          loadingSkills={skills === null && !skillsError}
          loadingRecipes={recipesEnabled && recipes === null && !recipesError}
          recipeError={recipesEnabled ? recipesError : null}
          error={skillsError}
          query={slash?.query ?? ""}
          activeIndex={safeIndex}
          onActiveIndex={setActiveIndex}
          onSelect={selectSlashItem}
        />
      </div>
    </PopoverPresence>
  );

  // 关闭时保留最后一帧内容，让退出动画不会闪出空卡片。
  const lastCard = useRef<ReturnType<typeof commandCardView> | null>(null);
  const liveCard = commandCard ? commandCardView(commandCard, usage) : null;
  if (liveCard) lastCard.current = liveCard;
  const card = liveCard ?? lastCard.current;
  const statusPanel = (
    <PopoverPresence present={Boolean(liveCard) && !menuOpen}>
      <div className="skill-menu-anchor">
        <section className={`status-card${card?.tone === "error" ? " error" : ""}`} role={card?.tone === "error" ? "alert" : "status"} aria-label={card?.title}>
          <header className="status-card-head">
            {card?.busy ? <span className="status-card-spinner" aria-hidden="true" /> : null}
            <span className="status-card-title">{card?.title}</span>
            <button type="button" className="status-card-close" aria-label={tr("关闭", "Close")} title={tr("关闭", "Close")} onClick={closeCommandCard}>
              <CloseIcon size={12} />
            </button>
          </header>
          {card?.message ? <p className="status-card-message">{card.message}</p> : null}
          {card?.items.length ? (
            <dl className="status-card-list">
              {card.items.map((item) => (
                <div className="status-card-row" key={item.label}>
                  <dt>{item.label}</dt>
                  <dd title={item.value}>{item.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </section>
      </div>
    </PopoverPresence>
  );

  const instructionRow = (
    <MotionList className="instruction-row" items={instructions} keyOf={(entry) => entry.id} horizontal>
      {(entry) => (
        <div className={`instruction-chip instruction-${entry.mode}`}>
          <span className="instruction-badge">
            {entry.mode === "queue" ? tr("排队", "Queued") : tr("调整", "Steering")}
          </span>
          <span className="instruction-text" title={entry.text}>{entry.text}</span>
          <button
            type="button"
            className="instruction-remove"
            title={tr("撤销这条指令", "Remove this instruction")}
            aria-label={tr("撤销这条指令", "Remove this instruction")}
            onClick={() => void onRemoveInstruction(entry.id)}
          >
            <CloseIcon size={10} />
          </button>
        </div>
      )}
    </MotionList>
  );

  const attachmentRow = (
    <MotionList className="attachment-row" items={attachments} keyOf={attachmentKey} horizontal>
        {(entry) => (
          <div className={`attachment-chip attachment-${entry.kind}`}>
            {entry.image ? (
              <img
                className="attachment-thumb"
                src={`data:${entry.image.mimeType};base64,${entry.image.data}`}
                alt={entry.name}
              />
            ) : (
              <span className="attachment-file-icon">
                <FileIcon size={12} />
              </span>
            )}
            <span className="attachment-name" title={entry.path || entry.name}>
              {entry.name}
            </span>
            <button
              type="button"
              className="attachment-remove"
              title={tr("移除附件", "Remove attachment")}
              onClick={() => setAttachments((current) => current.filter((item) => item !== entry))}
            >
              <CloseIcon size={10} />
            </button>
          </div>
        )}
    </MotionList>
  );

  const editable = !(recipeActive || disabled && !streaming);
  const entry = (
    <div className="composer-entry">
      <span hidden ref={iconsRef}>
        <SkillIcon size={15} />
        <CloseIcon size={12} />
      </span>
      <div
        id={promptId}
        ref={inputRef}
        className={`input-textarea rich-input${suggestion ? " with-prediction" : ""}`}
        data-placeholder={suggestion || placeholderFor(mode)}
        data-empty={!prompt}
        role="textbox"
        aria-multiline="true"
        aria-label={tr("输入消息", "Message")}
        aria-disabled={!editable}
        contentEditable={editable}
        suppressContentEditableWarning
        spellCheck
        aria-autocomplete="list"
        aria-expanded={menuOpen}
        aria-controls={menuOpen ? menuId : undefined}
        aria-activedescendant={menuOpen && filtered[safeIndex] ? `${optionIdPrefix}-${safeIndex}` : undefined}
        aria-describedby={suggestion ? `${promptId}-suggestion` : undefined}
        onInput={syncEditor}
        onFocus={() => setDismissedKey(null)}
        onPaste={(event) => void handlePaste(event)}
        onMouseDown={(event) => {
          // 点芯片上的移除按钮不应该抢走输入框的焦点。
          if ((event.target as Element).closest?.("[data-skill-remove]")) event.preventDefault();
        }}
        onClick={(event) => {
          const chip = (event.target as Element).closest?.("[data-skill-remove]")?.closest(`[${skillAttr}]`);
          if (!chip) return;
          chip.remove();
          syncEditor();
          inputRef.current?.focus();
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.key === "Process") return;
          if (menuOpen && filtered.length > 0 && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
            event.preventDefault();
            const last = filtered.length - 1;
            setActiveIndex(event.key === "ArrowDown"
              ? (safeIndex >= last ? 0 : safeIndex + 1)
              : (safeIndex <= 0 ? last : safeIndex - 1));
            return;
          }
          if (menuOpen && event.key === "Escape") {
            event.preventDefault();
            setDismissedKey(slashKey);
            return;
          }
          if (menuOpen && filtered.length > 0 && !event.shiftKey && (event.key === "Enter" || event.key === "Tab")) {
            event.preventDefault();
            const picked = filtered[safeIndex];
            if (picked) selectSlashItem(picked);
            return;
          }
          if (menuOpen && (skills === null || recipesEnabled && recipes === null) && event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            return;
          }
          if (suggestion && (event.key === "Tab" || event.key === "Enter") && !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey) {
            // Tab 或 Enter 只把预测填进输入框，看清、改完再按 Enter 才会发送，空输入框里的 Enter 不会替用户发出没确认过的内容。
            event.preventDefault();
            setText(suggestion);
            return;
          }
          if (event.key === "Enter") {
            event.preventDefault();
            if (event.shiftKey) document.execCommand("insertLineBreak");
            else void submit(event.metaKey || event.ctrlKey);
          }
        }}
      />
      {suggestion ? (
        <>
          <span className="composer-prediction-hint" aria-hidden="true" title={tr("Tab 或 Enter 填入输入框，再按 Enter 发送", "Tab or Enter to fill the input, then Enter to send")}>Tab</span>
          <span className="visually-hidden" id={`${promptId}-suggestion`} role="status">{tr("建议的消息：", "Suggested message: ")}{suggestion}{tr("。按 Tab 或 Enter 填入输入框。", ". Press Tab or Enter to fill the input.")}</span>
        </>
      ) : null}
    </div>
  );

  const attachMenu = (
    <AttachMenu onAttachments={addAttachments} disabled={disabled} />
  );

  const modeChip = (
    <ModeChip mode={mode} disabled={disabled || streaming || recipeActive} onChange={onMode}
      race={raceActions && workspacePath && window.vela?.races && modelReady ? { onStart: () => setRaceOpen(true), onShow: raceActions.open, count: raceActions.count } : undefined} />
  );

  const sandboxPill = (
    <SandboxPill project={project} conversationMode={sandboxMode} />
  );

  const modelControls = (
    <ModelControls
      modelLabel={model ?? null}
      modelProvider={modelProvider}
      modelId={modelId}
      thinkingLevel={thinkingLevel}
      thinkingLevels={thinkingLevels}
      disabled={streaming || recipeActive}
      catalog={models.catalog}
      catalogError={models.catalogError}
      actionError={models.actionError}
      hiddenModels={hiddenModels}
      login={models.login}
      onSelect={models.select}
      onThinking={models.setThinking}
      fullAccess={sandboxMode ? undefined : { mode: project.sandboxMode, onEnable: () => project.setSandboxMode("full") }}
      onAdd={models.add}
      onRemove={models.remove}
      onLogout={models.logout}
      onLogin={models.loginProvider}
      onReplyLogin={models.replyLogin}
      onCancelLogin={models.cancelLogin}
      onDismissLogin={models.dismissLogin}
      openRequest={modelOpenRequest}
    />
  );

  const actions = (
    <ComposerActions sendButtonIcon={sendButtonIcon} streaming={streaming} sendHint={sendHint} steerHint={steerHint}
      canQueue={Boolean(prompt) || hasReplyText} disabled={disabled || recipeActive || !modelReady || (!prompt && !hasReplyText && !suggestion)}
      onSteer={() => void submit(true)} onAbort={onAbort} />
  );

  // 新对话没有任何统计可看（占用只有系统提示），整组不显示。
  const showStats = !showSetupControls;
  const stats = showStats ? (
    <ComposerStatsRow usage={usage} contextPopover={contextPopover} />
  ) : null;

  // 胶囊布局里提示放在胶囊外侧，不占用输入框内部空间。
  const queueHint = streaming && !recipeActive ? (
    <p className="composer-queue-hint">
      {trf("Enter 排队 · {0}Enter 调整当前任务", "Enter queues · {0}Enter steers the current task", modifier)}
    </p>
  ) : null;

  const quoteCard = replies.length > 0 ? (
    <div className="reply-quote-row">
      {replies.map((reply) => {
        const element = isElementReply(reply);
        const track = tracking.get(reply.id);
        const stale = element && (!track || track.status === "stale");
        const label = element ? reply.data.element.selector : reply.quote;
        return (
          <div className={`reply-quote-card${element ? " is-element" : ""}${stale ? " is-stale" : ""}`} key={reply.id}>
            <span className="reply-quote-bar" aria-hidden="true" />
            {element && !stale ? (
              <button type="button" className="reply-quote-text reply-quote-locate" title={label}
                onClick={() => onFocusReply?.(reply.id)}>{replyCardText(reply)}</button>
            ) : (
              <p className="reply-quote-text" title={label}>{replyCardText(reply)}</p>
            )}
            <span className="reply-quote-badge">
              {element ? trf("批注 {0}", "Note {0}", elementNumber(replies, reply.id)) : tr("回复", "Reply")}
            </span>
            {stale && <span className="reply-quote-note">{tr("元素已不在页面上，仍会发送文字和元素描述", "The element is gone. The note is still sent with its description")}</span>}
            {element && !stale && track?.shot === "failed" && <span className="reply-quote-note">{tr("未能截图", "Screenshot unavailable")}</span>}
            <button
              type="button"
              className="reply-quote-remove"
              title={element ? tr("移除批注", "Remove note") : tr("移除回复", "Remove reply")}
              aria-label={element ? tr("移除批注", "Remove note") : tr("移除回复", "Remove reply")}
              onClick={() => { onRemoveReply?.(reply.id); inputRef.current?.focus(); }}
            >
              <CloseIcon size={10} />
            </button>
          </div>
        );
      })}
    </div>
  ) : null;

  const above = (
    <>
      {approvalSlots}
      {layout === "capsule" ? null : statusBar}
      {skillMenu}
      {statusPanel}
      {instructionRow}
      {layout === "capsule" ? null : queueHint}
      {quoteCard}
      {attachmentRow}
    </>
  );

  return (
    <div className="chat-dock-wrapper" ref={ref}>
      <form
        className={`floating-input-card${layout === "capsule" ? " layout-capsule" : ""}${dragging ? " dragging" : ""}`}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        onDragEnter={(event) => {
          event.preventDefault();
          dragCounter.current += 1;
          setDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => {
          dragCounter.current -= 1;
          if (dragCounter.current <= 0) setDragging(false);
        }}
        onDrop={(event) => void handleDrop(event)}
      >
        {layout === "capsule" ? (
          <>
            {statusBar}
            {queueHint}
            <div className="composer-capsule">
              {above}
              <div className="composer-capsule-main">
                {attachMenu}
                {entry}
                {actions}
              </div>
            </div>
            <div className="composer-tray">
              <div className="composer-tray-left">
                <div className="composer-tray-chips">
                  {modeChip}
                  {sandboxPill}
                </div>
              </div>
              <div className="composer-tray-right">
                {showStats ? <ComposerStatsRow usage={usage} contextPopover={contextPopover} /> : null}
                {modelControls}
              </div>
            </div>
          </>
        ) : (
          <>
            {above}
            {entry}
            <div className="dock-controls-row">
              <div className="dock-controls-left">
                {attachMenu}
                {modeChip}
                {sandboxPill}
              </div>
              <div className="dock-controls-right">
                {modelControls}
                {actions}
              </div>
            </div>
            {stats}
          </>
        )}
      </form>
      {raceOpen && raceActions && workspacePath ? (
        <RaceSetupDialog workspace={workspacePath} initialPrompt={prompt} models={models}
          onClose={() => setRaceOpen(false)}
          onStarted={race => { setRaceOpen(false); clearEditor(); raceActions.started(race); }} />
      ) : null}
    </div>
  );
});

const attachmentIds = new WeakMap<FileAttachmentPayload, string>();
let nextAttachmentId = 0;
function attachmentKey(entry: FileAttachmentPayload): string {
  let id = attachmentIds.get(entry);
  if (!id) { id = `attachment-${++nextAttachmentId}`; attachmentIds.set(entry, id); }
  return id;
}

function ComposerActions({ sendButtonIcon, streaming, sendHint, steerHint, canQueue, disabled, onSteer, onAbort }: {
  sendButtonIcon: SendButtonIcon;
  streaming: boolean; sendHint: string; steerHint: string; canQueue: boolean; disabled: boolean;
  onSteer: () => void; onAbort: () => Promise<void>;
}) {
  const steerButton = streaming && canQueue
    ? <button className="composer-steer-btn" type="button" title={steerHint}
        aria-label={steerHint} disabled={disabled} onClick={onSteer}><SteerIcon /></button>
    : null;
  return <span className={`composer-action-slot${streaming ? " is-streaming" : ""}${steerButton ? " has-instruction" : ""}`}>
    {steerButton}
    <span className="composer-action-stack">
      <button className={`send-action-blue-btn send${sendButtonIcon === "arrow-up" ? " send-icon-arrow-up" : ""}`} type="submit" title={sendHint}
        aria-label={streaming ? tr("排队发送", "Queue") : tr("发送", "Send")} disabled={disabled}
        inert={streaming && !canQueue} aria-hidden={streaming && !canQueue} tabIndex={streaming && !canQueue ? -1 : undefined}>
        {sendButtonIcon === "arrow-up" ? <ArrowUpIcon size={15} /> : <SendIcon />}
      </button>
      <button className="send-action-blue-btn stop" type="button"
        title={tr("停止生成", "Stop generating")} aria-label={tr("停止生成", "Stop generating")}
        inert={!streaming} aria-hidden={!streaming} tabIndex={streaming ? undefined : -1}
        disabled={!streaming} onClick={() => void onAbort()}>
        <span className="stop-square" />
      </button>
    </span>
  </span>;
}

function placeholderFor(mode: InteractionMode): string {
  if (mode === "plan") return tr("描述你想规划的改动", "Describe the change you want to plan");
  if (mode === "goal") return tr("描述要达成的目标", "Describe the goal you want to achieve");
  return tr("随心输入", "Ask anything or describe a task");
}

const maxPastedImages = 6;
const maxAttachments = 12;
/** 服务端对一条消息图片数量的上限。 */
const maxMessageImages = 10;
/** 转码时限制长边，避免超大图在 base64 传输与模型侧被拒。 */
const maxTranscodeEdge = 4096;
const maxTranscodedBytes = 9 * 1024 * 1024;

type DecodedImage = ImageBitmap | HTMLImageElement;

interface PreparedPastedImage {
  payload: FileAttachmentPayload;
  /** 原始字节摘要，用于批内去重。 */
  fingerprint: string;
}

interface TranscodedImage {
  bytes: Uint8Array;
  data: string;
  mimeType: string;
}

/** 主进程最终只接受这四种格式，这里按字节判断，不信任剪贴板给的 MIME。 */
function detectImageMimeType(bytes: Uint8Array): string | null {
  const startsWith = (prefix: readonly number[]) =>
    prefix.every((value, index) => bytes[index] === value);
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  const signature = String.fromCharCode(...bytes.subarray(0, 6));
  if (signature === "GIF87a" || signature === "GIF89a") return "image/gif";
  if (signature.startsWith("RIFF") && String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP") {
    return "image/webp";
  }
  return null;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

async function digestBytes(bytes: Uint8Array): Promise<string> {
  try {
    // 这里的字节都来自完整的 ArrayBuffer，不会是 SharedArrayBuffer。
    const digest = await crypto.subtle.digest("SHA-256", bytes.buffer as ArrayBuffer);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch {
    return "";
  }
}

async function decodeImage(blob: Blob): Promise<DecodedImage | null> {
  try {
    return await createImageBitmap(blob);
  } catch {
    // 个别格式（如带固有尺寸的 SVG）走 <img> 更稳，交给下面的回退路径。
  }
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    image.src = url;
  });
}

function closeDecodedImage(source: DecodedImage | null): void {
  if (source && typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap) {
    source.close();
  }
}

function imageSize(source: DecodedImage): { width: number; height: number } {
  if (source instanceof HTMLImageElement) {
    return { width: source.naturalWidth, height: source.naturalHeight };
  }
  return { width: source.width, height: source.height };
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), type, quality);
    } catch {
      // 画布被跨域资源污染时 toBlob 会直接抛错。
      resolve(null);
    }
  });
}

/** 把 Chromium 能解码、但模型不接受的格式统一转成 PNG（过大再退 JPEG）。 */
async function transcodeImage(source: DecodedImage): Promise<TranscodedImage | null> {
  const { width, height } = imageSize(source);
  if (!width || !height) return null;
  const scale = Math.min(1, maxTranscodeEdge / Math.max(width, height));
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(source, 0, 0, targetWidth, targetHeight);
  let blob = await canvasToBlob(canvas, "image/png");
  if (blob && blob.size > maxTranscodedBytes) {
    // PNG 太大时压成 JPEG；先铺白底，避免透明区域变黑。
    context.globalCompositeOperation = "destination-over";
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, targetWidth, targetHeight);
    const jpeg = await canvasToBlob(canvas, "image/jpeg", 0.9);
    if (jpeg && jpeg.size < blob.size) blob = jpeg;
  }
  if (!blob || blob.size === 0 || blob.size > maxTranscodedBytes) return null;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const mimeType = detectImageMimeType(bytes);
  if (!mimeType) return null;
  return { bytes, data: toBase64(bytes), mimeType };
}

/** 读取剪贴板里的一个文件，返回可直接发送的图片附件；无法解码时返回 null。 */
async function preparePastedImage(file: File): Promise<PreparedPastedImage | null> {
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return null;
  }
  if (bytes.byteLength === 0) return null;
  const name = file.name || tr("粘贴的图片", "Pasted image");
  const detected = detectImageMimeType(bytes);
  if (detected) {
    return {
      payload: { path: "", name, kind: "image", image: { type: "image", data: toBase64(bytes), mimeType: detected } },
      fingerprint: await digestBytes(bytes),
    };
  }
  // 剪贴板给出的可能是 TIFF/BMP/SVG 等模型不支持的格式，统一转成 PNG/JPEG。
  const decoded = await decodeImage(file);
  if (!decoded) return null;
  const transcoded = await transcodeImage(decoded);
  closeDecodedImage(decoded);
  if (!transcoded) return null;
  return {
    payload: {
      path: "",
      name,
      kind: "image",
      image: { type: "image", data: transcoded.data, mimeType: transcoded.mimeType },
    },
    fingerprint: await digestBytes(transcoded.bytes),
  };
}
