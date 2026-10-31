/** 浏览器式的前进/后退历史：只记录「落脚点」，回退时不会产生新记录。 */
export class NavHistory<T> {
  private entries: T[] = [];
  private index = -1;

  constructor(private readonly keyOf: (entry: T) => string, private readonly limit = 50) {}

  get current(): T | null { return this.entries[this.index] ?? null; }

  /** 记录一个新落脚点；与当前位置相同则忽略。返回是否发生了变化。 */
  record(entry: T): boolean {
    const key = this.keyOf(entry);
    const current = this.current;
    if (current && this.keyOf(current) === key) { this.entries[this.index] = entry; return false; }
    this.entries.splice(this.index + 1);
    this.entries.push(entry);
    if (this.entries.length > this.limit) this.entries.shift();
    this.index = this.entries.length - 1;
    return true;
  }

  canGoBack(isValid: (entry: T) => boolean = () => true): boolean { return this.find(-1, isValid) >= 0; }
  canGoForward(isValid: (entry: T) => boolean = () => true): boolean { return this.find(1, isValid) >= 0; }

  /** 移到上一个仍然有效的记录（如已被删除的对话会被跳过）；没有则返回 null 且位置不变。 */
  back(isValid: (entry: T) => boolean = () => true): T | null { return this.move(-1, isValid); }
  forward(isValid: (entry: T) => boolean = () => true): T | null { return this.move(1, isValid); }

  private find(step: 1 | -1, isValid: (entry: T) => boolean): number {
    for (let i = this.index + step; i >= 0 && i < this.entries.length; i += step) {
      if (isValid(this.entries[i]!)) return i;
    }
    return -1;
  }

  private move(step: 1 | -1, isValid: (entry: T) => boolean): T | null {
    const target = this.find(step, isValid);
    if (target < 0) return null;
    this.index = target;
    return this.entries[target]!;
  }
}
