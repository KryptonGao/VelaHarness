/**
 * 「回到最新」圆球的动效:样式池、轮换规则和两个逐帧样式(T4、C5)的几何。
 *
 * 轮换规则:
 * 1. 状态决定样式池:思考用 T1–T4,运行命令用 C1/C2/C4/C5;没有活动时显示静态箭头。
 * 2. 池内用「洗牌袋」:一轮内每个样式各出现一次,袋空了重新洗牌,且新一袋的第一个不等于上一个。
 * 3. 一个样式随机播放 {@link ORB_MIN_LOOPS}–{@link ORB_MAX_LOOPS} 个完整周期(停留时长恰好是周期的整数倍,换样式时姿势已回到起点),之后换到袋里的下一个。
 * 4. 状态切换(思考 ↔ 运行命令)或开始新的命令时,立刻从对应池里抽下一个,并重新计时。
 * 5. 换样式时不硬切:点从上一个样式的当前位置滑到新样式的位置({@link blendOrbFrames}),新样式从它自己的起始姿势开始。
 */

export type OrbActivity = "thinking" | "command";
export type OrbStyle = "t1" | "t2" | "t3" | "t4" | "c1" | "c2" | "c4" | "c5";

export const ORB_POOLS: Record<OrbActivity, readonly OrbStyle[]> = {
  thinking: ["t1", "t2", "t3", "t4"],
  command: ["c1", "c2", "c4", "c5"],
};

/** 每个样式的一个完整周期(毫秒),用来决定它至少要播几轮;orbFrame 里各样式的周期要与它一致。 */
export const ORB_LOOP_MS: Record<OrbStyle, number> = {
  t1: 2400,
  t2: 2200,
  t3: 2200,
  t4: 4200,
  c1: 4800,
  c2: 1600,
  c4: 4600,
  c5: 0, // 见文件末尾,由节拍表算出
};

export const ORB_MIN_LOOPS = 1;
export const ORB_MAX_LOOPS = 6;

/** 样式这一次要停留多久:随机播 ORB_MIN_LOOPS–ORB_MAX_LOOPS 个整周期。 */
export function orbDwellMs(style: OrbStyle, random: () => number = Math.random): number {
  const loops = ORB_MIN_LOOPS + Math.floor(random() * (ORB_MAX_LOOPS - ORB_MIN_LOOPS + 1));
  return loops * ORB_LOOP_MS[style];
}

export interface OrbRotation {
  bags: Record<OrbActivity, OrbStyle[]>;
  last: Partial<Record<OrbActivity, OrbStyle>>;
}

export function createOrbRotation(): OrbRotation {
  return { bags: { thinking: [], command: [] }, last: {} };
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index--) {
    const pick = Math.floor(random() * (index + 1));
    [next[index], next[pick]] = [next[pick], next[index]];
  }
  return next;
}

/** 从洗牌袋里抽下一个样式;袋空了重新洗牌,避免与上一个相同。 */
export function drawOrbStyle(rotation: OrbRotation, activity: OrbActivity, random: () => number = Math.random): OrbStyle {
  const pool = ORB_POOLS[activity];
  let bag = rotation.bags[activity];
  if (bag.length === 0) {
    bag = shuffled(pool, random);
    const last = rotation.last[activity];
    if (bag.length > 1 && bag[0] === last) [bag[0], bag[1]] = [bag[1], bag[0]];
    rotation.bags[activity] = bag;
  }
  const style = bag.shift() as OrbStyle;
  rotation.last[activity] = style;
  return style;
}

const smootherstep = (value: number) => {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value * value * value * (value * (value * 6 - 15) + 10);
};

const snap = (value: number) => {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value < 0.5 ? 8 * value ** 4 : 1 - 8 * (1 - value) ** 4;
};

/* ---------- T4:倾斜的三点轨道 ---------- */

const ORBIT_RADIUS = 8;
const ORBIT_PERIOD_S = 2.0;
const ORBIT_TILT_PERIOD_S = 4.2;
const ORBIT_TILT_AMPLITUDE = (34 * Math.PI) / 180;

export interface OrbitDot { x: number; y: number; scale: number }

/** 三个点在一个来回倾斜的圆轨道上转,近的放大、远的缩小;大多数时候接近一条线。 */
export function tiltedOrbit(seconds: number): OrbitDot[] {
  const phi = Math.PI / 2 + ORBIT_TILT_AMPLITUDE * Math.sin((2 * Math.PI * seconds) / ORBIT_TILT_PERIOD_S);
  const base = (2 * Math.PI * seconds) / ORBIT_PERIOD_S;
  return [0, 1, 2].map((index) => {
    const theta = base + (index * 2 * Math.PI) / 3;
    const x = ORBIT_RADIUS * Math.cos(theta);
    const planar = ORBIT_RADIUS * Math.sin(theta);
    return {
      x,
      y: planar * Math.cos(phi),
      scale: 1 + (0.5 * planar * Math.sin(phi)) / ORBIT_RADIUS,
    };
  });
}

