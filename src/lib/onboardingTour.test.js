// src/lib/onboardingTour.test.js — onboarding tour pure-logic tests.
//
// Covers both registered tours ("home", "discoverability") sharing the same
// read/write/progress logic but independent localStorage flags.

import { describe, expect, it, beforeEach } from "vitest";
import {
  getTourSteps, isTourCompleted, isTourSkipped, shouldAutoStart,
  markCompleted, markSkipped, resetTour,
  nextStep, prevStep, progressFraction,
} from "./onboardingTour.js";

beforeEach(() => {
  try { localStorage.clear(); } catch {}
});

describe("onboardingTour — home tour (default)", () => {
  it("getTourSteps defaults to the home tour with 8 steps", () => {
    expect(getTourSteps()).toHaveLength(8);
    expect(getTourSteps("home")).toBe(getTourSteps());
  });

  it("the modes step enumerates 5 quick actions and 6 outcome tiles", () => {
    const steps = getTourSteps();
    const modes = steps.find((s) => s.key === "modes");
    expect(modes).toBeDefined();
    expect(modes.body).toMatch(/Outcome tiles \(6\)/i);
    expect(modes.body).toMatch(/Quick actions \(5\)/i);
  });

  it("covers Discoverability and Schedules/Workspace/Push, not just the pre-2026-08 feature set", () => {
    const steps = getTourSteps();
    const bodies = steps.map((s) => s.body).join(" ");
    expect(bodies).toMatch(/discover/i);
    expect(bodies).toMatch(/schedule/i);
    expect(bodies).toMatch(/workspace/i);
    expect(bodies).toMatch(/push/i);
  });

  it("each step has a key, title, body, and a valid placement", () => {
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

  it("persists under the pre-existing storage key so completed/skipped users aren't re-prompted", () => {
    markCompleted();
    expect(localStorage.getItem("datiq.onboardingTour.v1")).toContain("completedAt");
  });
});

describe("onboardingTour — discoverability tour", () => {
  it("has its own step list, independent of the home tour", () => {
    const steps = getTourSteps("discoverability");
    expect(steps.length).toBeGreaterThan(0);
    expect(steps).not.toBe(getTourSteps("home"));
    expect(steps.some((s) => s.target === ".dsc-composer")).toBe(true);
    expect(steps.some((s) => s.target === ".dsc-intro-grid")).toBe(true);
  });

  it("tracks completed/skipped separately from the home tour", () => {
    markCompleted("home");
    expect(isTourCompleted("home")).toBe(true);
    expect(isTourCompleted("discoverability")).toBe(false);
    expect(shouldAutoStart("discoverability")).toBe(true);

    markSkipped("discoverability");
    expect(isTourSkipped("discoverability")).toBe(true);
    expect(isTourSkipped("home")).toBe(false);
  });

  it("persists under its own storage key", () => {
    markCompleted("discoverability");
    expect(localStorage.getItem("datiq.discoverabilityTour.v1")).toContain("completedAt");
    expect(localStorage.getItem("datiq.onboardingTour.v1")).toBeNull();
  });

  it("resetTour only clears the tour it's given", () => {
    markCompleted("home");
    markCompleted("discoverability");
    resetTour("discoverability");
    expect(isTourCompleted("home")).toBe(true);
    expect(isTourCompleted("discoverability")).toBe(false);
  });
});

describe("onboardingTour — shared step-navigation helpers", () => {
  it("nextStep clamps to the last index", () => {
    expect(nextStep(0, 8)).toBe(1);
    expect(nextStep(7, 8)).toBe(7);
    expect(nextStep(10, 8)).toBe(7);
  });

  it("prevStep clamps to 0", () => {
    expect(prevStep(2)).toBe(1);
    expect(prevStep(0)).toBe(0);
    expect(prevStep(-1)).toBe(0);
  });

  it("progressFraction computes a 0..1 ratio", () => {
    expect(progressFraction(0, 8)).toBeCloseTo(1 / 8, 5);
    expect(progressFraction(7, 8)).toBe(1);
    expect(progressFraction(0, 1)).toBe(1);
  });
});
