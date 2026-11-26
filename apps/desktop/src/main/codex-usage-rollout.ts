import { createHash } from "node:crypto";
import type { TraceUsage } from "@vela/shared";

type Fields = Record<string, unknown>;
const fields = (value: unknown): Fields | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Fields : null;

function identifier(value: unknown): string | null {
  return typeof value === "string" && /^[\w.:-][\w./:@-]{0,180}$/.test(value) ? value : null;
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function timestamp(value: unknown): number | null {
  const time = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? time : null;
}

function serviceTier(value: unknown): string | null {
  if (value === "standard") return "default";
  if (value === "fast") return "priority";
  return identifier(value);
}

interface Counters {
  total: number;
  input: number | null;
  output: number | null;
  read: number | null;
  write: number | null;
}

function counters(raw: unknown): Counters | null {
  const v = fields(raw);
  const total = count(v?.total_tokens);
  if (!v || total === null) return null;
  const input = count(v.input_tokens);
  let output = count(v.output_tokens);
  const reasoning = count(v.reasoning_output_tokens);
  if (input !== null && output !== null && reasoning !== null && input + output + reasoning === total) output += reasoning;
  return { total, input, output, read: count(v.cached_input_tokens), write: count(v.cache_write_input_tokens ?? 0) };
}

function difference(current: Counters, previous: Counters): Counters {
  const delta = (key: keyof Counters) => {
    const a = current[key], b = previous[key];
    return a !== null && b !== null ? count(a - b) : null;
  };
  return { total: current.total - previous.total, input: delta("input"), output: delta("output"),
    read: delta("read"), write: delta("write") };
}

export interface RolloutState {
  thread: string | null;
  desktop: boolean;
  provider: string | null;
  model: string | null;
  tier: string | null;
  turnTier: string | null;
  turn: string | null;
  ownStart: number;
  forkTime: number | null;
  baseThread: string | null;
  baseOrdinal: number | null;
  previous: Counters | null;
  line: number;
  damaged: boolean;
}

export function newRollout(): RolloutState {
  return { thread: null, desktop: false, provider: null, model: null, tier: null, turnTier: null, turn: null,
    ownStart: 0, forkTime: null, baseThread: null, baseOrdinal: null, previous: null, line: 0, damaged: false };
}

export interface MeterReading {
  key: string;
  ordinal: number;
  time: number | null;
  cumulative: number;
  complete: boolean;
  attributed: boolean;
  usage: TraceUsage;
  baseThread: string | null;
  baseOrdinal: number | null;
}

function readMeter(state: RolloutState, info: Fields, time: number | null, ordinal: number, inherited: boolean): MeterReading | null {
  const total = counters(info.total_token_usage);
  if (!total) { state.damaged = true; return null; }
  const previous = state.previous;
  state.previous = total;
  if (inherited || !total.total || total.total === previous?.total) return null;

  // The first snapshot may already include the parent's spend. Only its last request is ours.
  const last = counters(info.last_token_usage);
  const advancing = previous !== null && total.total > previous.total;
  const delta = advancing ? difference(total, previous) : null;
  if (previous && !advancing) state.damaged = true;
  if (!delta && !last) { state.damaged = true; return null; }
  // Compaction can report a context-size estimate before the first actual request.
  // Keep the cumulative baseline, but do not treat that estimate as a model invocation.
  if (!state.turn && !state.model && !last?.input && !last?.output) { state.damaged = true; return null; }
  // When updates are missing, the gap can span multiple turns or models. Only attribute
  // the individually reported last request; do not charge the whole gap to its model.
  const singleRequest = last !== null && last.total > 0 && (!delta || last.total <= delta.total);
  if (delta && delta.total !== last?.total) state.damaged = true;
  const value = singleRequest ? last : delta;
  if (!value || !value.total || value.total > total.total) { state.damaged = true; return null; }
  const { input, output, read, write } = value;
  const complete = input !== null && output !== null && read !== null && write !== null
    && input >= read + write && input + output === value.total;
  if (!complete || !singleRequest) state.damaged = true;
  const usage = { input: Math.max(0, (input ?? 0) - (read ?? 0) - (write ?? 0)), output: output ?? 0,
    cacheRead: read ?? 0, cacheWrite: write ?? 0, totalTokens: value.total };
  const identity = time !== null ? [state.turn ?? state.thread, time, total.total] : [state.thread, ordinal, total.total];
  return { key: createHash("sha256").update(JSON.stringify(identity)).digest("hex"), ordinal, time,
    cumulative: total.total, complete: complete && singleRequest, attributed: singleRequest, usage,
    baseThread: previous === null ? state.baseThread : null, baseOrdinal: state.baseOrdinal };
}

/** Keep attribution and counters only. Session metadata can contain an entire instruction set. */
export function readRolloutLine(line: string, state: RolloutState): MeterReading | null {
  if (!line.trimStart()) return null;
  const position = state.line++;
  const head = line.slice(0, 512);
  const envelope = head.split(/"payload"\s*:/, 2);
  if (/"type"\s*:\s*"(?:response_item|compacted)"/.test(envelope[0])) return null;
  if (envelope[1] && /"type"\s*:\s*"event_msg"/.test(envelope[0])) {
    const event = /^\s*\{\s*"type"\s*:\s*"([^"]+)"/.exec(envelope[1]);
    if (event && !["token_count", "thread_settings_applied", "model_rerouted", "task_started"].includes(event[1])) return null;
  }
  const row = fields(JSON.parse(line));
  const p = fields(row?.payload);
  if (!p || !row) return null;
  const ordinal = count(row.ordinal) ?? position;
  if (row.type === "session_meta") {
    if (state.thread) return null; // Copied parent metadata can follow the child's header.
    state.thread = identifier(p.id);
    state.desktop = p.originator === "Codex Desktop" && state.thread !== null;
    state.provider = identifier(p.model_provider);
    const base = fields(p.history_base);
    state.baseThread = identifier(base?.thread_id);
    state.baseOrdinal = count(base?.end_ordinal_exclusive);
    state.ownStart = count(p.subagent_history_start_ordinal) ?? state.baseOrdinal ?? count(p.forked_from_ordinal_exclusive) ?? 0;
    if (p.forked_from_id || p.parent_thread_id) state.forkTime = timestamp(p.timestamp);
    return null;
  }
  if (!state.desktop) return null;
  const time = timestamp(row.timestamp);
  const inherited = ordinal < state.ownStart || (state.forkTime !== null && time !== null && time < state.forkTime);
  if (row.type === "event_msg" && p.type === "token_count") {
    const info = fields(p.info);
    return info ? readMeter(state, info, time, ordinal, inherited) : null;
  }
  if (inherited) return null;
  if (row.type === "turn_context") {
    const turn = identifier(p.turn_id);
    if (turn && turn !== state.turn) state.turnTier = state.tier;
    state.model = identifier(p.model);
    state.turn = turn ?? state.turn;
    if ("service_tier" in p) state.turnTier = serviceTier(p.service_tier);
  } else if (row.type === "event_msg") {
    if (p.type === "task_started") {
      state.turn = identifier(p.turn_id);
      state.model = null;
      state.turnTier = state.tier;
    } else if (p.type === "thread_settings_applied") {
      const settings = fields(p.thread_settings);
      if (settings) {
        if ("model_provider_id" in settings) state.provider = identifier(settings.model_provider_id);
        if ("model" in settings) state.model = identifier(settings.model);
        if ("service_tier" in settings) state.turnTier = state.tier = serviceTier(settings.service_tier);
      }
    } else if (p.type === "model_rerouted") {
      state.model = identifier(p.to_model);
    }
  }
  return null;
}

