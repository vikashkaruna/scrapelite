// src/components/ScrapeConsentModal.test.jsx
//
// The dialog behind an override of a robots.txt refusal. Its safety properties
// are all in the interaction, so they are what is tested:
//   - it states the site said no, rather than framing the override as routine;
//   - Confirm is DISABLED until the box is ticked (an attestation nobody
//     actively made is not an attestation);
//   - a storage failure surfaces instead of silently reporting success.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ScrapeConsentModal from "./ScrapeConsentModal.jsx";

const mocks = vi.hoisted(() => ({ grantConsentFor: vi.fn() }));
vi.mock("../lib/scrapeConsentService.js", () => ({
  grantConsentFor: mocks.grantConsentFor,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.grantConsentFor.mockResolvedValue({ ok: true, host: "linkedin.com" });
});

function renderModal(props = {}) {
  const onGranted = vi.fn();
  const onCancel = vi.fn();
  render(
    <ScrapeConsentModal
      host="linkedin.com"
      url="https://www.linkedin.com/in/example-person"
      onGranted={onGranted}
      onCancel={onCancel}
      {...props}
    />,
  );
  return { onGranted, onCancel };
}

const confirmBtn = () => screen.getByRole("button", { name: /confirm and extract/i });
const checkbox = () => screen.getByRole("checkbox");

describe("ScrapeConsentModal", () => {
  it("names the host and says the site declined", () => {
    renderModal();
    expect(screen.getByText(/linkedin\.com asks tools not to extract it/i)).toBeTruthy();
    expect(screen.getByText(/robots\.txt/i)).toBeTruthy();
  });

  it("says no credit was used, because none was", () => {
    renderModal();
    expect(screen.getByText(/no credit was used/i)).toBeTruthy();
  });

  it("disables Confirm until the box is ticked", () => {
    renderModal();
    expect(confirmBtn()).toBeDisabled();
    fireEvent.click(checkbox());
    expect(confirmBtn()).not.toBeDisabled();
  });

  it("records nothing while the box is unticked", async () => {
    renderModal();
    fireEvent.click(confirmBtn());
    await waitFor(() => expect(mocks.grantConsentFor).not.toHaveBeenCalled());
  });

  it("records the attestation and hands back control on confirm", async () => {
    const { onGranted } = renderModal();
    fireEvent.click(checkbox());
    fireEvent.click(confirmBtn());
    await waitFor(() => expect(onGranted).toHaveBeenCalledWith("linkedin.com"));
    expect(mocks.grantConsentFor).toHaveBeenCalledWith("linkedin.com", "extract_refusal");
  });

  it("states the scope and the expiry, so the grant is not read as blanket", () => {
    renderModal();
    expect(screen.getByText(/180 days/i)).toBeTruthy();
    expect(screen.getByText(/does not cover other sites/i)).toBeTruthy();
  });

  it("surfaces a storage failure instead of pretending it worked", async () => {
    mocks.grantConsentFor.mockRejectedValue(new Error("Could not record your confirmation."));
    const { onGranted } = renderModal();
    fireEvent.click(checkbox());
    fireEvent.click(confirmBtn());
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(onGranted).not.toHaveBeenCalled();
  });

  it("cancels without recording anything", () => {
    const { onCancel } = renderModal();
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalled();
    expect(mocks.grantConsentFor).not.toHaveBeenCalled();
  });
});
