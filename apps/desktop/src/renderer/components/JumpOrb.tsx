import { useEffect, useRef, useState } from "react";
import { ArrowDownIcon } from "./icons";
import { OrbCanvas } from "./OrbCanvas";
import { createOrbRotation, drawOrbStyle, orbDwellMs, type OrbActivity, type OrbStyle } from "./jump-orb";

/**
 * 按轮换规则选当前样式(规则见 jump-orb.ts)。
 * activity 或 commandKey 变化时立刻换一个并重新计时,否则每过一个样式的停留时间换下一个。
 */
function useOrbStyle(activity: OrbActivity | undefined, commandKey: string | undefined): OrbStyle | undefined {
  const rotation = useRef(createOrbRotation());
  const [style, setStyle] = useState<OrbStyle | undefined>();
  useEffect(() => {
    if (!activity) {
      setStyle(undefined);
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const advance = () => {
      const next = drawOrbStyle(rotation.current, activity);
      setStyle(next);
      timer = setTimeout(advance, orbDwellMs(next));
    };
    advance();
    return () => clearTimeout(timer);
  }, [activity, commandKey]);
  return activity ? style : undefined;
}

/**
 * 「回到最新」按钮里的圆球内容:没有活动时是向下箭头,思考和运行命令时轮换各自的动效。
 * running 为 false(按钮被隐藏)时逐帧动画停下。
 */
export function JumpOrb({ activity, commandKey, running }: { activity: OrbActivity | undefined; commandKey?: string; running: boolean }) {
  const style = useOrbStyle(activity, commandKey);
  return (
    <>
      <span className="jump-orb-arrow" data-on={!style}><ArrowDownIcon size={18} /></span>
      <OrbCanvas style={style} running={running} visible={Boolean(style)} />
    </>
  );
}
