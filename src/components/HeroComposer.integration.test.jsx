import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import HeroComposer from "./HeroComposer.jsx";

const mocks = vi.hoisted(() => ({
  extract: vi.fn(),
  navigate: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("react-router-dom", () => ({ useNavigate: () => mocks.navigate }));
vi.mock("./ExtractionProvider.jsx", () => ({ useExtraction: () => ({ extract: mocks.extract }) }));
vi.mock("./Toast.jsx", () => ({ useToast: () => mocks.toast }));

describe("HeroComposer integration", () => {
  beforeEach(() => {
    mocks.extract.mockReset();
    mocks.navigate.mockReset();
    mocks.toast.mockReset();
  });

  it("normalizes a URL and dispatches a focused extraction", async () => {
    const user = userEvent.setup();
    render(<HeroComposer value="example.com/pricing" onChange={vi.fn()} intent="pricing" customPrompt="price tiers" renderJs />);

    await user.click(screen.getByRole("button", { name: "Extract" }));

    expect(mocks.extract).toHaveBeenCalledWith("https://example.com/pricing", {
      renderJs: true,
      customPrompt: "price tiers",
      enrichMeta: expect.objectContaining({ key: "pricing", label: "Pricing & Plans", icon: "hash" }),
    });
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("routes multiple URLs to batch without dispatching a single extraction", async () => {
    const user = userEvent.setup();
    render(<HeroComposer value={"one.example\ntwo.example"} onChange={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Extract 2" }));

    expect(mocks.navigate).toHaveBeenCalledWith("/batch", {
      state: {
        urls: ["https://one.example", "https://two.example"],
        intent: "summary",
        autorun: true,
      },
    });
    expect(mocks.extract).not.toHaveBeenCalled();
  });

  it("routes a map intent through the domain-map extraction path", async () => {
    const user = userEvent.setup();
    render(<HeroComposer value="example.com" onChange={vi.fn()} intent="map" />);

    await user.click(screen.getByRole("button", { name: "Map" }));

    expect(mocks.extract).toHaveBeenCalledWith("https://example.com", { mapMode: true });
  });
});
