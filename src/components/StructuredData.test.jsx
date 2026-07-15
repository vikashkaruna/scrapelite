import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import StructuredData from "./StructuredData.jsx";

describe("StructuredData", () => {
  it("renders untrusted values as text instead of executable HTML", () => {
    const payload = "<img src=x onerror=window.__xss=true>";
    const { container } = render(<StructuredData data={{ company_name: payload }} />);

    expect(screen.getByText(payload)).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
    expect(window.__xss).toBeUndefined();
  });

  it("renders safe mail and external links with the expected attributes", () => {
    render(<StructuredData data={{ email: "team@example.com", homepage: "https://example.com" }} />);

    expect(screen.getByRole("link", { name: /team@example.com/i })).toHaveAttribute("href", "mailto:team@example.com");
    expect(screen.getByRole("link", { name: /https:\/\/example.com/i })).toHaveAttribute("rel", "noopener noreferrer");
  });
});
