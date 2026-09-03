import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const getAiConfig = vi.fn();
const saveAiConfig = vi.fn();
const testProvider = vi.fn();
const testAllProviders = vi.fn();
vi.mock("../../lib/adminConfigService.js", () => ({
  getAiConfig: (...a) => getAiConfig(...a),
  saveAiConfig: (...a) => saveAiConfig(...a),
  testProvider: (...a) => testProvider(...a),
  testAllProviders: (...a) => testAllProviders(...a),
}));
const toast = vi.fn();
vi.mock("../../components/Toast.jsx", () => ({ useToast: () => toast }));

const AdminAI = (await import("./AdminAI.jsx")).default;

// A response shaped like the real GET, so the test fails if that shape changes.
const RESPONSE = () => ({
  ok: true,
  config: {
    order: ["gemini", "anthropic", "openai"],
    models: { gemini: "gemini-2.5-pro", openai: "gpt-4o" },
    modelsFast: { gemini: "gemini-2.0-flash", openai: "gpt-4o-mini" },
    enabled: { gemini: true, openai: true },
    maxTokens: 4096,
    pillars: {},
  },
  effective: {},
  keyPresence: { gemini: true, openai: true },
  providers: {},
  catalogue: {
    providers: [
      { key: "gemini", kind: "ai", label: "Google Gemini", requiresKey: true, apiKey: { present: true },
        models: { catalogue: ["gemini-2.0-flash", "gemini-2.5-pro"], defaultFast: "gemini-2.0-flash", defaultDeep: "gemini-2.5-pro" },
        areas: ["enrichment"] },
      { key: "openai", kind: "ai", label: "OpenAI", requiresKey: true, apiKey: { present: true },
        models: { catalogue: ["gpt-4o-mini", "gpt-4o"], defaultFast: "gpt-4o-mini", defaultDeep: "gpt-4o" },
        areas: ["synthesis"] },
    ],
  },
  persisted: true,
});

beforeEach(() => {
  vi.clearAllMocks();
  getAiConfig.mockResolvedValue(RESPONSE());
  saveAiConfig.mockResolvedValue({ ok: true, persisted: true });
});

const deepInputFor = async (label) => {
  await screen.findByText(label);
  const card = screen.getByText(label).closest("[class*='prov']") || document.body;
  return card.querySelectorAll("input[list]")[0];
};

describe("AdminAI — an edit must actually reach the server", () => {
  it("loads the stored models into the fields", async () => {
    render(<AdminAI />);
    await waitFor(() => expect(getAiConfig).toHaveBeenCalled());
    expect(await screen.findByDisplayValue("gemini-2.5-pro")).toBeInTheDocument();
    expect(screen.getByDisplayValue("gpt-4o-mini")).toBeInTheDocument();
  });

  // THE REPORTED BUG. If an edit does not appear in the save payload, the
  // config silently never changes however many times Save is pressed.
  it("sends an edited DEEP model id in the save payload", async () => {
    render(<AdminAI />);
    const input = await screen.findByDisplayValue("gemini-2.5-pro");
    fireEvent.change(input, { target: { value: "gemini-3.0-ultra" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(saveAiConfig).toHaveBeenCalled());
    expect(saveAiConfig.mock.calls[0][0].models.gemini).toBe("gemini-3.0-ultra");
  });

  it("sends an edited FAST model id too", async () => {
    render(<AdminAI />);
    const input = await screen.findByDisplayValue("gpt-4o-mini");
    fireEvent.change(input, { target: { value: "gpt-4.1-mini" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(saveAiConfig).toHaveBeenCalled());
    expect(saveAiConfig.mock.calls[0][0].modelsFast.openai).toBe("gpt-4.1-mini");
  });

  // The editable-dropdown the owner asked for: a <datalist> gives suggestions
  // while leaving the field free text, so a model published after this deploy
  // can still be typed in.
  it("offers the catalogue as suggestions without restricting the field", async () => {
    render(<AdminAI />);
    await screen.findByDisplayValue("gemini-2.5-pro");
    const lists = document.querySelectorAll("datalist");
    expect(lists.length).toBeGreaterThan(0);
    const options = [...document.querySelectorAll("datalist option")].map((o) => o.value);
    expect(options).toContain("gemini-2.5-pro");
    expect(options).toContain("gpt-4o");
    // Free text must still be possible.
    const input = screen.getByDisplayValue("gemini-2.5-pro");
    expect(input.tagName).toBe("INPUT");
    expect(input.getAttribute("list")).toBeTruthy();
  });

  it("re-reads from the server after saving, so the screen shows effective values", async () => {
    render(<AdminAI />);
    await screen.findByDisplayValue("gemini-2.5-pro");
    expect(getAiConfig).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(getAiConfig).toHaveBeenCalledTimes(2));
  });

  // A failed save must SAY so. A silent failure is indistinguishable from
  // "saved but nothing changed", which is exactly the reported symptom.
  it("surfaces a failed save instead of looking successful", async () => {
    saveAiConfig.mockRejectedValue(new Error("Save failed (401)"));
    render(<AdminAI />);
    await screen.findByDisplayValue("gemini-2.5-pro");
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringMatching(/401|failed/i)));
  });
});
