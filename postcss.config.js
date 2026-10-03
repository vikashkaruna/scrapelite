export default {
  plugins: {
    "@tailwindcss/postcss": {},
    // Kept (Tailwind 4 prefixes its own output) so the hand-written design
    // system CSS gets exactly the same vendor prefixes it always did.
    autoprefixer: {},
  },
};
