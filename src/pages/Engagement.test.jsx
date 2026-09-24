// src/pages/Engagement.test.jsx — the Engagement page against a mocked API client.
//
// What these pin: the page is gated (signed out → sign in; outside the beta →
// a plain notice, and NO data calls); there is exactly one explicit Send; the
// per-channel opt-out goes through the consent panel; and nothing claims a
// feature that does not exist (AI copy, CRM sync, a version number).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";

const auth = vi.hoisted(() => ({ value: { user: { id: "u1" }, authLoading: false, openAuth: vi.fn() } }));
vi.mock("../components/AuthProvider.jsx", () => ({ useAuth: () => auth.value }));

const toast = vi.hoisted(() => vi.fn());
vi.mock("../components/Toast.jsx", () => ({ useToast: () => toast }));

const api = vi.hoisted(() => ({
  getAccess: vi.fn(),
  listCampaigns: vi.fn(),
  listProspects: vi.fn(),
  listMessages: vi.fn(),
  getAnalytics: vi.fn(),
  getActivityLogs: vi.fn(),
  listSuppressions: vi.fn(),
  optOut: vi.fn(),
  sendApproved: vi.fn(),
  updateCampaign: vi.fn(),
  addProspects: vi.fn(),
  updateProspect: vi.fn(),
  createCampaign: vi.fn(),
  deleteCampaign: vi.fn(),
  approveMessage: vi.fn(),
  rejectMessage: vi.fn(),
  retryMessage: vi.fn(),
  liftSuppression: vi.fn(),
  generateProspectMessage: vi.fn(),
  updateProspectStatus: vi.fn(),
  addProspectNote: vi.fn(),
}));
vi.mock("../lib/engagement/engagementClient.js", () => api);

import Engagement from "./Engagement.jsx";

const campaign = {
  id: "c1", name: "Q4 outreach", status: "active", channel_priority: ["email"],
  brand_kit: { company_name: "Acme" }, sender: { from_email: "priya@outreach.example.com", from_name: "Priya" },
};
const prospect = { id: "p1", campaign_id: "c1", first_name: "Ana", email: "ana@buyer.test", phone: "+15550001111", status: "queued", engagement_score: 0 };

function setup({ access = { enabled: true, sender_domains: ["outreach.example.com"] }, messages = [], camp = campaign } = {}) {
  for (const fn of Object.values(api)) fn.mockReset();
  api.getAccess.mockResolvedValue(access);
  api.listCampaigns.mockResolvedValue({ campaigns: [camp] });
  api.listProspects.mockResolvedValue({ prospects: [prospect] });
  api.listMessages.mockResolvedValue({ messages });
  api.getAnalytics.mockResolvedValue({ funnel: {}, rates: {} });
  api.getActivityLogs.mockResolvedValue({ logs: [] });
  api.listSuppressions.mockResolvedValue({ suppressions: [] });
  api.optOut.mockResolvedValue({ ok: true, allChannels: true });
  api.sendApproved.mockResolvedValue({ ok: true, sent: 1, skipped: 0, failed: 0, deferred: 0, remaining: 0 });
  return render(<MemoryRouter><Engagement /></MemoryRouter>);
}

beforeEach(() => {
  auth.value = { user: { id: "u1" }, authLoading: false, openAuth: vi.fn() };
  toast.mockReset();
});

describe("Engagement — gates", () => {
  it("asks a signed-out visitor to sign in and calls nothing", () => {
    auth.value = { user: null, authLoading: false, openAuth: vi.fn() };
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(auth.value.openAuth).toHaveBeenCalledWith("signin");
    expect(api.getAccess).not.toHaveBeenCalled();
  });

  it("shows the beta notice and loads no campaign data outside the allow-list", async () => {
    setup({ access: { enabled: false, code: "engagement_beta", message: "Private beta." } });
    expect(await screen.findByText(/in private beta/i)).toBeTruthy();
    expect(api.listCampaigns).not.toHaveBeenCalled();
  });
});

