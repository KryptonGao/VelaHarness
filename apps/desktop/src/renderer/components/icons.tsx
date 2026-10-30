interface IconProps {
  size?: number;
  filled?: boolean;
}

export function ChatIcon({ size = 13 }: IconProps) {
  return <svg {...base(size)} aria-hidden="true"><path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-2 2v-10A8.5 8.5 0 0 1 10.5 3h2a8.5 8.5 0 0 1 8.5 8.5Z" /><path d="M7 9h9M7 14h6" /></svg>;
}

export function ClockIcon({ size = 13, filled = false }: IconProps) {
  if (filled) return <svg {...base(size)} fill="currentColor" stroke="none"><path fillRule="evenodd" d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm-.8 3.5v5.9l3.4 2.3.9-1.4-2.7-1.8v-5Z" /></svg>;
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
}

/** Agent Inbox：带托盘的收件箱。 */
export function InboxIcon({ size = 13, filled = false }: IconProps) {
  if (filled) return <svg {...base(size)} fill="currentColor" stroke="none"><path fillRule="evenodd" d="M7.4 4a2.3 2.3 0 0 0-2.2 1.6l-2.5 7.7v4.4A2.3 2.3 0 0 0 5 20h14a2.3 2.3 0 0 0 2.3-2.3v-4.4l-2.5-7.7A2.3 2.3 0 0 0 16.6 4Zm0 1.6h9.2a.7.7 0 0 1 .7.5l2.1 6.6h-4.9v.8a2.5 2.5 0 0 1-5 0v-.8H4.6l2.1-6.6a.7.7 0 0 1 .7-.5Z" /></svg>;
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3.5 13.5 6 5.8A1.5 1.5 0 0 1 7.4 4.8h9.2a1.5 1.5 0 0 1 1.4 1l2.5 7.7" /><path d="M3.5 13.5v4.2a1.5 1.5 0 0 0 1.5 1.5h14a1.5 1.5 0 0 0 1.5-1.5v-4.2h-5.2a3.3 3.3 0 0 1-6.6 0z" /></svg>;
}

/** 检查点：逆时针箭头绕着时钟，表示回到之前的某个时间点。 */
export function HistoryIcon({ size = 13 }: IconProps) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 2.64-6.36L3 8.3" /><path d="M3 3.5v4.8h4.8" /><path d="M12 7.5V12l3 2" /></svg>;
}

export function GlobeIcon({ size = 13 }: IconProps) {
  return <svg {...base(size)} aria-hidden="true"><circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3a18 18 0 0 1 0 18 18 18 0 0 1 0-18" /></svg>;
}

/** 元素批注：虚线选框加一个批注气泡。 */
export function AnnotateIcon({ size = 13 }: IconProps) {
  return <svg {...base(size)} aria-hidden="true"><path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M4 15v4a1 1 0 0 0 1 1h4" strokeDasharray="0.1 0" />
    <path d="M12 20h7a1 1 0 0 0 1-1v-6a1 1 0 0 0-1-1h-5l-3 3v4a1 1 0 0 0 1 1Z" /></svg>;
}

export function ArrowLeftIcon({ size = 13 }: IconProps) {
  return <svg {...base(size)} aria-hidden="true"><path d="m12 5-7 7 7 7M5 12h14" /></svg>;
}

function base(size: number) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
  };
}

