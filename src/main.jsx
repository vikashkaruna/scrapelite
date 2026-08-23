import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router";
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
    {/*
      No `future` prop: react-router 8 removed it, and both flags this used to
      pass are now the behaviour you get by default. Keeping them would have
      been dead config that reads like it still does something.

      `v7_relativeSplatPath` is simply how v8 resolves splat routes.

      `v7_startTransition` is the one worth stating, because the obvious
      translation is wrong. v8 replaced it with a `useTransitions` prop, but
      the router only skips startTransition on an explicit
      `useTransitions={false}` — leaving it undefined already wraps every
      location update in startTransition, which is exactly what the old flag
      bought. `useTransitions={true}` is NOT the equivalent: that opts into a
      further startTransition + useOptimistic mode we have not evaluated.
    */}
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