/* ---------- C5:翻转的方块 + 在四个点之间穿梭的一条线 ---------- */

const SQUARE_HALF = 6.5;
const FLIP_PERIOD_S = 1.15;
const FOCAL = 26;
const TRAIL_LAG_S = 0.55;
const CENTER = 15;
const CORNERS: ReadonlyArray<readonly [number, number]> = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
/** 线头依次经过的点:先绕方框一圈,再走两条对角线,最后回到起点。 */
const SHUTTLE_SEQUENCE = [0, 1, 2, 3, 0, 2, 1, 3] as const;
/** 每段 [行进秒数, 到点后的停顿秒数];前四段短促,对角线长一些,第 3、8 段后停得更久。 */
const SHUTTLE_BEAT: ReadonlyArray<readonly [number, number]> = [
  [0.26, 0.06], [0.26, 0.06], [0.26, 0.34], [0.26, 0.06],
  [0.48, 0.06], [0.26, 0.06], [0.48, 0.06], [0.26, 0.46],
];

const shuttleLegs: Array<{ start: number; duration: number; end: number }> = [];
let shuttleTotal = 0;
for (const [duration, rest] of SHUTTLE_BEAT) {
  shuttleLegs.push({ start: shuttleTotal, duration, end: shuttleTotal + duration });
  shuttleTotal += duration + rest;
}
ORB_LOOP_MS.c5 = Math.round(shuttleTotal * 1000);

/** 线头沿折线走过的「累计段数」:整数部分是已走完的段数,小数部分是当前段内的进度。 */
function shuttleProgress(seconds: number): number {
  if (seconds <= 0) return 0;
  const loops = Math.floor(seconds / shuttleTotal);
  const within = seconds - loops * shuttleTotal;
  const legCount = SHUTTLE_SEQUENCE.length;
  for (let index = 0; index < legCount; index++) {
    const leg = shuttleLegs[index];
    if (within < leg.start) return loops * legCount + index;
    if (within <= leg.end) return loops * legCount + index + snap((within - leg.start) / leg.duration);
  }
  return (loops + 1) * legCount;
}

export interface ShuttleDot { x: number; y: number; r: number }
export interface ShuttleFrame { dots: ShuttleDot[]; path: string }

const fixed = (value: number) => value.toFixed(2);

/** 一个平面方块交替绕竖轴、横轴翻 180°;一条线在四个角之间穿梭,线头画出、线尾擦去。 */
export function shuttleFrame(seconds: number): ShuttleFrame {
  const cycle = seconds / FLIP_PERIOD_S;
  const turn = Math.floor(cycle);
  const eased = smootherstep((cycle - turn - 0.08) / 0.62);
  const yaw = Math.PI * Math.ceil(turn / 2) + (turn % 2 === 0 ? Math.PI * eased : 0);
  const pitch = Math.PI * Math.floor(turn / 2) + (turn % 2 === 1 ? Math.PI * eased : 0);
  const tilt = 0.28;
  const cosYaw = Math.cos(yaw), sinYaw = Math.sin(yaw);
  const cosPitch = Math.cos(pitch), sinPitch = Math.sin(pitch);
  const cosTilt = Math.cos(tilt), sinTilt = Math.sin(tilt);
  const points = CORNERS.map(([cx, cy]) => {
    const x0 = cx * SQUARE_HALF;
    const y0 = cy * SQUARE_HALF;
    const x1 = x0 * cosYaw;
    const z1 = -x0 * sinYaw;
    const y1 = y0 * cosPitch - z1 * sinPitch;
    const z2 = y0 * sinPitch + z1 * cosPitch;
    const y2 = y1 * cosTilt - z2 * sinTilt;
    const z3 = y1 * sinTilt + z2 * cosTilt;
    const perspective = FOCAL / (FOCAL - z3);
    return { x: CENTER + x1 * perspective, y: CENTER + y2 * perspective, k: perspective };
  });
  const legCount = SHUTTLE_SEQUENCE.length;
  const at = (progress: number) => {
    const index = Math.floor(progress);
    const from = points[SHUTTLE_SEQUENCE[index % legCount]];
    const to = points[SHUTTLE_SEQUENCE[(index + 1) % legCount]];
    const fraction = progress - index;
    return { x: from.x + (to.x - from.x) * fraction, y: from.y + (to.y - from.y) * fraction };
  };
  const head = shuttleProgress(seconds);
  const tail = Math.min(head, shuttleProgress(seconds - TRAIL_LAG_S));
  const start = at(tail);
  let path = `M${fixed(start.x)} ${fixed(start.y)}`;
  for (let index = Math.floor(tail) + 1; index <= Math.floor(head); index++) {
    const corner = points[SHUTTLE_SEQUENCE[index % legCount]];
    path += `L${fixed(corner.x)} ${fixed(corner.y)}`;
  }
  const end = at(head);
  path += `L${fixed(end.x)} ${fixed(end.y)}`;
  return { dots: points.map((point) => ({ x: point.x, y: point.y, r: 1.4 * point.k })), path };
}

