import { memo } from "react";
import { agentAvatarDataUri } from "./agent-avatar";

/** 旁边已有代理名称；头像仅作身份辅助，状态由独立标记表达。 */
export const AgentAvatar = memo(function AgentAvatar({ agentId, size = 20 }: { agentId: string; size?: number }) {
  return (
    <img
      className="agent-avatar"
      src={agentAvatarDataUri(agentId)}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
});
