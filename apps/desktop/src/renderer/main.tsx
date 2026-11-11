import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { installFocusModality } from "./focus-modality";
import { installRendererLogging } from "./logger";
import { syncModelPrices } from "./model-prices";
import "./styles.css";
import "./acceptance.css";
import "./components/intelligent-ui/intelligent-ui.css";
import "./version-control.css";
import "./version-control-p2.css";
import "./version-control-review.css";
import "./version-control-composer-review.css";
import "./side-chat.css";
import "./selection-actions.css";
import "./info-cards.css";

installRendererLogging();
installFocusModality();
void syncModelPrices();

const root = document.getElementById("root");
if (!root) throw new Error("缺少根节点");

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