/* ---------- 统一的逐帧渲染:所有样式都画成 4 个点 + 一条可选的线,切换时按帧混合 ---------- */

export interface OrbDot { x: number; y: number; r: number; o: number }
export interface OrbFrame {
  dots: OrbDot[];
  /** 只有 C5 有线;没有线时为空串。 */
  path: string;
  pathOpacity: number;
}

const DOT_RADIUS = 1.5;
/** 样式之间的过渡时长:点从上一个样式的当前位置滑到新样式的位置。 */
export const ORB_MORPH_MS = 550;

/** cubic-bezier(.45,0,.25,1):和之前 CSS 版本用的缓动一致。 */
function cubicBezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  const coordinate = (a: number, b: number, t: number) => 3 * a * (1 - t) ** 2 * t + 3 * b * (1 - t) * t * t + t ** 3;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let lo = 0;
    let hi = 1;
    let t = x;
    for (let step = 0; step < 24; step++) {
      t = (lo + hi) / 2;
      if (coordinate(x1, x2, t) < x) lo = t;
      else hi = t;
    }
    return coordinate(y1, y2, t);
  };
}
const easeSegment = cubicBezier(0.45, 0, 0.25, 1);

type Stop = readonly [number, readonly number[]];

/** 关键帧采样:pct 为 0–100 的周期位置,每一段内用缓动插值,相邻两帧值相同就是停顿。 */
function sample(stops: readonly Stop[], pct: number): number[] {
  const last = stops.length - 1;
  if (pct <= stops[0][0]) return [...stops[0][1]];
  for (let index = 0; index < last; index++) {
    const [from, fromValue] = stops[index];
    const [to, toValue] = stops[index + 1];
    if (pct <= to) {
      const eased = easeSegment((pct - from) / (to - from));
      return fromValue.map((value, axis) => value + (toValue[axis] - value) * eased);
    }
  }
  return [...stops[last][1]];
}

/** 已走完的周期数和当前周期内的位置(0–100);两者用同一次除法,周期交界处不会错位。 */
const cycleOf = (seconds: number, period: number) => {
  const loops = Math.floor(seconds / period);
  return { loops, pct: Math.min(100, Math.max(0, (seconds / period - loops) * 100)) };
};
const percentOf = (seconds: number, period: number) => cycleOf(seconds, period).pct;
const rad = (degrees: number) => (degrees * Math.PI) / 180;
const dot = (x: number, y: number, r = DOT_RADIUS, o = 1): OrbDot => ({ x, y, r, o });
/** 三点样式的第 4 个点:收在圆心,不可见。 */
const hidden = (): OrbDot => dot(CENTER, CENTER, 0, 0);

const P = 6;
const TL = [-P, -P], TR = [P, -P], BR = [P, P], BL = [-P, P];
const at = (point: readonly number[]) => dot(CENTER + point[0], CENTER + point[1]);

