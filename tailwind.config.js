/** @type {import('tailwindcss').Config} */
// Tailwind is wired alongside the hand-written design system in src/styles.
// The design tokens live as CSS custom properties (see src/styles/styles.css);
// we surface the most useful ones here so utility classes can reference them,
// e.g. `bg-surface`, `text-text-2`, `rounded-r`, `shadow-card`.
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        accent: "var(--accent)",
        "accent-soft": "var(--accent-soft)",
        bg: "var(--bg)",
        surface: "var(--surface)",
        "surface-2": "var(--surface-2)",
        border: "var(--border)",
        "border-strong": "var(--border-strong)",
        text: "var(--text)",
        "text-2": "var(--text-2)",
        "text-3": "var(--text-3)",
      },
      borderRadius: {
        r: "var(--r)",
        "r-sm": "var(--r-sm)",
        "r-lg": "var(--r-lg)",
        pill: "var(--r-pill)",
      },
      boxShadow: {
        card: "var(--shadow)",
        "card-sm": "var(--shadow-sm)",
        "card-lg": "var(--shadow-lg)",
        accent: "var(--shadow-accent)",
      },
      fontFamily: {
        sans: "var(--font)",
      },
    },
  },
  plugins: [],
};
