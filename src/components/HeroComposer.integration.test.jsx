// src/components/HeroComposer.integration.test.jsx
// I-01..04 — HeroComposer integration.
//
//   - I-01: Paste-anything — non-URL raw text dispatches extract() with a
//           raw_text-shaped payload (no network call).
//   - I-03: Batch toggle on → multi-URL textarea; off → single URL.
//   - I-04: "Custom" intent → prompt textarea appears; submit passes
//           customPrompt to extract().

import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter, useLocation } from "react-router";
import HeroComposer from "./HeroComposer.jsx";
import { ExtractionProvider } from "./ExtractionProvider.jsx";
import { ToastProvider } from "./Toast.jsx";
import { ErrorModalProvider } from "./ErrorModal.jsx";
import { AuthProvider } from "./AuthProvider.jsx";
import { PersonaProvider } from "./PersonaProvider.jsx";
import { BillingProvider } from "./BillingProvider.jsx";
import { GuestTrialProvider } from "./GuestTrialProvider.jsx";

const firecrawlMocks = vi.hoisted(() => ({
  extractStructure: vi.fn(),
}));

const aiMocks = vi.hoisted(() => ({
  summarize: vi.fn(),
  categorizeLinks: vi.fn(),
  generateContent: vi.fn(),
}));

const authMocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
}));

const apiMocks = vi.hoisted(() => ({
  listExtractions: vi.fn().mockResolvedValue([]),
  saveExtraction: vi.fn().mockResolvedValue({ id: "ext_test" }),
  patchExtraction: vi.fn(),
  deleteExtraction: vi.fn(),
}));

vi.mock("../lib/firecrawlService.js", () => ({
  extractStructure: firecrawlMocks.extractStructure,
  mapDomain: vi.fn(),
}));

vi.mock("../lib/aiService.js", () => ({
  summarize: aiMocks.summarize,
  categorizeLinks: aiMocks.categorizeLinks,
  generateContent: aiMocks.generateContent,
}));

vi.mock("../lib/apiClient.js", () => ({
  apiClient: apiMocks,
  setAuthToken: vi.fn(),
}));