const T1_STAGGER: Array<[number, number, number]> = [4, 12, 20].map((start) => [start, start + 13, start + 26]);
const C1_PATHS: Stop[][] = [
  [[0, TL], [5, TL], [17, BR], [55, BR], [67, TL], [100, TL]],
  [[0, BR], [5, BR], [17, TL], [55, TL], [67, BR], [100, BR]],
  [[0, TR], [27, TR], [39, BL], [77, BL], [89, TR], [100, TR]],
  [[0, BL], [27, BL], [39, TR], [77, TR], [89, BL], [100, BL]],
];
const loopStops = (order: number[][], first: number): Stop[] => {
  const corner = (step: number) => order[(first + step) % 4];
  return [[0, corner(0)], [8, corner(0)], [22, corner(1)], [30, corner(1)], [44, corner(2)], [52, corner(2)], [66, corner(3)], [74, corner(3)], [88, corner(0)], [100, corner(0)]];
};
const CLOCKWISE = [TL, TR, BR, BL];
const COUNTER = [TR, TL, BL, BR];
const C4_PATHS: Stop[][] = [loopStops(CLOCKWISE, 0), loopStops(CLOCKWISE, 2), loopStops(COUNTER, 0), loopStops(COUNTER, 2)];
const SPIN: Stop[] = [[0, [0]], [6, [0]], [88, [120]], [100, [120]]];
const T2_RADIUS: Stop[] = [[0, [6]], [6, [6]], [47, [2.5]], [88, [6]], [100, [6]]];
const T3_RADIUS: Stop[] = [[0, [6]], [6, [6]], [38, [0]], [46, [0]], [88, [6]], [100, [6]]];
const C2_TURN: Stop[] = [[0, [0, 1]], [8, [0, 1]], [43, [45, 0.7]], [78, [90, 1]], [100, [90, 1]]];

const arms = (seconds: number, radiusStops: Stop[]): OrbDot[] => {
  const { loops, pct } = cycleOf(seconds, 2.2);
  // 每个周期转 120°,累计下去:周期交界处三角形重合,而且每个点都是连续运动,没有换位。
  const spin = sample(SPIN, pct)[0] + 120 * loops;
  const radius = sample(radiusStops, pct)[0];
  return [0, 1, 2].map((index) => {
    const angle = rad(index * 120 + spin);
    return dot(CENTER + radius * Math.sin(angle), CENTER - radius * Math.cos(angle));
  });
};

/** 某个样式在它自己的时间轴(从 0 秒开始)上的一帧;坐标是 30×30 画布里的位置。 */
export function orbFrame(style: OrbStyle, seconds: number): OrbFrame {
  let dots: OrbDot[];
  let path = "";
  switch (style) {
    case "t1": {
      const pct = percentOf(seconds, 2.4);
      dots = T1_STAGGER.map(([start, peak, end], index) => {
        const [lift, opacity] = sample([[0, [0, 0.35]], [start, [0, 0.35]], [peak, [-3.5, 1]], [end, [0, 0.35]], [100, [0, 0.35]]], pct);
        return dot(CENTER + (index - 1) * 6, CENTER + lift, DOT_RADIUS, opacity);
      });
      dots.push(hidden());
      break;
    }
    case "t2":
      dots = [...arms(seconds, T2_RADIUS), hidden()];
      break;
    case "t3":
      dots = [...arms(seconds, T3_RADIUS), hidden()];
      break;
    case "t4":
      dots = [...tiltedOrbit(seconds).map((item) => dot(CENTER + item.x, CENTER + item.y, DOT_RADIUS * item.scale)), hidden()];
      break;
    case "c1":
      dots = C1_PATHS.map((stops) => at(sample(stops, percentOf(seconds, 4.8))));
      break;
    case "c2": {
      const { loops, pct } = cycleOf(seconds, 1.6);
      const [turn, scale] = sample(C2_TURN, pct);
      const angle = turn + 90 * loops;
      const cos = Math.cos(rad(angle)), sin = Math.sin(rad(angle));
      dots = [TL, TR, BR, BL].map(([x, y]) => dot(CENTER + (x * cos - y * sin) * scale, CENTER + (x * sin + y * cos) * scale));
      break;
    }
    case "c4":
      dots = C4_PATHS.map((stops) => at(sample(stops, percentOf(seconds, 4.6))));
      break;
    case "c5": {
      const frame = shuttleFrame(seconds);
      dots = frame.dots.map((item) => dot(item.x, item.y, item.r));
      path = frame.path;
      break;
    }
  }
  return { dots, path, pathOpacity: path ? 0.8 : 0 };
}

const lerp = (from: number, to: number, amount: number) => from + (to - from) * amount;

/** 从上一帧平滑过渡到新样式的一帧:位置、大小、透明度各自插值;线由新样式的线淡入。 */
export function blendOrbFrames(from: OrbFrame, to: OrbFrame, amount: number): OrbFrame {
  return {
    dots: to.dots.map((target, index) => {
      const source = from.dots[index];
      return { x: lerp(source.x, target.x, amount), y: lerp(source.y, target.y, amount), r: lerp(source.r, target.r, amount), o: lerp(source.o, target.o, amount) };
    }),
    path: to.path,
    pathOpacity: to.pathOpacity * amount,
  };
}

/** 过渡进度的缓动(0–1)。 */
export const orbMorphEase = smootherstep;
