// src/lib/onboardingTour.test.js — Q4 tour pure-logic tests.

import { describe, expect, it, beforeEach } from "vitest";
import {
  getTourSteps, isTourCompleted, isTourSkipped, shouldAutoStart,
  markCompleted, markSkipped, resetTour,
  nextStep, prevStep, progressFraction,
} from "./onboardingTour.js";

beforeEach(() => {
  try { localStorage.clear(); } catch {}
});

describe("Q4 — onboardingTour: pure logic", () => {
  it("getTourSteps returns 7 steps (added the 'modes' step in F15 follow-up)", () => {
    expect(getTourSteps()).toHaveLength(7);
  });

  it("the modes step enumerates 5 quick actions and 6 outcome tiles", () => {
    const steps = getTourSteps();
    const modes = steps.find((s) => s.key === "modes");
    expect(modes).toBeDefined();
    expect(modes.body).toMatch(/Outcome tiles \(6\)/i);
    expect(modes.body).toMatch(/Quick actions \(5\)/i);
  });

  it("each step has a key, title, body, target, and placement", () => {
    for (const s of getTourSteps()) {
      expect(s.key).toBeTypeOf("string");
      expect(s.title).toBeTypeOf("string");
      expect(s.body).toBeTypeOf("string");
      expect(["top", "bottom", "left", "right", "center"]).toContain(s.placement);
    }
  });

  it("isTourCompleted / isTourSkipped are false by default", () => {
    expect(isTourCompleted()).toBe(false);
    expect(isTourSkipped()).toBe(false);
    expect(shouldAutoStart()).toBe(true);
  });

  it("markCompleted marks the tour as completed", () => {
    markCompleted();
    expect(isTourCompleted()).toBe(true);
    expect(shouldAutoStart()).toBe(false);
  });

  it("markSkipped marks the tour as skipped", () => {
    markSkipped();
    expect(isTourSkipped()).toBe(true);
    expect(shouldAutoStart()).toBe(false);
  });

  it("resetTour clears both completed and skipped", () => {
    markCompleted();
    markSkipped();
    resetTour();
    expect(isTourCompleted()).toBe(false);
    expect(isTourSkipped()).toBe(false);
  });

  it("nextStep clamps to the last index", () => {
    expect(nextStep(0, 7)).toBe(1);
    expect(nextStep(6, 7)).toBe(6);
    expect(nextStep(10, 7)).toBe(6);
  });

  it("prevStep clamps to 0", () => {
    expect(prevStep(2)).toBe(1);
    expect(prevStep(0)).toBe(0);
    expect(prevStep(-1)).toBe(0);
  });

  it("progressFraction computes a 0..1 ratio", () => {
    expect(progressFraction(0, 7)).toBeCloseTo(1 / 7, 5);
    expect(progressFraction(6, 7)).toBe(1);
    expect(progressFraction(0, 1)).toBe(1);
  });
});
