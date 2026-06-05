// ThemeProvider.jsx — light/dark theme, applied as data-theme on <html> and
// persisted to localStorage. (The full design "Tweaks" customizer was scoped
// out for the MVP; the Indigo identity and other tokens stay fixed.)
import { createContext, useContext, useEffect, useState } from "react";

const ThemeContext = createContext({ theme: "light", toggle: () => {} });

export function useTheme() {
  return useContext(ThemeContext);
}

function initialTheme() {
  try {
    const saved = localStorage.getItem("scrapelite.theme");
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    /* ignore */
  }
  const prefersDark =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  return prefersDark ? "dark" : "light";
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(initialTheme);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem("scrapelite.theme", theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  const toggle = () => setTheme((t) => (t === "dark" ? "light" : "dark"));

  return (
    <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>
  );
}
