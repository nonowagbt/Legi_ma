import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { isDesktop } from "./platform";
import "./styles.css";

// Version web en production : installable sur mobile et ordinateur (PWA).
if (import.meta.env.PROD && !isDesktop && "serviceWorker" in navigator) {
  window.addEventListener("load", () => void navigator.serviceWorker.register("/sw.js"));
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
