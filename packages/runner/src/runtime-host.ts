import { AgentRuntime, type AgentRuntimeOptions } from "@vela/agent";
import { BackgroundShellManager, createSandboxedToolDefinitions, type SandboxPermissionManager } from "@vela/workspace";

/** 后台命令收尾的等待上限；超过后 dispose 仍然完成，只是报告残留。 */
export const backgroundDrainTimeoutMs = 5000;

export interface RuntimeHostOptions extends Omit<AgentRuntimeOptions, "toolFactory" | "backgroundShells" | "mcpPermission" | "memoryPermission" | "webPermission" | "browserReplPermission"> {
  /** 外部创建的权限管理器：桌面用它连接审批界面，Headless 用它拒绝并中止。 */
  sandbox: SandboxPermissionManager;
  /** 外部提供时由调用方负责其生命周期之外的复用；缺省为 RuntimeHost 自建。 */
  backgroundShells?: BackgroundShellManager;
  /** 记录收尾失败（例如命令在上限内没有结束），不影响 dispose 完成。 */
  onCleanupIssue?: (message: string) => void;
}

export interface RuntimeHost {
  runtime: AgentRuntime;
  backgroundShells: BackgroundShellManager;
  sandbox: SandboxPermissionManager;
  /** 幂等：重复调用共享同一个 Promise。先关闭 Runtime，再等后台命令终止。 */
  dispose(): Promise<void>;
}

/**
 * 组装运行环境：沙箱化的 bash / edit / write、后台命令、MCP / 浏览器 / 记忆 / 网页的权限适配，
 * 以及「帮我批准」模式的风险判断。浏览器、加密凭据、工作区目录、定时任务和常驻 Agent 仍由宿主显式注入。
 */
export function createRuntimeHost(options: RuntimeHostOptions): RuntimeHost {
  const { sandbox, onCleanupIssue, ...runtimeOptions } = options;
  const backgroundShells = options.backgroundShells ?? new BackgroundShellManager();
  const runtime = new AgentRuntime({
    ...runtimeOptions,
    backgroundShells,
    mcpPermission: { request: (input) => sandbox.request({ ...input, workspace: input.cwd }) },
    browserReplPermission: { request: (input) => sandbox.request({ ...input, workspace: input.cwd }) },
    memoryPermission: { request: (input) => sandbox.request({ ...input, workspace: input.workspace ?? input.cwd }) },
    webPermission: { request: (input) => sandbox.request({ ...input, workspace: input.cwd }) },
    toolFactory: (cwd, { background, ...context } = {}) =>
      createSandboxedToolDefinitions({
        cwd,
        workspace: cwd,
        extraRoots: () => runtimeOptions.workspaceFolders?.(cwd) ?? [],
        permission: sandbox,
        ...context,
        ...(background ? { background: backgroundShells } : {}),
      }),
  });
  sandbox.setRiskEvaluator((input) => runtime.evaluateSandboxRisk(input));

  let disposing: Promise<void> | null = null;
  const dispose = (): Promise<void> => {
    disposing ??= (async () => {
      try {
        await runtime.dispose();
      } finally {
        // Runtime 关闭时已请求终止全部命令；这里等它们真正退出，再释放监听。
        const remaining = await backgroundShells.drain(backgroundDrainTimeoutMs);
        if (remaining > 0) onCleanupIssue?.(`${remaining} 个后台命令在 ${backgroundDrainTimeoutMs / 1000} 秒内没有结束`);
        backgroundShells.dispose();
      }
    })();
    return disposing;
  };
  return { runtime, backgroundShells, sandbox, dispose };
}
