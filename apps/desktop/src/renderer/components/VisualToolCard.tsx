import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  buildVisualSandboxDocument,
  clampVisualHeight,
  parseVisualSandboxMessage,
  uiSandboxAttribute,
  visualDemoLimits,
  type ToolTrace,
  type VisualDemo,
} from "@vela/shared";
import { createLogger } from "../logger";
import { localizeError, tr, trf } from "../locale";
import { ChevronDownIcon, CloseIcon, CodeIcon, ExpandIcon, VisualIcon } from "./icons";
import { foldRowId } from "./tool-fold-state";
import { useToolExpanded } from "./ToolProcessContext";
import { Icon } from "./icons/Icon";

const log = createLogger("visual-demo");

const syncedThemeVars = [
  "--bg-chat",
  "--bg-card-surface",
  "--bg-surface-subtle",
  "--bg-elevated",
  "--bg-code",
  "--bg-hover",
  "--border-subtle",
  "--border-strong",
  "--text-primary",
  "--text-secondary",
  "--text-muted",
  "--text-dim",
  "--accent-blue",
  "--accent-blue-hover",
  "--accent-contrast",
  "--success",
  "--danger",
  "--warning",
  "--violet",
  "--font-sans",
  "--font-mono",
  "--radius-xs",
  "--radius-sm",
  "--radius-md",
  "--radius-lg",
  "--radius-pill",
] as const;

interface VisualThemeSnapshot {
  colorScheme: "light" | "dark";
  themeVars: Record<string, string>;
}

function readThemeSnapshot(): VisualThemeSnapshot {
  if (typeof document === "undefined") return { colorScheme: "light", themeVars: {} };
  const root = document.documentElement;
  const computed = getComputedStyle(root);
  const themeVars: Record<string, string> = {};
  for (const name of syncedThemeVars) {
    const value = computed.getPropertyValue(name).trim();
    if (value) themeVars[name] = value;
  }
  const colorScheme = root.dataset.scheme === "dark" ? "dark" : "light";
  return { colorScheme, themeVars };
}

function useVisualTheme(): VisualThemeSnapshot {
  const [theme, setTheme] = useState<VisualThemeSnapshot>(() => readThemeSnapshot());

  useEffect(() => {
    if (typeof document === "undefined") return;
    const update = () => setTheme(readThemeSnapshot());
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-scheme", "data-theme", "style", "data-ui-font-latin", "data-ui-font-cjk"],
    });
    return () => observer.disconnect();
  }, []);

  return theme;
}

/**
 * Isolated visual frame used inline in the conversation stream and in the fullscreen modal.
 * Never executes arbitrary capabilities or shares parent DOM; only listens for postMessage resize/error events.
 */
