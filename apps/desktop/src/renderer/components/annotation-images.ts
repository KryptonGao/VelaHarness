import { maxAnnotationImages, type AnnotationImageRef, type BrowserAnnotationImage, type BrowserAnnotationTrack, type ImageAttachment } from "@vela/shared";
import { isElementReply, type ReplyCard } from "./selection-actions";

/** 随消息发出的元素截图，长边上限。 */
const maxEdge = 1200;

export type AnnotationImagePlan = "send" | "stale" | "failed" | "omitted";

/**
 * 决定每条元素批注的截图去向：已失效的只发文字；截图失败的注明未能截图；
 * 其余按顺序占用名额，超过名额的注明截图已省略。
 * `capacity` 是剔除用户自己添加的附件之后还剩下的图片名额。
 */
export function planAnnotationImages(
  cards: readonly ReplyCard[],
  tracking: ReadonlyMap<string, Pick<BrowserAnnotationTrack, "status" | "shot">>,
  capacity: number,
): Map<string, AnnotationImagePlan> {
  const plan = new Map<string, AnnotationImagePlan>();
  let free = Math.max(0, Math.min(maxAnnotationImages, capacity));
  for (const card of cards.filter(isElementReply)) {
    const track = tracking.get(card.id);
    if (!track || track.status === "stale") plan.set(card.id, "stale");
    else if (track.shot === "failed") plan.set(card.id, "failed");
    else if (free > 0) { free -= 1; plan.set(card.id, "send"); }
    else plan.set(card.id, "omitted");
  }
  return plan;
}

export interface AnnotationMessageParts {
  images: ImageAttachment[];
  refs: Map<string, { ref: AnnotationImageRef; cropped?: boolean }>;
  stale: Set<string>;
}

/** 按计划取回截图、打码并加上编号角标；`firstNumber` 是第一张批注截图在整条消息图片里的序号。 */
export async function collectAnnotationImages(
  cards: readonly ReplyCard[],
  plan: ReadonlyMap<string, AnnotationImagePlan>,
  firstNumber: number,
  fetchImages: (tabId: string, ids: string[]) => Promise<Record<string, BrowserAnnotationImage | null>>,
): Promise<AnnotationMessageParts> {
  const elements = cards.filter(isElementReply);
  const wanted = new Map<string, string[]>();
  for (const card of elements) if (plan.get(card.id) === "send") wanted.set(card.tabId, [...(wanted.get(card.tabId) ?? []), card.id]);
  const fetched: Record<string, BrowserAnnotationImage | null> = {};
  await Promise.all([...wanted].map(async ([tabId, ids]) => {
    try { Object.assign(fetched, await fetchImages(tabId, ids)); } catch { /* the notes still go out without images */ }
  }));

  const parts: AnnotationMessageParts = { images: [], refs: new Map(), stale: new Set() };
  for (const card of elements) {
    const decision = plan.get(card.id);
    if (decision === "stale") { parts.stale.add(card.id); continue; }
    if (decision === "omitted") { parts.refs.set(card.id, { ref: "omitted" }); continue; }
    if (decision === "failed") { parts.refs.set(card.id, { ref: "failed" }); continue; }
    const source = fetched[card.id];
    const number = firstNumber + parts.images.length;
    const image = source ? await drawAnnotationImage(source, number).catch(() => null) : null;
    if (!image) { parts.refs.set(card.id, { ref: "failed" }); continue; }
    parts.images.push(image);
    parts.refs.set(card.id, { ref: number, cropped: source!.cropped });
  }
  return parts;
}

/** 缩到长边 1200 px 以内，给密码框打黑块，在左上角画上图号角标。 */
export async function drawAnnotationImage(source: BrowserAnnotationImage, number: number): Promise<ImageAttachment> {
  const binary = atob(source.data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  const bitmap = await createImageBitmap(new Blob([bytes], { type: source.mimeType }));
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale)), height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas unavailable");
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const kx = width / Math.max(1, source.clipWidth), ky = height / Math.max(1, source.clipHeight);
  context.fillStyle = "#000";
  for (const mask of source.masks) context.fillRect(Math.floor(mask.x * kx), Math.floor(mask.y * ky), Math.ceil(mask.width * kx), Math.ceil(mask.height * ky));
  const radius = 12;
  context.fillStyle = "#3f83eb";
  context.beginPath(); context.arc(radius + 3, radius + 3, radius, 0, Math.PI * 2); context.fill();
  context.fillStyle = "#fff";
  context.font = "bold 14px sans-serif"; context.textAlign = "center"; context.textBaseline = "middle";
  context.fillText(String(number), radius + 3, radius + 4);
  return { type: "image", data: canvas.toDataURL("image/png").split(",")[1] ?? "", mimeType: "image/png" };
}
