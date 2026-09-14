// governanceModel.js — Discoverability-scoped workspace authorization.
//
// PURE. Global workspace roles still own billing, seats and the workspace
// itself. These roles grant only Discoverability actions so an analyst or
// client viewer cannot accidentally become a workspace administrator.

export const DISCOVERABILITY_ROLES = Object.freeze({
  viewer: { id: "viewer", label: "Viewer" },
  analyst: { id: "analyst", label: "Analyst" },
  editor: { id: "editor", label: "Editor" },
  manager: { id: "manager", label: "Manager" },
  admin: { id: "admin", label: "Admin" },
  agency_admin: { id: "agency_admin", label: "Agency admin" },
  client_viewer: { id: "client_viewer", label: "Client viewer" },
});

export const DISCOVERABILITY_ROLE_IDS = Object.freeze(Object.keys(DISCOVERABILITY_ROLES));

export const DISCOVERABILITY_ACTIONS = Object.freeze([
  "read",
  "run_analysis",
  "propose_changes",
  "approve_changes",
  "manage_workflow",
  "dispatch_connectors",
  "manage_roles",
]);

const ROLE_ACTIONS = Object.freeze({
  viewer: ["read"],
  client_viewer: ["read"],
  analyst: ["read", "run_analysis"],
  editor: ["read", "run_analysis", "propose_changes"],
  manager: ["read", "run_analysis", "propose_changes", "approve_changes", "manage_workflow"],
  admin: DISCOVERABILITY_ACTIONS,
  agency_admin: DISCOVERABILITY_ACTIONS,
});

export const APPROVAL_STAGES = Object.freeze([
  { id: "open", label: "Open" },
  { id: "accepted", label: "Accepted" },
  { id: "assigned", label: "Assigned" },
  { id: "in_progress", label: "In progress" },
  { id: "implemented", label: "Implemented" },
  { id: "validation_scheduled", label: "Validation scheduled" },
  { id: "validated", label: "Validated" },
]);

export function isDiscoverabilityRole(role) {
  return DISCOVERABILITY_ROLE_IDS.includes(role);
}

export function canDiscoverabilityRole(role, action) {
  return isDiscoverabilityRole(role)
    && DISCOVERABILITY_ACTIONS.includes(action)
    && ROLE_ACTIONS[role].includes(action);
}

export function requireDiscoverabilityRole(role, action) {
  if (!isDiscoverabilityRole(role)) {
    return { ok: false, code: "INVALID_DISCOVERABILITY_ROLE", role, action };
  }
  if (!DISCOVERABILITY_ACTIONS.includes(action)) {
    return { ok: false, code: "INVALID_DISCOVERABILITY_ACTION", role, action };
  }
  return canDiscoverabilityRole(role, action)
    ? { ok: true, role, action }
    : { ok: false, code: "DISCOVERABILITY_ROLE_FORBIDDEN", role, action };
}

export function defaultDiscoverabilityRole(workspaceRole) {
  return ["owner", "admin"].includes(workspaceRole) ? "admin" : "viewer";
}

