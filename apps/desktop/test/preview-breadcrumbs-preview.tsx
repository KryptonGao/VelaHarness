import { useState } from "react";
import { createRoot } from "react-dom/client";
import { PreviewBreadcrumbs } from "../src/renderer/components/preview/PreviewBreadcrumbs";
import { InterfacePage } from "../src/renderer/components/settings/InterfacePage";
import { settingsCopy } from "../src/renderer/components/settings-copy";
import { usePreferences } from "../src/renderer/hooks/usePreferences";
import { AppLocaleProvider } from "../src/renderer/locale";

const longPath = ["VelaHarness", "apps", "desktop", "src", "renderer", "components", "preview"];

function Fixture() {
  const preferences = usePreferences();
  const [short, setShort] = useState(false);
  Object.assign(window, { setShortPath: setShort });
  return <AppLocaleProvider locale={preferences.locale}>
    <div id="panel" style={{ width: 500, margin: 24 }}>
      <div className="preview-subbar">
        <PreviewBreadcrumbs crumbs={short ? ["src"] : longPath} current={short ? "a.ts" : "ThinkingGroupModeContext.tsx"} iconPath="a.tsx" ariaLabel="File path" />
        <div className="preview-actions-group"><button type="button">Action</button></div>
      </div>
      <div className="preview-subbar">
        <PreviewBreadcrumbs crumbs={["VelaHarness"]} current="Files" ariaLabel="Files" />
      </div>
    </div>
    <InterfacePage copy={settingsCopy(preferences.locale)} preferences={preferences} onPreviewSound={() => {}} />
  </AppLocaleProvider>;
}

createRoot(document.getElementById("root")!).render(<Fixture />);
