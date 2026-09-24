// PersonaProvider.jsx — V4 persona context.
//
// Stores the selected persona + onboarding state in localStorage, which is
// the fast synchronous read every mount needs and the only thing that works
// for a guest. For a SIGNED-IN user, the same choice also lives in their
// Supabase `user_metadata` (persona_id / onboarded / user_name) — a plain,
// client-writable field on their own account, no new table or server
// function needed, same as `updateUser({password})` already used for
// password resets.
//
// Sync direction on sign-in: SERVER WINS when it has a value — that's what
// makes the choice follow the account to a second device. A guest's local
// choice, never yet synced anywhere, is pushed up once the server has
// nothing to prefer instead. Every local write (select/complete/reset) also
// fires a best-effort metadata update when signed in; it never blocks or
// throws on failure, because this is UX continuity, not authorization —
// exactly the posture updateUserMetadata() itself documents.
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useAuth } from "./AuthProvider.jsx";
import { updateUserMetadata } from "../lib/authService.js";
import { resolvePersonaId } from "../lib/personaConfig.js";

const PERSONA_KEY = "datiq.persona";
const ONBOARDED_KEY = "datiq.onboarded";
const NAME_KEY = "datiq.userName";

const PersonaContext = createContext(null);

function read(key, fallback = null) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
function write(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {}
}

export function PersonaProvider({ children }) {
  const { user } = useAuth();
  // A retired id (e.g. market-research, merged into founder-vc) is resolved on
  // read, so every consumer sees the current role and none needs its own alias.
  const [personaId, setPersonaId] = useState(() => resolvePersonaId(read(PERSONA_KEY)));
  const [onboarded, setOnboarded] = useState(() => read(ONBOARDED_KEY) === "1");
  const [userName, setUserName] = useState(() => read(NAME_KEY, ""));
  // Tracks which signed-in user id this provider has already reconciled
  // against, so the merge below runs once per sign-in — not on every
  // metadata-triggered re-render (updateUserMetadata's own USER_UPDATED
  // event would otherwise cause it to re-run against its own write).
  const reconciledFor = useRef(null);

  useEffect(() => {
    if (!user) { reconciledFor.current = null; return; }
    if (reconciledFor.current === user.id) return;
    reconciledFor.current = user.id;

    const meta = user.user_metadata || {};
    if (meta.persona_id) {
      // Server has a choice — it wins, so a second device picks up the same
      // persona instead of re-asking.
      const resolved = resolvePersonaId(meta.persona_id);
      setPersonaId(resolved);
      write(PERSONA_KEY, resolved);
      setOnboarded(Boolean(meta.onboarded));
      write(ONBOARDED_KEY, meta.onboarded ? "1" : null);
      if (meta.user_name) {
        setUserName(meta.user_name);
        write(NAME_KEY, meta.user_name);
      }
    } else if (personaId) {
      // Nothing on the server yet, but this browser already has a choice
      // (made as a guest, or on a device that hasn't synced before) — push
      // it up so the NEXT device sees it.
      updateUserMetadata({ persona_id: personaId, onboarded, user_name: userName || undefined }).catch(() => {});
    }
    // Only the sign-in transition (user.id changing) should trigger a merge;
    // personaId/onboarded/userName are read, not depended on, to avoid
    // re-running this on every local selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const selectPersona = (id) => {
    setPersonaId(id);
    write(PERSONA_KEY, id);
    if (user) updateUserMetadata({ persona_id: id }).catch(() => {});
  };

  const completeOnboarding = (name = "") => {
    setOnboarded(true);
    write(ONBOARDED_KEY, "1");
    const trimmed = name.trim();
    if (trimmed) {
      setUserName(trimmed);
      write(NAME_KEY, trimmed);
    }
    if (user) updateUserMetadata({ onboarded: true, ...(trimmed ? { user_name: trimmed } : {}) }).catch(() => {});
  };

  const resetOnboarding = () => {
    setPersonaId(null);
    setOnboarded(false);
    setUserName("");
    write(PERSONA_KEY, null);
    write(ONBOARDED_KEY, null);
    write(NAME_KEY, null);
    if (user) updateUserMetadata({ persona_id: null, onboarded: false, user_name: null }).catch(() => {});
  };

  return (
    <PersonaContext.Provider
      value={{ personaId, onboarded, userName, selectPersona, completeOnboarding, resetOnboarding }}
    >
      {children}
    </PersonaContext.Provider>
  );
}

export const usePersona = () => useContext(PersonaContext);
