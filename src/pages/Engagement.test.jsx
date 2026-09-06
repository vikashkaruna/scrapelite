// src/pages/Engagement.test.jsx — Unit tests for Engagement Hub component
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import Engagement from "./Engagement.jsx";
import * as api from "../lib/engagement/engagementClient.js";

// Mock Toast and icons
vi.mock("../components/Toast.jsx", () => ({
  useToast: () => vi.fn(),
  ToastProvider: ({ children }) => <div>{children}</div>,
}));

describe("Engagement Page Hub", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders header, title, and initial tabs", async () => {
    render(
      <MemoryRouter>
        <Engagement />
      </MemoryRouter>
    );

    expect(screen.getByText("Prospect Engagement Engine")).toBeTruthy();
    expect(screen.getByText("Pipeline Board")).toBeTruthy();
    expect(screen.getByText("Approval Queue")).toBeTruthy();
    expect(screen.getByText("Prospects Table")).toBeTruthy();
    expect(screen.getByText("Analytics & Funnel")).toBeTruthy();
    expect(screen.getByText("Brand Kit & Sync")).toBeTruthy();
  });

  it("switches tabs when clicked", async () => {
    render(
      <MemoryRouter>
        <Engagement />
      </MemoryRouter>
    );

    // Switch to Analytics
    const analyticsTabBtn = screen.getByRole("button", { name: /Analytics & Funnel/i });
    fireEvent.click(analyticsTabBtn);
    expect(screen.getByText("Campaign Intelligence & Metrics")).toBeTruthy();
    expect(screen.getByText("Conversion Funnel")).toBeTruthy();

    // Switch to Brand Kit & Sync
    const settingsTabBtn = screen.getByRole("button", { name: /Brand Kit & Sync/i });
    fireEvent.click(settingsTabBtn);
    expect(screen.getByText("AI Brand Kit & Tone of Voice")).toBeTruthy();
    expect(screen.getByText("Two-Way CRM & Spreadsheet Sync")).toBeTruthy();

    // Switch to Prospects Table
    const prospectsTabBtn = screen.getByRole("button", { name: /Prospects Table/i });
    fireEvent.click(prospectsTabBtn);
    expect(screen.getByPlaceholderText(/Filter prospects by name, company, email/i)).toBeTruthy();
  });

  it("opens create campaign modal", async () => {
    render(
      <MemoryRouter>
        <Engagement />
      </MemoryRouter>
    );

    const newCampaignBtn = screen.getByRole("button", { name: /New Campaign/i });
    fireEvent.click(newCampaignBtn);

    expect(screen.getByText("Create Outreach Campaign")).toBeTruthy();
    expect(screen.getByPlaceholderText(/e\.g\. Q4 Healthcare SaaS Leaders/i)).toBeTruthy();

    // Cancel modal
    const cancelBtn = screen.getByRole("button", { name: /Cancel/i });
    fireEvent.click(cancelBtn);
    await waitFor(() => {
      expect(screen.queryByText("Create Outreach Campaign")).toBeNull();
    });
  });

  it("opens import prospects modal", async () => {
    render(
      <MemoryRouter>
        <Engagement />
      </MemoryRouter>
    );

    const importBtn = screen.getByRole("button", { name: /Import/i });
    fireEvent.click(importBtn);

    expect(screen.getByRole("heading", { name: "Import Prospects" })).toBeTruthy();
    expect(screen.getByPlaceholderText(/first_name,last_name,email/i)).toBeTruthy();
  });
});