describe("Engagement — the hub", () => {
  it("renders an honest header and the tabs, with no nested <main>", async () => {
    const { container } = setup();
    expect(await screen.findByRole("heading", { name: "Prospect Engagement" })).toBeTruthy();
    expect(screen.queryByText(/v2\.4/)).toBeNull();
    expect(screen.queryByText(/AI personalization|bidirectional CRM sync|CAN-SPAM|TRAI Compliant/i)).toBeNull();
    const tabs = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(tabs.map((t) => t.replace(/\d+$/, ""))).toEqual(["Pipeline", "Review & send", "Prospects", "Results", "Brand kit & sender"]);
    expect(container.querySelectorAll("main")).toHaveLength(0);
  });

  it("the settings tab has a sender form and no fake sync form", async () => {
    setup();
    await screen.findByRole("heading", { name: "Prospect Engagement" });
    fireEvent.click(screen.getByRole("tab", { name: /Brand kit & sender/i }));
    expect(screen.getByLabelText("From email")).toBeTruthy();
    expect(screen.queryByText(/Two-Way CRM/i)).toBeNull();
    expect(screen.getByText(/isn't available yet/i)).toBeTruthy();
  });
});

describe("Engagement — sending", () => {
  const queued = { id: "m1", prospect_id: "p1", channel: "email", status: "queued", approval_status: "approved" };

  it("sends approved messages only when a person presses Send", async () => {
    setup({ messages: [queued] });
    await screen.findByRole("heading", { name: "Prospect Engagement" });
    fireEvent.click(screen.getByRole("tab", { name: /Review & send/i }));
    expect(api.sendApproved).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: /Send 1 now/i }));
    await waitFor(() => expect(api.sendApproved).toHaveBeenCalledWith("c1", ["m1"]));
  });

  it("cannot send from a campaign with no sender", async () => {
    setup({ messages: [queued], camp: { ...campaign, sender: {} } });
    await screen.findByRole("heading", { name: "Prospect Engagement" });
    fireEvent.click(screen.getByRole("tab", { name: /Review & send/i }));
    expect((await screen.findByRole("button", { name: /Send 1 now/i })).disabled).toBe(true);
    expect(screen.getByText(/has no sender yet/i)).toBeTruthy();
  });

  it("explains why a message was not sent", async () => {
    setup({ messages: [{ ...queued, id: "m2", status: "skipped", failure_code: "suppressed_unsubscribe" }] });
    await screen.findByRole("heading", { name: "Prospect Engagement" });
    fireEvent.click(screen.getByRole("tab", { name: /Review & send/i }));
    fireEvent.click(await screen.findByRole("button", { name: /1 not sent/i }));
    expect(screen.getByText("The contact unsubscribed.")).toBeTruthy();
  });
});

