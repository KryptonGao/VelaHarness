import type { UiMessage } from "../../hooks/useSession";

export interface OutputFile {
  /** 绝对路径；相对路径按会话工作目录补全。 */
  path: string;
  name: string;
}

const maxOutputs = 20;

function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function absolutePath(path: string, cwd: string | undefined): string {
  if (/^([\\/]|[A-Za-z]:[\\/])/.test(path) || !cwd) return path;
  return `${cwd.replace(/[\\/]+$/, "")}/${path.replace(/^\.\//, "")}`;
}

/** 本对话里 write 工具成功写出的文件，最近写入的在前，同一路径只保留一条。 */
export function writtenFiles(messages: readonly UiMessage[], cwd: string | undefined): OutputFile[] {
  const seen = new Set<string>();
  const files: OutputFile[] = [];
  for (let m = messages.length - 1; m >= 0 && files.length < maxOutputs; m--) {
    const tools = messages[m]!.tools;
    for (let t = tools.length - 1; t >= 0 && files.length < maxOutputs; t--) {
      const tool = tools[t]!;
      if (tool.name !== "write" || tool.status !== "done" || !tool.activity.path) continue;
      const path = absolutePath(tool.activity.path, cwd);
      if (seen.has(path)) continue;
      seen.add(path);
      files.push({ path, name: baseName(path) });
    }
  }
  return files;
}

