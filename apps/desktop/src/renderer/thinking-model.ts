export interface ThinkingModelSource {
  model?: string;
  modelName?: string;
  provider?: string;
}

export interface ThinkingModelLabel {
  id: string;
  name: string;
  provider: string;
}

/** ID 或显示名称任一位置包含 gpt 即匹配，不区分大小写。 */
export function supportsThinkingGroups(message: ThinkingModelSource): boolean {
  return /gpt/i.test(message.model ?? "") || /gpt/i.test(message.modelName ?? "");
}

/** 按消息原始 provider/id 查显示名称，不使用当前选中的模型。 */
export function thinkingModelName(message: ThinkingModelSource, models: readonly ThinkingModelLabel[]): string | undefined {
  if (message.modelName !== undefined) return message.modelName;
  if (!message.model) return undefined;
  const matches = models.filter(model => model.id === message.model && (!message.provider || model.provider === message.provider));
  const names = new Set(matches.map(model => model.name));
  return names.size === 1 ? matches[0]?.name : undefined;
}

/** 按消息自身的来源分段，不使用当前输入框模型；未知来源保守退回普通思考。 */
export function partitionThinkingGroups<T extends ThinkingModelSource & { id: string }>(messages: T[], enabled: boolean): { id: string; coherent: boolean; messages: T[] }[] {
  const sections: { id: string; coherent: boolean; messages: T[] }[] = [];
  for (const message of messages) {
    const coherent = enabled && supportsThinkingGroups(message);
    const previous = sections[sections.length - 1];
    if (previous?.coherent === coherent && previous.messages[previous.messages.length - 1]?.model === message.model && previous.messages[previous.messages.length - 1]?.provider === message.provider) previous.messages.push(message);
    else sections.push({ id: message.id, coherent, messages: [message] });
  }
  return sections;
}
