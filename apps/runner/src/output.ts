import type { Writable } from "node:stream";

/**
 * 逐行写入并尊重背压：write 返回 false 时等 drain 再继续。
 * 输出被关闭（EPIPE 等）后 broken 置位并通知调用方，之后的写入直接丢弃。
 */
export class LineWriter {
  private broken = false;

  constructor(private readonly stream: Writable, private readonly onBroken?: (error: Error) => void) {
    stream.on("error", (error: Error) => this.markBroken(error));
  }

  get isBroken(): boolean { return this.broken; }

  private markBroken(error: Error): void {
    if (this.broken) return;
    this.broken = true;
    this.onBroken?.(error);
  }

  async write(text: string): Promise<void> {
    if (this.broken || this.stream.destroyed || this.stream.writableEnded) {
      this.markBroken(new Error("output stream is closed"));
      return;
    }
    let ok: boolean;
    try { ok = this.stream.write(text); }
    catch (error) { this.markBroken(error instanceof Error ? error : new Error(String(error))); return; }
    if (ok) return;
    await new Promise<void>(resolve => {
      const done = (): void => {
        this.stream.off("drain", done);
        this.stream.off("close", done);
        this.stream.off("error", done);
        resolve();
      };
      this.stream.once("drain", done);
      this.stream.once("close", done);
      this.stream.once("error", done);
    });
  }

  /** 等已排队的数据交给内核。 */
  flush(): Promise<void> {
    if (this.broken) return Promise.resolve();
    return new Promise<void>(resolve => {
      try { this.stream.write("", () => resolve()); } catch { resolve(); }
    });
  }
}
