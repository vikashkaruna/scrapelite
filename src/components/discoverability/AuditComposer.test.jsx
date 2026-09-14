// AuditComposer.test.jsx — one field, sensible defaults, and a goal.
//
// The contract that matters most: an option nobody chose is OMITTED from the
// request, because an absent `audit_profile` is what lets the goal and then the
// page settle it on the server.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import AuditComposer from "./AuditComposer.jsx";
import { PRIMARY_GOALS, PRIMARY_GOAL_IDS, MAX_COMPETITOR_URLS } from "../../lib/discoverability/intakeModel.js";
import { AUDIT_PROFILES } from "../../lib/discoverability/auditProfiles.js";

function setup(props = {}) {
  const onRun = vi.fn();
  const utils = render(<AuditComposer onRun={onRun} {...props} />);
  const submit = () => fireEvent.submit(utils.container.querySelector("form"));
  const typeUrl = (v) => fireEvent.change(screen.getByLabelText("URL to audit"), { target: { value: v } });
  return { ...utils, onRun, submit, typeUrl };
}

describe("AuditComposer", () => {
  it("asks for a URL instead of submitting an empty one", () => {
    const { onRun, submit } = setup();
    submit();
    expect(screen.getByRole("alert").textContent).toMatch(/Paste the URL/);
    expect(onRun).not.toHaveBeenCalled();
  });

  it("refuses something that is not a web address", () => {
    const { onRun, submit, typeUrl } = setup();
    typeUrl("not a url at all");
    submit();
    expect(screen.getByRole("alert").textContent).toMatch(/doesn't look like a web address/);
    expect(onRun).not.toHaveBeenCalled();
  });

  it("accepts a bare domain and OMITS every option nobody chose", () => {
    const { onRun, submit, typeUrl } = setup();
    typeUrl("example.com/pricing");
    submit();
    const payload = onRun.mock.calls[0][0];
    expect(payload.target_url).toBe("https://example.com/pricing");
    expect(payload).not.toHaveProperty("audit_profile");
    expect(payload).not.toHaveProperty("primary_goal");
    expect(payload).not.toHaveProperty("competitor_urls");
    expect(payload.device_profile).toBe("mobile");
    expect(payload.idempotency_key).toContain("https://example.com/pricing");
  });

  it("sends the goal once chosen, and says which view it will lead with", () => {
    const goalId = PRIMARY_GOAL_IDS[0];
    const goal = PRIMARY_GOALS[goalId];
    const { onRun, submit, typeUrl } = setup();
    const chip = screen.getByRole("button", { name: goal.label });
    fireEvent.click(chip);
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText(new RegExp(AUDIT_PROFILES[goal.suggestedProfile].label))).toBeTruthy();
    typeUrl("https://example.com");
    submit();
    expect(onRun.mock.calls[0][0].primary_goal).toBe(goalId);
    // The goal chooses a profile on the SERVER; the client still sends none.
    expect(onRun.mock.calls[0][0]).not.toHaveProperty("audit_profile");
  });

  it("refuses more competitors than are recorded, rather than silently truncating", () => {
    const { container, onRun, submit, typeUrl } = setup();
    fireEvent.click(screen.getByRole("button", { name: /Advanced options/ }));
    const list = Array.from({ length: MAX_COMPETITOR_URLS + 1 }, (_, i) => `c${i}.com`).join("\n");
    fireEvent.change(container.querySelector("textarea.dsc-textarea"), { target: { value: list } });
    typeUrl("https://example.com");
    submit();
    expect(screen.getByRole("alert").textContent).toMatch(new RegExp(`at most ${MAX_COMPETITOR_URLS}`));
    expect(onRun).not.toHaveBeenCalled();
  });

  it("sends geography only when some part of it was filled in", () => {
    const { onRun, submit, typeUrl } = setup();
    fireEvent.click(screen.getByRole("button", { name: /Advanced options/ }));
    fireEvent.change(screen.getByPlaceholderText("Bengaluru"), { target: { value: " Pune " } });
    typeUrl("https://example.com");
    submit();
    expect(onRun.mock.calls[0][0].target_geography).toEqual({ country: "", region: "", city: "Pune", language: "" });
  });

  it("tells a signed-out visitor audits need an account, before they click", () => {
    setup({ signedIn: false });
    expect(screen.getByText(/Audits need a free account/)).toBeTruthy();
  });

  it("shows the remaining monthly allowance with the right plural", () => {
    const { rerender } = setup({ remaining: 1 });
    expect(screen.getByText("1 audit left this month")).toBeTruthy();
    rerender(<AuditComposer onRun={vi.fn()} remaining={4} />);
    expect(screen.getByText("4 audits left this month")).toBeTruthy();
  });

  it("disables the goal chips while an audit is running", () => {
    setup({ running: true });
    expect(screen.getByRole("button", { name: PRIMARY_GOALS[PRIMARY_GOAL_IDS[0]].label }).disabled).toBe(true);
  });
});
