// Onboarding.jsx — V4 persona-selection + welcome flow (route "/onboarding")
// + F06 (Recipe Packs) — Step 2 surfaces a "Choose your starter pack" picker
// pre-tuned to the selected persona.
// Step 1: Pick your role (7 persona cards).
// Step 2: Choose a Recipe Pack (or skip) + optional name entry + persona welcome.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Icon from "../components/Icon.jsx";
import Button from "../components/Button.jsx";
import { PERSONAS } from "../lib/personaConfig.js";
import { usePersona } from "../components/PersonaProvider.jsx";
import { RECIPE_PACKS, getPackByKey } from "../lib/extractionTemplates.js";

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
  // Default the pack to the persona's first relevant pack when there is one.
  const defaultPackKey = persona?.id === "sales"
    ? "sales"
    : persona?.id === "competitive-intel"
      ? "ci"
      : persona?.id === "seo"
        ? "seo"
        : RECIPE_PACKS[0]?.key;
  const [packKey, setPackKey] = useState(defaultPackKey);
  const activePack = getPackByKey(packKey);

  const handleComplete = () => {
    try { localStorage.setItem("datiq.starterPack", packKey); } catch {}
    onComplete(name);
  };

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

      {/* F06 — Recipe Pack picker. Lets the user pre-load 3–5 templates
          tuned to their role, surfaced on the Home Template Gallery on
          first visit (read from datiq.starterPack). */}
      <div className="ob-pack-picker" role="radiogroup" aria-label="Choose a starter Recipe Pack">
        <div className="ob-pack-picker-label">
          <Icon name="layers" size={13} />
          Choose your starter Recipe Pack
          <span className="ob-pack-hint">(you can switch any time)</span>
        </div>
        <div className="ob-pack-row">
          {RECIPE_PACKS.map((p) => {
            const isActive = packKey === p.key;
            return (
              <button
                key={p.key}
                type="button"
                className={"ob-pack-card" + (isActive ? " ob-pack-card-active" : "")}
                onClick={() => setPackKey(p.key)}
                role="radio"
                aria-checked={isActive}
                style={isActive ? { "--pack-accent": p.color } : {}}
              >
                <span className="ob-pack-icon" style={{ background: `color-mix(in srgb, ${p.color} 14%, transparent)`, color: p.color }}>
                  <Icon name={p.icon} size={16} />
                </span>
                <span className="ob-pack-label">{p.label}</span>
                <span className="ob-pack-count">{p.templateKeys.length} templates</span>
                {isActive && (
                  <span className="ob-pack-check" style={{ background: p.color }}>
                    <Icon name="check" size={11} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {activePack && (
          <p className="ob-pack-desc">{activePack.description}</p>
        )}
      </div>

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
          onKeyDown={(e) => e.key === "Enter" && handleComplete()}
          autoFocus
          autoComplete="given-name"
        />
      </div>

      <Button
        variant="primary"
        iconRight="arrow-right"
        onClick={handleComplete}
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
    <div className="page ob-page">
      <div className="ob-bg-glow" />

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
    </div>
  );
}
