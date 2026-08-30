# DatIQ — Sessions Directory

This directory stores session records, engineering milestones, architectural decisions, and handoffs.

---

## 1. Active Session Handoff

- **Latest Active Handoff:** [`SESSION-HANDOFF-2026-08-30-WORKFLOW-OPTIMIZATION-AND-CALLBACK-API.md`](./SESSION-HANDOFF-2026-08-30-WORKFLOW-OPTIMIZATION-AND-CALLBACK-API.md)
  - Covers: Server Callback API, n8n decoupling, direct fallbacks, GCP Cloud Run URL configuration, and 2-phase n8n rollout.

---

## 2. Master Consolidated Session Archive

- **Complete Historical Archive:** [`SESSIONS-HISTORY.md`](./SESSIONS-HISTORY.md)
  - Contains the full unedited history of all 70 prior engineering sessions and milestone reports from project inception to 2026-08-30.

---

## 3. Session Management Tooling

- Skill: `.agents/skills/session-handoff-management/`
- Tool: `scripts/consolidate-sessions.mjs` (for periodic archive merging)
