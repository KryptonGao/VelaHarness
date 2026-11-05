/** Real ShortcutsPage with an in-memory UI store. Open manually or run shortcuts-ui.mjs. ?platform=win32 shows the Windows layout. */
import React from "react";
import { createRoot } from "react-dom/client";
import { setActiveLocale } from "../src/renderer/locale";
import { settingsCopy } from "../src/renderer/components/settings-copy";
import { ShortcutsPage } from "../src/renderer/components/settings/ShortcutsPage";
import "../src/renderer/styles.css";

setActiveLocale("en");
const platform = new URLSearchParams(location.search).get("platform") ?? "darwin";
createRoot(document.getElementById("root")!).render(<div style={{ maxWidth: 760, margin: "0 auto", padding: 24 }}><ShortcutsPage copy={settingsCopy("en")} platform={platform} /></div>);