export function FolderIcon({ size = 13 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

export function MonitorIcon({ size = 13 }: IconProps) {
  return (
    <svg {...base(size)}>
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  );
}

export function BranchIcon({ size = 13 }: IconProps) {
  return (
    <svg {...base(size)}>
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  );
}

/** 子代理专用图标：一个父 agent 节点挂出两个子代理节点，跟通用工具图标区分开。 */
export function SubagentIcon({ size = 13 }: IconProps) {
  return (
    <svg {...base(size)}>
      <rect x="8.5" y="3" width="7" height="7" rx="1.8" />
      <rect x="3" y="14" width="7" height="7" rx="1.8" />
      <rect x="14" y="14" width="7" height="7" rx="1.8" />
      <path d="M12 10v2" />
      <path d="M6.5 14v-2h11v2" />
    </svg>
  );
}

export function ShieldIcon({ size = 13 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

export function PlusIcon({ size = 14 }: IconProps) {
  return (
    <svg {...base(size)}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

export function ExternalIcon({ size = 13 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

export function ChevronDownIcon({ size = 12 }: IconProps) {
  return (
    <svg {...base(size)}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

export function GithubIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true">
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.55 0-.27-.01-1.17-.02-2.12-3.2.7-3.87-1.36-3.87-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.76 2.69 1.25 3.35.96.1-.75.4-1.25.72-1.54-2.55-.29-5.23-1.28-5.23-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.1 11.1 0 0 1 5.8 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.12 3.05.74.81 1.18 1.83 1.18 3.09 0 4.41-2.69 5.38-5.25 5.67.41.35.77 1.05.77 2.12 0 1.53-.01 2.76-.01 3.14 0 .3.2.67.8.55A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5z" />
    </svg>
  );
}

export function SearchIcon({ size = 13 }: IconProps) {
  return (
    <svg {...base(size)}>
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.5" y2="16.5" />
    </svg>
  );
}

export function GridIcon({ size = 13 }: IconProps) {
  return (
    <svg {...base(size)}>
      <circle cx="5.5" cy="5.5" r="1.6" />
      <circle cx="12" cy="5.5" r="1.6" />
      <circle cx="18.5" cy="5.5" r="1.6" />
      <circle cx="5.5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="18.5" cy="12" r="1.6" />
    </svg>
  );
}

export function ChevronRightIcon({ size = 12 }: IconProps) {
  return (
    <svg {...base(size)} aria-hidden="true">
      <polyline points="9 6 15 12 9 18" />
    </svg>
  );
}

/** 右侧带面板的窗口图标,用来切换右侧文件树。 */
export function PanelRightIcon({ size = 13 }: IconProps) {
  return (
    <svg {...base(size)} aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <line x1="15" y1="4" x2="15" y2="20" />
    </svg>
  );
}

export function MoreIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true">
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </svg>
  );
}

export function CloseIcon({ size = 13 }: IconProps) {
  return (
    <svg {...base(size)}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

export function PauseIcon({ size = 13 }: IconProps) {
  return (
    <svg {...base(size)}>
      <line x1="9" y1="5" x2="9" y2="19" />
      <line x1="15" y1="5" x2="15" y2="19" />
    </svg>
  );
}

export function PlayIcon({ size = 13 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M7 4.5v15l12-7.5-12-7.5Z" />
    </svg>
  );
}

export function StopSquareIcon({ size = 13 }: IconProps) {
  return (
    <svg {...base(size)}>
      <rect x="6" y="6" width="12" height="12" rx="1.5" />
    </svg>
  );
}

export function ArrowUpIcon({ size = 11 }: IconProps) {
  return (
    <svg {...base(size)}>
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="5 12 12 5 19 12" />
    </svg>
  );
}

export function ArrowDownIcon({ size = 11 }: IconProps) {
  return (
    <svg {...base(size)}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <polyline points="19 12 12 19 5 12" />
    </svg>
  );
}

export function SendIcon({ size = 15 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
      <path d="M22 2L11 13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}

/** 调整当前任务:在运行中追加约束/纠正方向,比排队更早生效。 */
export function SteerIcon({ size = 14 }: IconProps) {
  return (
    <svg {...base(size)} aria-hidden="true">
      <path d="M4 8h16M4 16h16" />
      <circle cx="9" cy="8" r="2.4" fill="currentColor" stroke="none" />
      <circle cx="15" cy="16" r="2.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function CheckIcon({ size = 13 }: IconProps) {
  return (
    <svg {...base(size)}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

/** 执行清单里的待办图标：空心圆。 */
export function CircleIcon({ size = 11 }: IconProps) {
  return (
    <svg {...base(size)}>
      <circle cx="12" cy="12" r="8" />
    </svg>
  );
}

/** 执行清单里的进行中图标：向右的箭头。 */
export function ArrowRightIcon({ size = 11 }: IconProps) {
  return (
    <svg {...base(size)}>
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
}

export function CopyIcon({ size = 13 }: IconProps) {
  return (
    <svg {...base(size)}>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

export function ImageIcon({ size = 13 }: IconProps) {
  return (
    <svg {...base(size)}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  );
}

export function TerminalIcon({ size = 13 }: IconProps) {
  return (
    <svg {...base(size)}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <polyline points="7 9 10 12 7 15" />
      <line x1="12" y1="15" x2="17" y2="15" />
    </svg>
  );
}

export function McpIcon({ size = 13 }: IconProps) {
  return (
    <svg {...base(size)} aria-hidden="true">
      <path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0V8ZM12 17v4" />
    </svg>
  );
}

export function ToolIcon({ size = 13 }: IconProps) {
  return (
    <svg {...base(size)} aria-hidden="true">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76Z" />
    </svg>
  );
}

/** 待办清单：一个已勾选的方框加两行条目。 */
export function TodoListIcon({ size = 13 }: IconProps) {
  return (
    <svg {...base(size)} aria-hidden="true">
      <path d="m3.5 6.5 1.7 1.7 3-3.4" />
      <path d="M12 7h8.5" />
      <rect x="3.5" y="13.5" width="4.8" height="4.8" rx="1" />
      <path d="M12 16h8.5" />
    </svg>
  );
}

/** 交付结果：一面旗帜。 */
export function OutcomeIcon({ size = 13 }: IconProps) {
  return (
    <svg {...base(size)} aria-hidden="true">
      <path d="M5 21V4" />
      <path d="M5 4h12l-2.5 4 2.5 4H5" />
    </svg>
  );
}

/** 发送消息：纸飞机。 */
export function SendMessageIcon({ size = 13 }: IconProps) {
  return (
    <svg {...base(size)} aria-hidden="true">
      <path d="M21 3 10.5 13.5" />
      <path d="M21 3l-6.5 18-4-7.5L3 9.5 21 3Z" />
    </svg>
  );
}

/** 追加任务：一支向右拐的回复箭头。 */
export function FollowupTaskIcon({ size = 13 }: IconProps) {
  return (
    <svg {...base(size)} aria-hidden="true">
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10a6 6 0 0 1 6 6v5" />
    </svg>
  );
}

function CalendarFrame() {
  return (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  );
}

/** 定时任务四个动作：同一块日历，里面的符号区分创建、查询、修改、删除。 */
export function ScheduleCreateIcon({ size = 13 }: IconProps) {
  return <svg {...base(size)} aria-hidden="true"><CalendarFrame /><path d="M12 12.6v5.2M9.4 15.2h5.2" /></svg>;
}

export function ScheduleListIcon({ size = 13 }: IconProps) {
  return <svg {...base(size)} aria-hidden="true"><CalendarFrame /><path d="M8.5 13h7M8.5 16.6h4.6" /></svg>;
}

export function ScheduleUpdateIcon({ size = 13 }: IconProps) {
  return <svg {...base(size)} aria-hidden="true"><CalendarFrame /><path d="m9.6 17.6.5-2.3 3.9-3.9 1.8 1.8-3.9 3.9-2.3.5Z" /></svg>;
}

export function ScheduleDeleteIcon({ size = 13 }: IconProps) {
  return <svg {...base(size)} aria-hidden="true"><CalendarFrame /><path d="m9.7 12.9 4.6 4.6M14.3 12.9l-4.6 4.6" /></svg>;
}

/** 读取记忆：翻开的书。 */
export function MemoryReadIcon({ size = 13 }: IconProps) {
  return (
    <svg {...base(size)} aria-hidden="true">
      <path d="M12 6.5v13" />
      <path d="M12 6.5C10.5 5 8 4.5 3.5 4.5v13c4.5 0 7 .5 8.5 2 1.5-1.5 4-2 8.5-2v-13c-4.5 0-7 .5-8.5 2Z" />
    </svg>
  );
}

/** 更新记忆：合上的书，封面上一个加号。 */
export function MemoryUpdateIcon({ size = 13 }: IconProps) {
  return (
    <svg {...base(size)} aria-hidden="true">
      <path d="M5 19.5V5a2 2 0 0 1 2-2h12v15H7a2 2 0 0 0-2 2Zm0 0A2 2 0 0 0 7 21.5h12V18" />
      <path d="M13 6.8v5.4M10.3 9.5h5.4" />
    </svg>
  );
}

/** 网页搜索：放大镜里带一个经纬线地球。 */
export function WebSearchIcon({ size = 13 }: IconProps) {
  return (
    <svg {...base(size)} aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="7" />
      <path d="M3.5 10.5h14M10.5 3.5a10 10 0 0 1 0 14 10 10 0 0 1 0-14" />
      <path d="m15.8 15.8 5.2 5.2" />
    </svg>
  );
}

/** 网页抓取：浏览器窗口里一支向下的箭头，表示把页面取回来。 */
export function WebFetchIcon({ size = 13 }: IconProps) {
  return (
    <svg {...base(size)} aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18" />
      <path d="M12 12v5.5M9.5 15l2.5 2.5 2.5-2.5" />
    </svg>
  );
}

/** 读取文件：正常摊开的书，左侧一张书页半翻起。 */
export function ReadFileIcon({ size = 13 }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth="1.5" aria-hidden="true">
      <path d="M12 7c2.5-1.5 5.5-2 9-2v14c-3.5 0-6.5.5-9 2-2.5-1.5-5.5-2-9-2V5h3" />
      <path d="M12 21V7C10.5 5 8.5 3.8 6 3v14c2.5.8 4.5 2 6 4" />
    </svg>
  );
}

export function EyeIcon({ size = 13 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function PencilIcon({ size = 13 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  );
}

/** 编辑文件:单只铅笔,笔身较宽,斜放笔尖朝左下,只有笔帽处一道横线。 */
export function EditFileIcon({ size = 13 }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={1.6}>
      <g transform="translate(12 12) scale(1.35) rotate(45) translate(-12 -12)">
        <path d="M8.5 4.5a1.5 1.5 0 0 1 1.5-1.5h4a1.5 1.5 0 0 1 1.5 1.5V16L12 21.5 8.5 16z" />
        <path d="M8.5 7.5h7" />
      </g>
    </svg>
  );
}

export function FilePlusIcon({ size = 13 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="12" y1="18" x2="12" y2="12" />
      <line x1="9" y1="15" x2="15" y2="15" />
    </svg>
  );
}

export function FileIcon({ size = 13 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

/** Git 变更图标:两块对比面板，右边一块带折角，暗示 diff。 */
export function DiffIcon({ size = 13 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3" />
      <path d="M16 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3" />
      <line x1="12" y1="2" x2="12" y2="22" />
    </svg>
  );
}

export function StackIcon({ size = 13 }: IconProps) {
  return (
    <svg {...base(size)}>
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 12 12 17 22 12" />
      <polyline points="2 17 12 22 22 17" />
    </svg>
  );
}

/** Plan / 方案文档图标：一颗小星，和工具类图标区分开。 */
export function PlanIcon({ size = 13 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M12 2.6l1.9 6.1 6.1 1.9-6.1 1.9L12 18.6l-1.9-6.1L4 10.6l6.1-1.9z" />
      <path d="M19 16.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z" />
    </svg>
  );
}

/** Goal 模式：靶心。 */
export function GoalIcon({ size = 13 }: IconProps) {
  return (
    <svg {...base(size)}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1" />
    </svg>
  );
}

/** 赛马：终点旗。 */
export function RaceIcon({ size = 13 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M5 21V4" />
      <path d="M5 4h12l-2.5 4L17 12H5" />
    </svg>
  );
}

export function SkillIcon({ size = 14 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M12.8 2.2a2 2 0 0 0-1.6 0L3 6.1a1 1 0 0 0 0 1.8l8.2 3.7a2 2 0 0 0 1.6 0L21 7.9a1 1 0 0 0 0-1.8Z" />
      <path d="M3 12l8.2 3.7a2 2 0 0 0 1.6 0L21 12" />
      <path d="M3 16.5l8.2 3.7a2 2 0 0 0 1.6 0L21 16.5" />
    </svg>
  );
}

/** 斜线命令图标：终端提示符 `>_`。 */
export function CommandIcon({ size = 14 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M5 7l5 5-5 5" />
      <path d="M13 18h6" />
    </svg>
  );
}

export function PrIcon({ size = 13 }: IconProps) {
  return (
    <svg {...base(size)}>
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="18" r="3" />
      <line x1="6" y1="9" x2="6" y2="15" />
      <path d="M18 15a9 9 0 0 0-9-6" />
    </svg>
  );
}

export function QuestionIcon({ size = 13 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
      <path d="M9.7 9.3a2.4 2.4 0 0 1 4.7.7c0 1.6-2.4 2-2.4 3.2" />
      <line x1="12" y1="16.4" x2="12" y2="16.5" />
    </svg>
  );
}

export function TrashIcon({ size = 13 }: IconProps) {
  return (
    <svg {...base(size)}>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}

export function SparkIcon({ size = 13 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="m12 3 1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2Z" />
      <path d="m19 15 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8Z" />
    </svg>
  );
}

export function ThinkingIcon({ size = 13 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M9 18h6M10 21.5h4" />
      <path d="M12 2.5a6.5 6.5 0 0 0-3.7 11.85c.45.32.7.8.7 1.35V16h6v-.3c0-.55.25-1.03.7-1.35A6.5 6.5 0 0 0 12 2.5Z" />
    </svg>
  );
}

export function RefreshIcon({ size = 13 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M21 12a9 9 0 1 1-2.6-6.4" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

export function CloudIcon({ size = 13 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M17.5 19a4.5 4.5 0 0 0 .5-9 6 6 0 0 0-11.6-1.6A4 4 0 0 0 6.5 19Z" />
      <path d="M12 12v6M9.5 14.5 12 12l2.5 2.5" />
    </svg>
  );
}

export function AlertIcon({ size = 13 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4M12 17h.01" />
    </svg>
  );
}

export function CommitIcon({ size = 13 }: IconProps) {
  return (
    <svg {...base(size)}>
      <circle cx="12" cy="12" r="4" />
      <path d="M1.5 12h6.5M16 12h6.5" />
    </svg>
  );
}

export function TagIcon({ size = 13 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M20.6 13.4 12 22l-9-9V4a1 1 0 0 1 1-1h9Z" />
      <circle cx="7.5" cy="7.5" r="1" />
    </svg>
  );
}

/* 会话视图标签专用的一套图标：统一 1.7 描边、圆角端点，主体加 22% 淡色填充。 */
function viewTabBase(size: number) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
}

/** 用量限制：半圆仪表盘。 */
export function ViewGaugeIcon({ size = 15 }: IconProps) {
  return (
    <svg {...viewTabBase(size)}>
      <path d="M5.13 18.5a8.5 8.5 0 1 1 13.74 0" />
      <path d="M12 14l3.8-4.4" />
      <circle cx="12" cy="14" r="1.7" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** 分类栏：主页。 */
export function HomeIcon({ size = 13, filled = false }: IconProps) {
  if (filled) return <svg {...base(size)} fill="currentColor" stroke="none"><path d="m2.9 10.2 8.5-7a1 1 0 0 1 1.2 0l8.5 7a1 1 0 0 1-1.2 1.6l-.4-.3V19a2 2 0 0 1-2 2H14v-6h-4v6H6.5a2 2 0 0 1-2-2v-7.5l-.4.3a1 1 0 0 1-1.2-1.6Z" /></svg>;
  return <svg {...base(size)} aria-hidden="true"><path d="M3.5 11 12 4l8.5 7" /><path d="M5.5 9.5V19a1 1 0 0 0 1 1H10v-5h4v5h3.5a1 1 0 0 0 1-1V9.5" /></svg>;
}

/** 分类栏：任务配方。 */
export function RecipeIcon({ size = 13, filled = false }: IconProps) {
  if (filled) return <svg {...base(size)} fill="currentColor" stroke="none"><path fillRule="evenodd" d="M7 2a3 3 0 0 0-3 3v14a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3V5a3 3 0 0 0-3-3Zm1.2 5.2h7.6v1.6H8.2Zm0 4h7.6v1.6H8.2Zm0 4h5.6v1.6H8.2Z" /></svg>;
  return <svg {...base(size)} aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 8h6M9 12h6M9 16h4" /></svg>;
}

/** 分类栏：Pull Request。 */
export function PullRequestIcon({ size = 13, filled = false }: IconProps) {
  if (filled) return <svg {...base(size)} fill="currentColor" stroke="none"><circle cx="6" cy="5" r="3.5" /><circle cx="6" cy="19" r="3.5" /><circle cx="18" cy="19" r="3.5" /><path d="M6 8v8M18 16V9a4 4 0 0 0-4-4h-2m2-2-2 2 2 2" fill="none" stroke="currentColor" strokeWidth="2.4" /></svg>;
  return <svg {...base(size)} aria-hidden="true"><circle cx="6" cy="5" r="3" /><circle cx="6" cy="19" r="3" /><circle cx="18" cy="19" r="3" /><path d="M6 8v8M18 16V9a4 4 0 0 0-4-4h-2m2-2-2 2 2 2" /></svg>;
}

/** 分类栏：设置。 */
export function GearIcon({ size = 13, filled = false }: IconProps) {
  return <svg {...base(size)} fill={filled ? "currentColor" : "none"} stroke={filled ? "none" : "currentColor"} aria-hidden="true">{!filled ? <circle cx="12" cy="12" r="3" /> : null}<path fillRule="evenodd" d={"M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.65 1.65 0 0 0 15 19.4a1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" + (filled ? " M15 12a3 3 0 1 0-6 0 3 3 0 0 0 6 0Z" : "")} /></svg>;
}
