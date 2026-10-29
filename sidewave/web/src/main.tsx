import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import App from "./App";
import { MembershipGate } from "./bilesenler/Membership";
import { ToastProvider } from "./bilesenler/Toast";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MembershipGate><ToastProvider><App /></ToastProvider></MembershipGate>
  </StrictMode>,
);