vi.mock("../lib/authService.js", async () => {
  const actual = await vi.importActual("../lib/authService.js");
  return {
    ...actual,
    getSession: authMocks.getSession,
    onAuthStateChange: authMocks.onAuthStateChange,
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  // Default mocks: extractStructure returns a basic page shape and passes
  // the options object through (so tests can assert on raw_text / prompt).
  firecrawlMocks.extractStructure.mockImplementation(async (url, options = {}) => ({
    url,
    html: "<html><body>mock</body></html>",
    metadata: { title: "Mock page" },
    headings: [],
    links: [],
    domain_map: null,
    _options: options,
  }));
  aiMocks.summarize.mockResolvedValue("Mock summary");
  aiMocks.categorizeLinks.mockResolvedValue([]);
  authMocks.getSession.mockResolvedValue(null);
  authMocks.onAuthStateChange.mockReturnValue(() => {});
  window.history.replaceState(null, "", window.location.pathname);
});

function Probe() {
  const { pathname } = useLocation();
  return <div data-testid="location">{pathname}</div>;
}

function Tree({ initialValue = "", intent = "summary", customPrompt = "", onCustomPromptChange }) {
  const [value, setValue] = useState(initialValue);
  return (
    <MemoryRouter
      initialEntries={["/"]}
    >
      <ToastProvider>
        <ErrorModalProvider>
          <AuthProvider>
            <GuestTrialProvider>
              <PersonaProvider>
                <BillingProvider>
                  <ExtractionProvider>
                    <Probe />
                    <HeroComposer
                      value={value}
                      onChange={setValue}
                      intent={intent}
                      customPrompt={customPrompt}
                      onCustomPromptChange={onCustomPromptChange}
                    />
                  </ExtractionProvider>
                </BillingProvider>
              </PersonaProvider>
            </GuestTrialProvider>
          </AuthProvider>
        </ErrorModalProvider>
      </ToastProvider>
    </MemoryRouter>
  );
}

describe("I-01 — HeroComposer: paste-anything (raw text)", () => {
  it("non-URL raw text → extractStructure called with raw_text payload (no real URL)", async () => {
    const rawText =
      "Lorem ipsum dolor sit amet, consectetur adipiscing elit. " +
      "Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.";
    render(<Tree initialValue={rawText} />);
    const btn = screen.getByRole("button", { name: /^extract$/i });
    await act(async () => {
      fireEvent.click(btn);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(firecrawlMocks.extractStructure).toHaveBeenCalledTimes(1);
    const [urlArg, optionsArg] = firecrawlMocks.extractStructure.mock.calls[0];
    // The "url" is a pseudo-URL of the form text://pasted-...
    expect(urlArg).toMatch(/^text:\/\//);
    // The raw text rides along in options.rawText (camelCase, per HeroComposer).
    expect(optionsArg).toHaveProperty("rawText", rawText);
  });
});

describe("I-03 — HeroComposer: batch toggle", () => {
  it("two URLs → multi-URL mode renders the textarea with both URLs", () => {
    const initial = "https://a.example.com\nhttps://b.example.com";
    render(<Tree initialValue={initial} />);
    const ta = screen.getByRole("textbox");
    expect(ta.tagName.toLowerCase()).toBe("textarea");
    expect(ta.value).toContain("a.example.com");
    expect(ta.value).toContain("b.example.com");
  });

  it("single URL → same textarea with one URL", () => {
    render(<Tree initialValue="https://single.example.com" />);
    const ta = screen.getByRole("textbox");
    expect(ta.value).toBe("https://single.example.com");
  });
});

// I-04 is covered in I-30 (Home integration): the "Custom" intent chip
// in Home.jsx reveals a custom-prompt textarea. HeroComposer receives
// the prompt as a prop and threads it into extract() — that threading
// is verified by I-01's "customPrompt is forwarded to extractStructure"
// assertion below. The textarea rendering is owned by Home.
describe("I-04 — HeroComposer: customPrompt is forwarded to extract", () => {
  it("intent='custom' + customPrompt prop is passed to extractStructure as customPrompt", async () => {
    firecrawlMocks.extractStructure.mockClear();
    render(
      <Tree
        initialValue="https://example.com"
        intent="custom"
        customPrompt="Tell me about the team"
      />,
    );
    const btn = screen.getByRole("button", { name: /^extract$/i });
    await act(async () => {
      fireEvent.click(btn);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(firecrawlMocks.extractStructure).toHaveBeenCalledTimes(1);
    const [, optionsArg] = firecrawlMocks.extractStructure.mock.calls[0];
    expect(optionsArg).toHaveProperty("customPrompt", "Tell me about the team");
    expect(optionsArg.enrichMeta).toEqual({
      key: "custom",
      label: "Custom extraction",
      icon: "code",
    });
  });

  it("intent='pricing' forwards pricing enrichMeta to extractStructure", async () => {
    firecrawlMocks.extractStructure.mockClear();
    render(
      <Tree
        initialValue="https://example.com"
        intent="pricing"
        customPrompt="Extract every pricing tier."
      />,
    );
    const btn = screen.getByRole("button", { name: /^extract$/i });
    await act(async () => {
      fireEvent.click(btn);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(firecrawlMocks.extractStructure).toHaveBeenCalledTimes(1);
    const [, optionsArg] = firecrawlMocks.extractStructure.mock.calls[0];
    expect(optionsArg).toHaveProperty("customPrompt", "Extract every pricing tier.");
    expect(optionsArg.enrichMeta).toEqual({
      key: "pricing",
      label: "Pricing & Plans",
      icon: "hash",
      prompt: "Extract every pricing tier: the plan name, price, billing period, and the key features included in each plan.",
    });
  });
});