function VisualSandboxFrame({
  doc,
  title,
  initialHeight,
  mode,
  onTooManyErrors,
}: {
  doc: string;
  title: string;
  initialHeight: number;
  mode: "inline" | "modal";
  onTooManyErrors: () => void;
}) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [height, setHeight] = useState(() => clampVisualHeight(initialHeight));

  useEffect(() => {
    setHeight(clampVisualHeight(initialHeight));
  }, [doc, initialHeight]);

  useEffect(() => {
    let errorCount = 0;
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      const msg = parseVisualSandboxMessage(event.data);
      if (!msg) return;
      if (msg.type === "resize") {
        setHeight(msg.height);
        return;
      }
      if (msg.type === "error") {
        errorCount += 1;
        log.warn("visual sandbox script error", { message: msg.message });
        if (errorCount > visualDemoLimits.maxErrors) onTooManyErrors();
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [doc, onTooManyErrors]);

  return (
    <iframe
      ref={frameRef}
      className={mode === "modal" ? "visual-tool-iframe is-modal" : "visual-tool-iframe"}
      sandbox={uiSandboxAttribute}
      srcDoc={doc}
      title={title}
      referrerPolicy="no-referrer"
      allow=""
      style={mode === "inline" ? { height: `${height}px` } : undefined}
    />
  );
}

function VisualModal({
  visual,
  doc,
  onClose,
  onTooManyErrors,
  scriptFailed,
}: {
  visual: VisualDemo;
  doc: string;
  onClose: () => void;
  onTooManyErrors: () => void;
  scriptFailed: boolean;
}) {
  const [showCode, setShowCode] = useState(scriptFailed);
  const [copied, setCopied] = useState(false);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const label = visual.title || tr("可视化视图", "Made a visual");

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      previousFocusRef.current?.focus();
    };
  }, [onClose]);

  const copyHtml = useCallback(() => {
    void navigator.clipboard.writeText(visual.html).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    }, () => undefined);
  }, [visual.html]);

  return createPortal(
    <div
      className="visual-modal-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="visual-modal-dialog" role="dialog" aria-modal="true" aria-label={label}>
        <div className="visual-modal-head">
          <div className="visual-modal-title-group">
            <span className="visual-tool-icon" aria-hidden="true">
              <VisualIcon size={14} />
            </span>
            <span className="visual-tool-label">{tr("可视化视图", "Made a visual")}</span>
            {visual.title ? <span className="visual-tool-title">{visual.title}</span> : null}
          </div>
          <div className="visual-tool-actions">
            <button
              type="button"
              className={`visual-tool-action-btn${showCode ? " is-active" : ""}`}
              aria-pressed={showCode}
              title={showCode ? tr("查看效果", "Preview") : tr("查看 HTML 源码", "View HTML source")}
              onClick={() => setShowCode((value) => !value)}
            >
              <CodeIcon size={13} />
              <span>{showCode ? tr("预览", "Preview") : "HTML"}</span>
            </button>
            <button
              type="button"
              className="visual-tool-action-btn"
              title={tr("复制 HTML", "Copy HTML")}
              onClick={copyHtml}
            >
              {copied ? <Icon name="check" size={14} /> : <Icon name="copy" size={14} />}
              <span>{copied ? tr("已复制", "Copied") : tr("复制", "Copy")}</span>
            </button>
            <button
              ref={closeRef}
              type="button"
              className="visual-tool-icon-btn"
              aria-label={tr("关闭", "Close")}
              onClick={onClose}
            >
              <CloseIcon size={14} />
            </button>
          </div>
        </div>
        <div className="visual-modal-body">
          {showCode ? (
            <pre className="visual-tool-code"><code>{visual.html}</code></pre>
          ) : (
            <VisualSandboxFrame
              doc={doc}
              title={label}
              initialHeight={visual.height ?? visualDemoLimits.defaultHeight}
              mode="modal"
              onTooManyErrors={onTooManyErrors}
            />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Renders a self-contained HTML/CSS/SVG mockup generated by `show_visual` inline in the stream.
 * Never joins tool fold runs so visual designs remain immediately scannable alongside prose.
 */
export const VisualToolCard = memo(function VisualToolCard({ tool }: { tool: ToolTrace }) {
  const visual = tool.activity?.visual ?? null;
  const [open, setOpen] = useToolExpanded(foldRowId(tool.id), true, true);
  const [showCode, setShowCode] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [scriptFailed, setScriptFailed] = useState(false);
  const bodyId = useId();
  const theme = useVisualTheme();

  useEffect(() => {
    setScriptFailed(false);
  }, [visual?.html]);

  const doc = useMemo(() => {
    if (!visual) return "";
    return buildVisualSandboxDocument(visual.html, theme);
  }, [visual, theme]);

  const handleTooManyErrors = useCallback(() => {
    setScriptFailed(true);
  }, []);

  const lineCount = tool.activity?.streaming?.added;
  const labelText = tr("可视化视图", "Made a visual");
  const titleText = visual?.title || (tool.activity?.body?.trim() ? tool.activity.body.trim() : "");
  const frameTitle = titleText ? `${labelText}: ${titleText}` : labelText;
  const running = tool.status === "running";
  const failed = tool.status === "error" && !visual;

  return (
    <div className={`visual-tool-card${open ? " is-open" : ""}`} data-visual-status={tool.status}>
      <div className="visual-tool-head">
        <button
          type="button"
          className="visual-tool-heading"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((value) => !value)}
        >
          <span className="visual-tool-label">{labelText}</span>
          {titleText && !failed ? <span className="visual-tool-title">{titleText}</span> : null}
          {running && !visual && lineCount ? (
            <span className="visual-tool-stream-meta">{trf("{0} 行", "{0} lines", lineCount)}</span>
          ) : null}
        </button>
        <div className="visual-tool-controls">
          {visual ? (
            <>
              <button
                type="button"
                className="visual-tool-icon-btn"
                aria-label={tr("放大查看", "Expand visual")}
                title={tr("放大查看", "Expand visual")}
                onClick={() => setModalOpen(true)}
              >
                <ExpandIcon size={12} />
              </button>
              <button
                type="button"
                className={`visual-tool-icon-btn${showCode ? " is-active" : ""}`}
                aria-label={tr("查看 HTML 源码", "View HTML source")}
                aria-pressed={showCode}
                title={tr("查看 HTML 源码", "View HTML source")}
                onClick={() => {
                  setShowCode((value) => !value);
                  if (!open) setOpen(true);
                }}
              >
                <CodeIcon size={12} />
              </button>
            </>
          ) : null}
          <button
            type="button"
            className="visual-tool-icon-btn visual-tool-chevron"
            aria-label={open ? tr("收起", "Collapse") : tr("展开", "Expand")}
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={() => setOpen((value) => !value)}
          >
            <ChevronDownIcon size={12} />
          </button>
        </div>
      </div>

      {open ? (
        <div id={bodyId} className="visual-tool-surface">
          {failed ? (
            <div className="visual-tool-message is-error">
              {localizeError(tool.activity?.body || tr("视图生成失败。", "Failed to render visual."))}
            </div>
          ) : !visual ? (
            <div className="visual-tool-placeholder">
              <span className="tool-spinner" role="status" aria-label={tr("生成视图中", "Generating visual")} />
              <span>{tr("正在绘制界面视图…", "Drawing visual preview…")}</span>
            </div>
          ) : scriptFailed ? (
            <div className="visual-tool-message is-error">
              <span>{tr("视图内脚本错误过多，已停止预览。", "Preview stopped because the visual script threw too many errors.")}</span>
              <button type="button" className="visual-tool-inline-link" onClick={() => setShowCode(true)}>
                {tr("查看 HTML", "View HTML")}
              </button>
            </div>
          ) : showCode ? (
            <pre className="visual-tool-code"><code>{visual.html}</code></pre>
          ) : (
            <VisualSandboxFrame
              doc={doc}
              title={frameTitle}
              initialHeight={visual.height ?? visualDemoLimits.defaultHeight}
              mode="inline"
              onTooManyErrors={handleTooManyErrors}
            />
          )}
        </div>
      ) : null}

      {modalOpen && visual ? (
        <VisualModal
          visual={visual}
          doc={doc}
          onClose={() => setModalOpen(false)}
          onTooManyErrors={handleTooManyErrors}
          scriptFailed={scriptFailed}
        />
      ) : null}
    </div>
  );
});
