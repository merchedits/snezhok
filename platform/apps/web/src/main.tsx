import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { AppProvider } from "./state/AppContext.js";
import { CallProvider } from "./state/CallContext.js";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Application root is missing.");

createRoot(root).render(
  <StrictMode>
    <AppProvider>
      <CallProvider>
        <App />
      </CallProvider>
    </AppProvider>
  </StrictMode>,
);
