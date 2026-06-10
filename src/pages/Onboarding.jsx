// Onboarding.jsx — V4 persona-selection + welcome flow (route "/onboarding").
// Step 1: Pick your role (7 persona cards).
// Step 2: Optional name entry + persona-specific welcome.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Icon from "../components/Icon.jsx";
import Button from "../components/Button.jsx";
import { PERSONAS } from "../lib/personaConfig.js";
import { usePersona } from "../components/PersonaProvider.jsx";

const SIGN_IN_PERSONAS = PERSONAS;

function PersonaCard({ persona, selected, onClick }) {
  return (
    <button
      className={"ob-card" + (selected ? " ob-card-selected" : "")}
      onClick={onClick}
      aria-pressed={selected}
      style={selected ? { "--card-accent": persona.color } : {}}
    >
      <div className="ob-card-icon" style={{ background: `color-mix(in srgb, ${persona.color} 14%, transparent)`, color: persona.color }}>
        <Icon name={persona.icon} size={22} />
      </div>
      <div className="ob-card-label">{persona.label}</div>
      {selected && (
        <div className="ob-card-check" style={{ background: persona.color }}>
          <Icon name="check" size={11} />
        </div>
      )}
    </button>
  );
}

function StepOne({ selected, onSelect, onNext }) {
  return (
    <div className="ob-step rise">
      <div className="ob-eyebrow">
        <Icon name="sparkles" size={14} />
        DatIQ — Smart web extraction
      </div>
      <h1 className="ob-title">What best describes your work?</h1>
      <p className="ob-subtitle">
        We'll personalise your experience — the right features, examples, and shortcuts for your role.
      </p>

      <div className="ob-grid">
        {SIGN_IN_PERSONAS.map((p) => (
          <PersonaCard key={p.id} persona={p} selected={selected === p.id} onClick={() => onSelect(p.id)} />
        ))}
      </div>

      <div className="ob-step-foot">
        <Button
          variant="primary"
          iconRight="arrow-right"
          onClick={onNext}
          disabled={!selected}
          style={{ minWidth: 200, height: 52, fontSize: "1.05em" }}
        >
          Continue
        </Button>
        <p className="ob-skip">
          Just exploring?{" "}
          <button className="ob-skip-link" onClick={onNext}>
            Skip for now
          </button>
        </p>
      </div>
    </div>
  );
}

function StepTwo({ persona, onComplete }) {
  const [name, setName] = useState("");

  return (
    <div className="ob-step rise">
      <div
        className="ob-welcome-icon"
        style={{ background: `color-mix(in srgb, ${persona.color} 14%, transparent)`, color: persona.color }}
      >
        <Icon name={persona.icon} size={30} />
      </div>

      <div className="ob-welcome-badge" style={{ color: persona.color, borderColor: `color-mix(in srgb, ${persona.color} 30%, transparent)`, background: `color-mix(in srgb, ${persona.color} 10%, transparent)` }}>
        {persona.badge}
      </div>

      <h1 className="ob-title">{persona.welcomeTitle}</h1>

      <p className="ob-subtitle" style={{ maxWidth: "52ch" }}>
        {persona.welcomeBody}
      </p>

      <div className="ob-name-field">
        <label className="ob-name-label" htmlFor="ob-name">
          What should we call you? <span className="ob-name-hint">(optional)</span>
        </label>
        <input
          id="ob-name"
          className="ob-name-input"
          type="text"
          placeholder="Your first name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onComplete(name)}
          autoFocus
          autoComplete="given-name"
        />
      </div>

      <Button
        variant="primary"
        iconRight="arrow-right"
        onClick={() => onComplete(name)}
        style={{ minWidth: 220, height: 52, fontSize: "1.05em" }}
      >
        Start extracting
      </Button>

      <div className="ob-perks">
        <div className="ob-perk">
          <Icon name="check-circle" size={16} style={{ color: persona.color }} />
          No credit card required
        </div>
        <div className="ob-perk">
          <Icon name="check-circle" size={16} style={{ color: persona.color }} />
          Free to get started
        </div>
        <div className="ob-perk">
          <Icon name="check-circle" size={16} style={{ color: persona.color }} />
          Works instantly
        </div>
      </div>
    </div>
  );
}

export default function Onboarding() {
  const navigate = useNavigate();
  const { personaId, selectPersona, completeOnboarding } = usePersona();
  const [step, setStep] = useState(1);
  const [localSelected, setLocalSelected] = useState(personaId);

  const handleSelect = (id) => {
    setLocalSelected(id);
    selectPersona(id);
  };

  const handleNextStep = () => {
    if (localSelected) {
      setStep(2);
    } else {
      // Skipped — complete without persona
      completeOnboarding("");
      navigate("/", { replace: true });
    }
  };

  const handleComplete = (name) => {
    completeOnboarding(name);
    navigate("/", { replace: true });
  };

  const persona = PERSONAS.find((p) => p.id === localSelected);

  return (
    <div className="ob-root">
      <div className="ob-bg-glow" />

      {/* Brand */}
      <div className="ob-brand">
        <div className="ob-brand-mark">
          <Icon name="layers" size={19} strokeWidth={2.2} />
        </div>
        <span className="ob-brand-name">
          Dat<b>IQ</b>
        </span>
      </div>

      {/* Step indicator */}
      <div className="ob-stepper">
        <div className={"ob-step-dot" + (step >= 1 ? " ob-step-dot-on" : "")} />
        <div className="ob-step-line" />
        <div className={"ob-step-dot" + (step >= 2 ? " ob-step-dot-on" : "")} />
      </div>

      <div className="ob-content">
        {step === 1 ? (
          <StepOne selected={localSelected} onSelect={handleSelect} onNext={handleNextStep} />
        ) : (
          <StepTwo persona={persona} onComplete={handleComplete} />
        )}
      </div>

      {/* Footer links */}
      <div className="ob-foot-links">
        <a href="/privacy" className="ob-foot-link">Privacy</a>
        <span className="ob-foot-sep">·</span>
        <a href="/terms" className="ob-foot-link">Terms</a>
      </div>
    </div>
  );
}
