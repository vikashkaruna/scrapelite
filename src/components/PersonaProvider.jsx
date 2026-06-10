// PersonaProvider.jsx — V4 persona context.
// Stores the selected persona + onboarding state in localStorage.
import { createContext, useContext, useState } from "react";

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
  const [personaId, setPersonaId] = useState(() => read(PERSONA_KEY));
  const [onboarded, setOnboarded] = useState(() => read(ONBOARDED_KEY) === "1");
  const [userName, setUserName] = useState(() => read(NAME_KEY, ""));

  const selectPersona = (id) => {
    setPersonaId(id);
    write(PERSONA_KEY, id);
  };

  const completeOnboarding = (name = "") => {
    setOnboarded(true);
    write(ONBOARDED_KEY, "1");
    if (name.trim()) {
      setUserName(name.trim());
      write(NAME_KEY, name.trim());
    }
  };

  const resetOnboarding = () => {
    setPersonaId(null);
    setOnboarded(false);
    setUserName("");
    write(PERSONA_KEY, null);
    write(ONBOARDED_KEY, null);
    write(NAME_KEY, null);
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
