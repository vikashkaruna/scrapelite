import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import { runMigrations } from "./lib/migrationService.js";
// Order matters: Tailwind base first, then the design system so its tokens and
// component styles take precedence over Tailwind's preflight.
import "./index.css";
import "./styles/design-system.css";
import "./styles/screens.css";

runMigrations();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
