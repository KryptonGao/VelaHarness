import { createRoot } from "react-dom/client";
import { BrowserController } from "../src/renderer/browser/browser-controller";
import { BrowserPanel } from "../src/renderer/components/browser/BrowserPanel";
import { RecommendedActionsCard } from "../src/renderer/components/RecommendedActionsCard";
import "../src/renderer/styles.css";

const label = "工作区 / Complicated project title";
const url = "https://example.test/long/address/to/a/particular/file";
const browser = new BrowserController();
browser.store.update({ url, address: url });
createRoot(document.getElementById("root")!).render(<div id="fixture" style={{ width: 280 }}>
  <div className="session-group-header"><span className="session-group-name">{label}</span><svg aria-hidden="true" width="12" height="12" /></div>
  <RecommendedActionsCard recommendation={{ question: "Next?", actions: [{ label, prompt: "read the file" }] }}
    onDismiss={() => {}} onSelect={async action => { document.body.dataset.selected = action.prompt; }} />
  <div className="input-textarea rich-input" contentEditable suppressContentEditableWarning data-empty="true" data-placeholder={url} />
  <BrowserPanel controller={browser} tabId="test" />
</div>);
