import type { ComponentProps } from "react";
import { StartView as Launcher } from "../src/renderer/components/StartView";

// Existing embedded-chat lifecycle tests still need to seed independent chat tabs.
// Keep their setup outside the production launcher and its layout/focus order.
export function StartView(props: ComponentProps<typeof Launcher>) {
  return <><Launcher {...props} /><button hidden type="button" data-fixture-create-chat
    disabled={props.pending} onClick={() => props.onAction("chat")} /></>;
}
