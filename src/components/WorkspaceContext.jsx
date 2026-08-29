// WorkspaceContext.jsx — "which workspace am I working in?"
//
// This is the missing piece the entitlementModel.js/workspaces.js session
// documented and deliberately deferred: per-seat member pause had a real
// server-side branch (ctx.memberPaused) and a real admin UI to trigger it
// (TeamTab.jsx's Pause button), but no request anywhere ever said which
// workspace it was acting under, so the pause could never actually fire.
//
// Scope, stated plainly: this is the minimum viable "current workspace"
// concept — a switcher and a persisted selection — not the full save-every-
// extraction-under-a-workspace feature the docs describe as its own later
// project. Selecting a workspace here changes what a request is CHECKED
// against (can this seat act right now); it does not yet change where
// results are SAVED. That's a deliberate, honestly-scoped remainder.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useAuth } from "./AuthProvider.jsx";
import { fetchMyWorkspaces } from "../lib/workspacesService.js";

const STORAGE_KEY = "datiq.currentWorkspace";

const WorkspaceContext = createContext({
  workspaces: [],
  currentWorkspaceId: null,
  currentWorkspace: null,
  setCurrentWorkspaceId: () => {},
  refreshWorkspaces: async () => {},
});

function readStored() {
  try {
    return localStorage.getItem(STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

export function WorkspaceProvider({ children }) {
  const { user } = useAuth();
  const [workspaces, setWorkspaces] = useState([]);
  const [currentWorkspaceId, setCurrentWorkspaceIdState] = useState(readStored);

  const refreshWorkspaces = useCallback(async () => {
    if (!user) {
      setWorkspaces([]);
      return;
    }
    try {
      // fetchMyWorkspaces() never throws — it reports failure via `degraded`
      // — but this is wrapped anyway so a future change to that contract
      // fails safe here too.
      const res = await fetchMyWorkspaces();
      setWorkspaces(Array.isArray(res?.workspaces) ? res.workspaces : []);
    } catch {
      // A failed fetch leaves the switcher showing whatever it last had
      // (or empty) rather than throwing — the workspace picker is a
      // convenience, never a gate. The server re-validates membership on
      // every request regardless of what this list shows.
    }
  }, [user]);

  useEffect(() => {
    refreshWorkspaces();
  }, [refreshWorkspaces]);

  // A selection naming a workspace the user no longer belongs to (removed,
  // or a stale value from a previous account on a shared machine) reverts to
  // "Personal" rather than silently sending a dead id with every request.
  useEffect(() => {
    if (!currentWorkspaceId) return;
    if (workspaces.length === 0) return;
    if (!workspaces.some((w) => w.id === currentWorkspaceId)) {
      setCurrentWorkspaceIdState(null);
      try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    }
  }, [workspaces, currentWorkspaceId]);

  const setCurrentWorkspaceId = useCallback((id) => {
    setCurrentWorkspaceIdState(id || null);
    try {
      if (id) localStorage.setItem(STORAGE_KEY, id);
      else localStorage.removeItem(STORAGE_KEY);
    } catch { /* ignore */ }
  }, []);

  const currentWorkspace = useMemo(
    () => workspaces.find((w) => w.id === currentWorkspaceId) || null,
    [workspaces, currentWorkspaceId],
  );

  const value = useMemo(() => ({
    workspaces,
    currentWorkspaceId: currentWorkspace ? currentWorkspaceId : null,
    currentWorkspace,
    setCurrentWorkspaceId,
    refreshWorkspaces,
  }), [workspaces, currentWorkspaceId, currentWorkspace, setCurrentWorkspaceId, refreshWorkspaces]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  return useContext(WorkspaceContext);
}