describe("Engagement — per-channel consent", () => {
  const openDrawer = async () => {
    await screen.findByRole("heading", { name: "Prospect Engagement" });
    fireEvent.click(screen.getByRole("tab", { name: /^Prospects$/ }));
    fireEvent.click(await screen.findByText("Ana"));
    return (await screen.findByRole("heading", { name: "Consent by channel" })).closest("section");
  };

  it("starts with every reachable channel ticked (consent on by default)", async () => {
    setup();
    const panel = await openDrawer();
    for (const ch of ["Email", "WhatsApp", "SMS"]) expect(within(panel).getByLabelText(`Contact by ${ch}`).checked).toBe(true);
    const tg = within(panel).getByLabelText("Contact by Telegram");
    expect([tg.checked, tg.disabled]).toEqual([false, true]);
    expect(within(panel).getAllByText("Can be contacted")).toHaveLength(3);
    expect(within(panel).getByRole("button", { name: "Save consent" }).disabled).toBe(true);
  });

  it("unticking a channel and saving opts out of that channel only, after confirmation", async () => {
    setup();
    const panel = await openDrawer();
    fireEvent.click(within(panel).getByLabelText("Contact by SMS"));
    expect(within(panel).getByText("Will stop on save")).toBeTruthy();
    fireEvent.click(within(panel).getByRole("button", { name: "Save consent" }));
    expect(api.optOut).not.toHaveBeenCalled();
    fireEvent.change(within(panel).getByLabelText("Reason for opting out"), { target: { value: "asked on a call" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(api.optOut).toHaveBeenCalledWith("p1", ["sms"], "asked on a call"));
  });

  it("opts out of every channel in one action", async () => {
    setup();
    const panel = await openDrawer();
    fireEvent.click(within(panel).getByRole("button", { name: "Opt out of all channels" }));
    fireEvent.click(within(panel).getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(api.optOut).toHaveBeenCalledWith("p1", ["email", "whatsapp", "sms"], null));
  });

  it("shows an opt-out the recipient made as theirs, unticked and locked", async () => {
    setup();
    api.listSuppressions.mockResolvedValue({
      suppressions: [{ id: "s1", channel: "email", address: "ana@buyer.test", reason: "unsubscribe", created_at: "2026-09-01T00:00:00Z" }],
    });
    const panel = await openDrawer();
    expect(await within(panel).findByText(/Unsubscribed/)).toBeTruthy();
    const email = within(panel).getByLabelText("Contact by Email");
    expect([email.checked, email.disabled]).toEqual([false, true]);
    expect(within(panel).getByText("Recipient's choice")).toBeTruthy();
  });
});

describe("Engagement — notes and activity", () => {
  it("saves a note and shows the timeline in words, never raw JSON or Invalid Date", async () => {
    setup();
    api.addProspectNote.mockResolvedValue({ ok: true });
    api.getActivityLogs.mockResolvedValue({ logs: [
      { id: "a1", event_type: "note", details: { note: "Testing First Time" }, timestamp: new Date().toISOString() },
    ] });
    await screen.findByRole("heading", { name: "Prospect Engagement" });
    fireEvent.click(screen.getByRole("tab", { name: /^Prospects$/ }));
    fireEvent.click(await screen.findByText("Ana"));
    fireEvent.change(await screen.findByLabelText("Note"), { target: { value: "Testing First Time" } });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    await waitFor(() => expect(api.addProspectNote).toHaveBeenCalledWith("c1", "p1", "Testing First Time"));
    expect(await screen.findByText("Testing First Time", { selector: "p" })).toBeTruthy();
    expect(screen.queryByText(/Invalid Date/)).toBeNull();
    expect(screen.queryByText(/\{"note"/)).toBeNull();
  });
});

describe("Engagement — test mode and brand kit", () => {
  it("says test mode on every tab and labels a simulated send", async () => {
    setup({ access: { enabled: true, sender_domains: ["outreach.example.com"], mock_sending: true },
      messages: [{ id: "m9", prospect_id: "p1", channel: "email", status: "sent", provider: "mock", sent_at: "2026-09-20T00:00:00Z" }] });
    expect(await screen.findByText(/Test mode — messages are not delivered from this environment/)).toBeTruthy();
    // No internal setting or provider name unless the server marks this a test environment.
    expect(screen.queryByText(/ENGAGEMENT_MOCK_SEND/)).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: /^Prospects$/ }));
    expect(await screen.findByText("Test")).toBeTruthy();
  });

  it("reports which drafts a brand-kit save refreshed", async () => {
    setup();
    api.updateCampaign.mockResolvedValue({ ok: true, campaign, refresh: { refreshed: 2, backToReview: 1, keptEdited: 1 } });
    await screen.findByRole("heading", { name: "Prospect Engagement" });
    fireEvent.click(screen.getByRole("tab", { name: /Brand kit & sender/i }));
    fireEvent.click(screen.getByRole("button", { name: /Save brand kit/i }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(
      "Brand kit saved · 2 drafts updated · 1 approved message updated and back in review · 1 hand-edited draft left as written", undefined));
  });
});

describe("Engagement — campaigns", () => {
  it("tells two same-named campaigns apart in the selector", async () => {
    setup();
    const twin = { ...campaign, id: "c2", created_at: "2026-09-10T00:00:00Z" };
    api.listCampaigns.mockResolvedValue({ campaigns: [{ ...campaign, created_at: "2026-09-01T00:00:00Z" }, twin] });
    await screen.findByRole("heading", { name: "Prospect Engagement" });
    const options = await screen.findAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["Q4 outreach · created Sep 1, 2026", "Q4 outreach · created Sep 10, 2026"]);
  });

  it("refuses a duplicate name before sending anything", async () => {
    setup();
    await screen.findByRole("heading", { name: "Prospect Engagement" });
    fireEvent.click(screen.getByRole("button", { name: /New Campaign/i }));
    fireEvent.change(screen.getByLabelText("Campaign name"), { target: { value: "q4 OUTREACH" } });
    expect(screen.getByText(/already exists/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create campaign" }).disabled).toBe(true);
    expect(api.createCampaign).not.toHaveBeenCalled();
  });

  it("renames the campaign from the Edit dialog", async () => {
    setup();
    api.updateCampaign.mockResolvedValue({ ok: true, campaign: { ...campaign, name: "Q4 EU", description: "EU only" } });
    await screen.findByRole("heading", { name: "Prospect Engagement" });
    fireEvent.click(screen.getByRole("button", { name: "Edit campaign" }));
    fireEvent.change(screen.getByLabelText("Campaign name"), { target: { value: "Q4 EU" } });
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "EU only" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(api.updateCampaign).toHaveBeenCalledWith("c1", { name: "Q4 EU", description: "EU only", status: "active" }));
    expect(await screen.findByRole("option", { name: "Q4 EU" })).toBeTruthy();
  });

  it("keeps a server refusal in the dialog", async () => {
    setup();
    api.createCampaign.mockRejectedValue(Object.assign(new Error('A campaign called "Other" already exists.'), { code: "campaign_name_taken" }));
    await screen.findByRole("heading", { name: "Prospect Engagement" });
    fireEvent.click(screen.getByRole("button", { name: /New Campaign/i }));
    fireEvent.change(screen.getByLabelText("Campaign name"), { target: { value: "Other" } });
    fireEvent.click(screen.getByRole("button", { name: "Create campaign" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", 'A campaign called "Other" already exists.');
  });

  it("deletes only after a second, explicit confirmation", async () => {
    setup();
    api.deleteCampaign.mockResolvedValue({ ok: true });
    await screen.findByRole("heading", { name: "Prospect Engagement" });
    fireEvent.click(screen.getByRole("button", { name: "Edit campaign" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(api.deleteCampaign).not.toHaveBeenCalled();
    expect(screen.getByText(/Opt-outs are kept/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete campaign" }));
    await waitFor(() => expect(api.deleteCampaign).toHaveBeenCalledWith("c1"));
  });
});

describe("Engagement — importing prospects", () => {
  const openImport = async () => {
    await screen.findByRole("heading", { name: "Prospect Engagement" });
    fireEvent.click(screen.getByRole("button", { name: /^Import$/ }));
    return screen.getByLabelText("CSV to import");
  };

  it("accepts a typed contact row with no header, and shows how its columns were read", async () => {
    setup();
    api.addProspects.mockResolvedValue({ ok: true, prospects: [{ id: "n1" }], stats: { dupCount: 0, invalidCount: 0 } });
    const box = await openImport();
    fireEvent.change(box, { target: { value: "Alice,Smith,alice@acme.com,Acme,VP,+15551234567" } });
    expect(screen.getByText(/No header row — columns read as/)).toBeTruthy();
    expect(screen.getByText("3. Email")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Import 1 prospect" }));
    await waitFor(() => expect(api.addProspects).toHaveBeenCalledWith("c1", [
      { first_name: "Alice", last_name: "Smith", email: "alice@acme.com", company: "Acme", role: "VP", phone: "+15551234567", source: "csv" },
    ]));
  });

  it("offers a template download", async () => {
    setup();
    await openImport();
    expect(screen.getByRole("button", { name: "Download template" })).toBeTruthy();
  });

  it("lists row problems by line, imports the good rows, and shows what happened", async () => {
    setup();
    api.addProspects.mockResolvedValue({ ok: true, prospects: [{ id: "n1" }], stats: { dupCount: 1, invalidCount: 0 },
      duplicates: [{ first_name: "Ana", email: "ana@buyer.test", matched_on: "email", value: "ana@buyer.test",
        existing: { id: "p1", name: "Ana Lopez", created_at: "2026-09-12T10:00:00Z" } }] });
    const box = await openImport();
    fireEvent.change(box, { target: { value: "first_name,email\nAna,ana@buyer.test\nBo,bo@new.test\nCy,not-an-email" } });
    expect(screen.getByText(/2/, { selector: "strong" })).toBeTruthy();
    expect(screen.getByText(/"not-an-email" is not a valid email/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Import 2 prospects" }));
    await waitFor(() => expect(api.addProspects).toHaveBeenCalledWith("c1", [
      { first_name: "Ana", email: "ana@buyer.test", source: "csv" },
      { first_name: "Bo", email: "bo@new.test", source: "csv" },
    ]));
    expect(await screen.findByText("Imported 1 of 3 — 1 was already in this campaign, 1 had problems.")).toBeTruthy();
    // Each skipped row is named with its line and reason, not just counted.
    expect(screen.getByText("Already in this campaign (1)")).toBeTruthy();
    const dup = screen.getByText(/same email as/).closest("li");
    expect(dup.textContent).toMatch(/Line 2\s*Ana — same email as Ana Lopez, added Sep 12, 2026/);
    expect(screen.getByText("Not imported — needs fixing (1)")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Download skipped rows" })).toBeTruthy();
    const stats = screen.getByRole("status");
    expect(within(stats).getByText("Already in this campaign (skipped)").nextSibling.textContent).toBe("1");
    expect(within(stats).getByText(/Rejected/).nextSibling.textContent).toBe("1");
    expect(screen.getByRole("button", { name: "Done" })).toBeTruthy();
  });

  it("says nothing was imported when the server refuses", async () => {
    setup();
    api.addProspects.mockRejectedValue(new Error("Import at most 1000 prospects at a time."));
    const box = await openImport();
    fireEvent.change(box, { target: { value: "email\nana@x.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Import 1 prospect" }));
    expect(await screen.findByText(/Nothing was imported\. Import at most 1000/)).toBeTruthy();
  });
});

describe("Engagement — ops hint and editing a prospect", () => {
  it("shows the operator hint only when the server allows it", async () => {
    setup({ access: { enabled: true, sender_domains: [], mock_sending: true, ops_hint: true } });
    expect(await screen.findByText(/ENGAGEMENT_MOCK_SEND/)).toBeTruthy();
  });

  it("edits a prospect from the table and reports refreshed drafts", async () => {
    setup();
    api.updateProspect.mockResolvedValue({ ok: true, prospect: { ...prospect, company: "Buyer Inc" }, changed: ["company"], refresh: { refreshed: 1, backToReview: 0, keptEdited: 0 } });
    await screen.findByRole("heading", { name: "Prospect Engagement" });
    fireEvent.click(screen.getByRole("tab", { name: /^Prospects$/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Edit Ana" }));
    const dialog = screen.getByRole("dialog", { name: "Edit prospect" });
    fireEvent.change(within(dialog).getByLabelText("Company"), { target: { value: "Buyer Inc" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(api.updateProspect).toHaveBeenCalledWith("p1", { company: "Buyer Inc" }));
    expect(toast).toHaveBeenCalledWith("Prospect saved · 1 draft updated", undefined);
  });

  it("keeps a duplicate-email refusal in the edit dialog", async () => {
    setup();
    api.updateProspect.mockRejectedValue(new Error("bo@buyer.test is already Bo Ng in this campaign."));
    await screen.findByRole("heading", { name: "Prospect Engagement" });
    fireEvent.click(screen.getByRole("tab", { name: /^Prospects$/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Edit Ana" }));
    const dialog = screen.getByRole("dialog", { name: "Edit prospect" });
    fireEvent.change(within(dialog).getByLabelText("Email"), { target: { value: "bo@buyer.test" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));
    expect(await within(dialog).findByRole("alert")).toHaveProperty("textContent", "bo@buyer.test is already Bo Ng in this campaign.");
  });
});
