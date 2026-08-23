// src/components/NotifyMeModal.test.jsx — F18 (notify-me modal component).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import NotifyMeModal from "./NotifyMeModal.jsx";

const showToast = vi.fn();
vi.mock("./Toast.jsx", () => ({
  useToast: () => showToast,
}));

const notifyMeWhenAvailable = vi.fn();
vi.mock("../lib/integrationsNotify.js", () => ({
  notifyMeWhenAvailable: (...args) => notifyMeWhenAvailable(...args),
  isWaitlisted: () => false,
  getWaitlistedIntegrations: () => new Set(),
}));

beforeEach(() => {
  showToast.mockReset();
  notifyMeWhenAvailable.mockReset();
});

function renderModal(props) {
  return render(
    <MemoryRouter>
      <NotifyMeModal open={true} slug="airtable" label="Airtable" onClose={() => {}} {...props} />
    </MemoryRouter>,
  );
}

describe("NotifyMeModal (F18)", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <MemoryRouter>
        <NotifyMeModal open={false} slug="airtable" label="Airtable" />
      </MemoryRouter>,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the title with the integration label", () => {
    renderModal();
    expect(screen.getByRole("heading", { name: /Get notified when Airtable ships/i })).toBeInTheDocument();
  });

  it("renders an email input with autofocus", () => {
    renderModal();
    const input = screen.getByLabelText(/Your email/i);
    expect(input).toBeInTheDocument();
    expect(input.getAttribute("type")).toBe("email");
  });

  it("calls notifyMeWhenAvailable on submit and closes", async () => {
    notifyMeWhenAvailable.mockResolvedValue({ ok: true, slug: "airtable" });
    renderModal();
    const input = screen.getByLabelText(/Your email/i);
    fireEvent.change(input, { target: { value: "you@x.com" } });
    fireEvent.click(screen.getByRole("button", { name: /Notify me/i }));
    await waitFor(() => {
      expect(notifyMeWhenAvailable).toHaveBeenCalledWith("airtable", "you@x.com");
    });
    expect(showToast).toHaveBeenCalledWith(expect.stringMatching(/you're on the list/i), expect.any(String));
  });

  it("surfaces an error message when notifyMeWhenAvailable throws", async () => {
    notifyMeWhenAvailable.mockRejectedValue(new Error("Email invalid"));
    renderModal();
    fireEvent.change(screen.getByLabelText(/Your email/i), { target: { value: "ok@x.com" } });
    fireEvent.click(screen.getByRole("button", { name: /Notify me/i }));
    expect(await screen.findByText(/Email invalid/)).toBeInTheDocument();
  });

  it("has a 'subscribe to changelog' secondary link", () => {
    renderModal();
    const link = screen.getByText(/subscribe to the changelog/i);
    expect(link).toBeInTheDocument();
  });
});
