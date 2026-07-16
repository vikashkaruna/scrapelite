// test/a11y-setup.js — Vitest a11y matchers.
// Loaded alongside setup.js from vite.config.js so every test file can use
// `toHaveNoViolations()` from vitest-axe. The actual a11y assertions live
// in the integration / system specs that opt in by importing the matcher.
//
// vitest-axe 0.1 ships an empty `extend-expect.js` and expects consumers
// to call `expect.extend(matchers)` themselves. Doing that here means the
// matcher is registered exactly once for the whole test suite.

import * as matchers from "vitest-axe/matchers";
import { expect } from "vitest";

expect.extend(matchers);
