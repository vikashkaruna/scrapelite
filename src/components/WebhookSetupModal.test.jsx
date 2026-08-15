// src/components/WebhookSetupModal.test.jsx
//
// F-44 — WebhookSetupModal:
//   - Renders the modal with status pill
//   - Saving a valid URL persists it
//   - Invalid URL shows an error
//   - Test event button fires a POST and shows success / fail
//   - Clear button removes the user URL
//   - The full URL is never shown back to the user (security)

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import WebhookSetupModal from "./WebhookSetupModal.jsx";
import { STORAGE_KEY } from "../lib/userWebhook.js";

// Stub the toast hook so the modal can call showToast() without
// pulling in the ToastProvider.
const toast = vi.fn();
vi.mock("./Toast.jsx", () => ({
  useToast: () => toast,
}));

// Pin the PLATFORM webhook URL to "unset".
//
// resolveWebhookUrl() falls back to config.js's WEBHOOK_URL, which Vite inlines
// from VITE_WEBHOOK_URL in .env. Every developer has one (the README tells them
// to), so "no URL is set anywhere" was false on a real machine and these two
// tests failed locally while passing in CI, which has no .env.
//
// Every assertion in this file concerns the USER-set URL in localStorage; none
// exercises the platform fallback. Pinning it off makes the suite depend on the
// fixture rather than on whoever is running it.
vi.mock("../lib/config.js", async (importOriginal) => ({
  ...(await importOriginal()),
  WEBHOOK_URL: "",
  hasWebhook: false,
}));

function renderModal(props = {}) {
  const onClose = vi.fn();
  const utils = render(<WebhookSetupModal open onClose={onClose} {...props} />);
  return { onClose, ...utils };
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  toast.mockReset();
  globalThis.fetch = vi.fn(async () => new Response("", { status: 200 }));
});

afterEach(() => {
  localStorage.clear();
});

describe("WebhookSetupModal — rendering", () => {
  it("renders the dialog with eyebrow, title, and a URL input", () => {
    renderModal();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/Webhook \/ n8n/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/your webhook url/i)).toBeInTheDocument();
  });

  it("shows 'Not configured' when no URL is set anywhere", () => {
    renderModal();
    expect(screen.getByText(/Not configured/i)).toBeInTheDocument();
  });

  it("shows 'Your URL is active' when a user URL is already saved", () => {
    localStorage.setItem(STORAGE_KEY, "https://hooks.zapier.com/abc/xyz");
    renderModal();
    expect(screen.getByText(/Your URL is active/i)).toBeInTheDocument();
  });
});

describe("WebhookSetupModal — save", () => {
  it("saves a valid URL to localStorage and shows the success toast", () => {
    renderModal();
    const input = screen.getByLabelText(/your webhook url/i);
    fireEvent.change(input, { target: { value: "https://hooks.zapier.com/abc/xyz" } });
    fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));
    expect(localStorage.getItem(STORAGE_KEY)).toBe("https://hooks.zapier.com/abc/xyz");
    expect(toast).toHaveBeenCalledWith("Webhook URL saved", "success");
  });

  it("rejects an invalid URL and shows an inline error", () => {
    renderModal();
    const input = screen.getByLabelText(/your webhook url/i);
    fireEvent.change(input, { target: { value: "not-a-url" } });
    // Submit the form directly so the validation runs regardless of
    // how the click bubbles through the Button wrapper.
    const form = input.closest("form");
    fireEvent.submit(form);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(screen.getByText(/valid http\(s\) URL/i)).toBeInTheDocument();
  });

  it("rejects a javascript: URL (XSS guard)", () => {
    renderModal();
    const input = screen.getByLabelText(/your webhook url/i);
    fireEvent.change(input, { target: { value: "javascript:alert(1)" } });
    fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(screen.getByText(/valid http\(s\) URL/i)).toBeInTheDocument();
  });

  it("does not show the full URL anywhere in the DOM (no leak)", () => {
    localStorage.setItem(STORAGE_KEY, "https://hooks.zapier.com/abc/xyz");
    renderModal();
    // The full URL must not appear. The host's TLD (.com) is too
    // common to be a useful fingerprint, but the unique path
    // "abc/xyz" must not be in the DOM.
    expect(document.body.textContent).not.toContain("abc/xyz");
  });
});

describe("WebhookSetupModal — clear", () => {
  it("removes the user URL when Clear is clicked", () => {
    localStorage.setItem(STORAGE_KEY, "https://hooks.zapier.com/abc/xyz");
    renderModal();
    const clearBtn = screen.getByRole("button", { name: /clear my url/i });
    fireEvent.click(clearBtn);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/cleared/i), "info");
  });
});

describe("WebhookSetupModal — test event", () => {
  it("sends a POST with the test payload to a valid URL", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 200 }));
    globalThis.fetch = fetchMock;
    renderModal();
    const input = screen.getByLabelText(/your webhook url/i);
    fireEvent.change(input, { target: { value: "https://hooks.zapier.com/abc" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /send test event/i }));
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://hooks.zapier.com/abc");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    expect(body.event).toBe("extraction.saved");
    expect(body.test).toBe(true);
  });

  it("shows a success result on 2xx", async () => {
    globalThis.fetch = vi.fn(async () => new Response("", { status: 200 }));
    renderModal();
    const input = screen.getByLabelText(/your webhook url/i);
    fireEvent.change(input, { target: { value: "https://x.com/y" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /send test event/i }));
    });
    expect(screen.getByText(/delivered/i)).toBeInTheDocument();
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/delivered/i), "success");
  });

  it("shows a failure result on 5xx", async () => {
    globalThis.fetch = vi.fn(async () => new Response("nope", { status: 503 }));
    renderModal();
    const input = screen.getByLabelText(/your webhook url/i);
    fireEvent.change(input, { target: { value: "https://x.com/y" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /send test event/i }));
    });
    expect(screen.getByText(/503/)).toBeInTheDocument();
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/failed/i), "error");
  });

  it("shows a network-error result on fetch throw", async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error("Network unreachable"); });
    renderModal();
    const input = screen.getByLabelText(/your webhook url/i);
    fireEvent.change(input, { target: { value: "https://x.com/y" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /send test event/i }));
    });
    expect(screen.getByText(/Network unreachable/)).toBeInTheDocument();
  });

  it("blocks the test when no URL is set anywhere", async () => {
    renderModal();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /send test event/i }));
    });
    expect(screen.getByText(/Enter a URL first/i)).toBeInTheDocument();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe("WebhookSetupModal — close", () => {
  it("calls onClose when the X button is clicked", () => {
    const onClose = vi.fn();
    render(<WebhookSetupModal open onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose on Escape", () => {
    const onClose = vi.fn();
    render(<WebhookSetupModal open onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
