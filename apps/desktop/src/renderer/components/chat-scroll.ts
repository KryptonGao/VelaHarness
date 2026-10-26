/** 距离底部不超过这个值时,视为用户已经回到底部。 */
export const STREAM_FOLLOW_BOTTOM = 16;

/** 离开跟随且距离底部超过这个值时,才显示「回到最新」。 */
const JUMP_TO_LATEST_DISTANCE = 64;

/** 小于这个位移的回弹忽略,避免贴底时的轻微抖动取消跟随。 */
const SCROLL_UP_RELEASE_PX = 4;

/**
 * 根据一次用户滚动更新是否跟随底部。
 * 内容变高但 scrollTop 没变时不要调用:那时距离底部会变大,并不代表用户离开了底部。
 * 向上滚立刻取消跟随,否则下一段输出会把视口拉回去。
 * 只有用户自己向下滚回底部才恢复跟随。
 */
export function nextStreamFollow(input: {
  following: boolean;
  scrollTop: number;
  previousScrollTop: number;
  distanceFromBottom: number;
}): boolean {
  const delta = input.scrollTop - input.previousScrollTop;
  if (delta < -SCROLL_UP_RELEASE_PX) return false;
  if (delta > 0 && input.distanceFromBottom <= STREAM_FOLLOW_BOTTOM) return true;
  return input.following;
}

/**
 * 内容变矮时浏览器会把滚动位置往回夹,随后才派发 scroll 事件。
 * 这种位置回退不是用户在向上滚,不能因此取消跟随。
 */
export function isContentClamp(input: {
  scrollHeight: number;
  previousScrollHeight: number;
  scrollTop: number;
  previousScrollTop: number;
}): boolean {
  return input.scrollHeight < input.previousScrollHeight - 1 && input.scrollTop < input.previousScrollTop;
}

/** 用户正在看更早的内容,且列表还能往上走。在滚动生效前调用,避免随后的输出把视口拉回去。 */
export function releasesStreamFollow(scrollTop: number, towardEarlier: boolean): boolean {
  return towardEarlier && scrollTop > 0;
}

/** 切换对话或出现新的用户消息时重新贴底;流式更新同一条回复时保持当前跟随状态。 */
export function shouldResumeFollowForMessages(input: {
  conversationChanged: boolean;
  previousUserMessageId: string | null;
  userMessageId: string | null;
}): boolean {
  if (input.conversationChanged) return true;
  return input.userMessageId !== null && input.userMessageId !== input.previousUserMessageId;
}

/** 用户已经离开底部、输出不再被跟随时,提供回到最新内容的入口。 */
export function shouldShowJumpToLatest(input: { following: boolean; distanceFromBottom: number }): boolean {
  return !input.following && input.distanceFromBottom > JUMP_TO_LATEST_DISTANCE;
}
