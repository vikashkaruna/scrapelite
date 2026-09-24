// Onboarding.jsx — "set DatIQ up for your work" (route "/onboarding").
//
// Step 1: pick one of the 8 roles. Picking one opens a detail panel that says
//         what that role can DO here, which modules do it, the outcome, and
//         the single best first step. Everything shown comes from
//         personaConfig.js + roleModules.js, so a role's page, the Templates
//         filter and the use-case pages cannot describe the role differently.
// Step 2: a starter Recipe Pack, an optional name, and "your first three
//         steps" — each a link into the module that does it. Finish goes to
//         the role's first step, not a blanket "/".
//
// Style: the Home hero card (accent-tinted gradient card, eyebrow, big title)
// and the existing ob-* tokens — no new visual language.
import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import Icon from "../components/Icon.jsx";
import Button from "../components/Button.jsx";
import { PERSONAS, PERSONA_BY_ID } from "../lib/personaConfig.js";
import { ROLE_MODULES, roleModuleStatus } from "../lib/roleModules.js";
import { usePersona } from "../components/PersonaProvider.jsx";
import { RECIPE_PACKS, getPackByKey } from "../lib/extractionTemplates.js";
import { useSeo } from "../hooks/useSeo.js";

// The module order used when showing "DatIQ at a glance" before a role is picked.
const GLANCE = ["extract", "enrich", "discover", "compete", "connect", "engage", "templates", "workflows"];
const GLANCE_LINE = {
  extract: "Any URL, batch or schedule → clean data",
  enrich: "Contacts, pricing and custom fields",
  discover: "Visibility in search, answer engines and AI",
  compete: "Competitor changes, with evidence",
  connect: "Send results to your tools",
  engage: "Outreach from your research",
  templates: "Ready-made jobs, one click to run",
  workflows: "Lists, watchlists and routing rules",
};

function ModuleChip({ moduleKey, showStatus = false }) {
  const m = ROLE_MODULES[moduleKey];
  if (!m) return null;
  const status = roleModuleStatus(moduleKey);
  return (
    <span className="ob-mod-chip">
      <Icon name={m.icon} size={12} />
      {m.label}
      {showStatus && status !== "Available" && <span className="ob-mod-status">{status}</span>}
    </span>
  );
}

function RoleCard({ persona, selected, onSelect, tabIndex, onKeyDown, cardRef }) {
  return (
    <button
      ref={cardRef}
      type="button"
      role="radio"
      aria-checked={selected}
      aria-controls="ob-role-detail"
      tabIndex={tabIndex}
      onKeyDown={onKeyDown}
      className={"ob-role" + (selected ? " ob-role-selected" : "")}
      onClick={onSelect}
      style={{ "--card-accent": persona.color }}
    >
      <span className="ob-role-icon" style={{ background: `color-mix(in srgb, ${persona.color} 14%, transparent)`, color: persona.color }}>
        <Icon name={persona.icon} size={20} />
      </span>
      <span className="ob-role-text">
        <span className="ob-role-label">{persona.label}</span>
        <span className="ob-role-job">{persona.job}</span>
      </span>
      {selected && (
        <span className="ob-card-check" style={{ background: persona.color }} aria-hidden="true">
          <Icon name="check" size={11} />
        </span>
      )}
    </button>
  );
}

function RoleDetail({ persona, onContinue, onStartHere }) {
  if (!persona) {
    return (
      <aside id="ob-role-detail" className="ob-detail" aria-live="polite">
        <div className="ob-detail-top">
          <span className="hdr-mark"><Icon name="layers" size={14} /></span>
          <span>DatIQ at a glance</span>
        </div>
        <p className="ob-detail-lead">One connected intelligence layer. Pick a role to see what it does for you.</p>
        <ul className="ob-glance" role="list">
          {GLANCE.map((k) => (
            <li key={k}>
              <ModuleChip moduleKey={k} showStatus />
              <span>{GLANCE_LINE[k]}</span>
            </li>
          ))}
        </ul>
      </aside>
    );
  }
  return (
    <aside id="ob-role-detail" className="ob-detail" aria-live="polite" style={{ "--card-accent": persona.color }}>
      <div className="ob-detail-top">
        <span className="ob-detail-icon" style={{ background: `color-mix(in srgb, ${persona.color} 16%, transparent)`, color: persona.color }}>
          <Icon name={persona.icon} size={16} />
        </span>
        <span>{persona.label}</span>
      </div>
      <p className="ob-detail-lead">{persona.job}</p>

      <h2 className="ob-detail-h">What you can do</h2>
      <ul className="ob-jobs" role="list">
        {persona.jobs.map((j) => (
          <li key={j.text}>
            <Icon name="check-circle" size={15} style={{ color: persona.color }} />
            <span className="ob-job-text">{j.text}</span>
            <ModuleChip moduleKey={j.module} />
          </li>
        ))}
      </ul>

      <h2 className="ob-detail-h">Modules you'll use</h2>
      <div className="ob-mods">
        {persona.modules.map((k) => <ModuleChip key={k} moduleKey={k} showStatus />)}
      </div>

      <div className="ob-outcome">
        <Icon name="trending-up" size={15} />
        <span><b>Outcome:</b> {persona.outcome}</span>
      </div>

      <div className="ob-detail-actions">
        <Button variant="primary" iconRight="arrow-right" onClick={onContinue}>Continue</Button>
        <button type="button" className="home-secondary-cta" onClick={onStartHere}>
          Or start here: {persona.firstStep.label}
        </button>
      </div>
    </aside>
  );
}

function StepOne({ selected, onSelect, onNext, onStartHere, onSkip }) {
  const refs = useRef([]);
  const selectedIndex = Math.max(0, PERSONAS.findIndex((p) => p.id === selected));
  const persona = PERSONA_BY_ID[selected] && !PERSONA_BY_ID[selected].legacy ? PERSONA_BY_ID[selected] : null;

  // Radio-group keyboard model: arrows move AND select, like a native radio set.
  const onKeyDown = (e, i) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const next = (i + step + PERSONAS.length) % PERSONAS.length;
    onSelect(PERSONAS[next].id);
    refs.current[next]?.focus();
  };

  return (
    <div className="ob-step ob-step-wide rise">
      <section className="ob-hero" aria-labelledby="ob-title">
        <div className="ob-eyebrow">
          <Icon name="sparkles" size={14} />
          Set up DatIQ for your work
        </div>
        <h1 id="ob-title" className="ob-title">What do you want DatIQ to do for you?</h1>
        <p className="ob-subtitle">
          Pick the role closest to yours. We'll show what you can do, the modules that do it, and the best place to start — you can change it any time.
        </p>
      </section>

      <div className="ob-layout">
        <div className="ob-roles" role="radiogroup" aria-label="Your role">
          {PERSONAS.map((p, i) => (
            <RoleCard
              key={p.id}
              persona={p}
              selected={selected === p.id}
              onSelect={() => onSelect(p.id)}
              tabIndex={i === selectedIndex ? 0 : -1}
              onKeyDown={(e) => onKeyDown(e, i)}
              cardRef={(el) => { refs.current[i] = el; }}
            />
          ))}
        </div>
        <RoleDetail persona={persona} onContinue={onNext} onStartHere={onStartHere} />
      </div>

      <p className="ob-skip">
        Just exploring?{" "}
        <button type="button" className="ob-skip-link" onClick={onSkip}>Skip for now</button>
      </p>
    </div>
  );
}

function StepTwo({ persona, onComplete, onBack }) {
  const [name, setName] = useState("");
  const [packKey, setPackKey] = useState(
    getPackByKey(persona?.starterPack) ? persona.starterPack : RECIPE_PACKS[0]?.key,
  );
  const activePack = getPackByKey(packKey);
  const firstThree = persona.jobs.slice(0, 3);

  const finish = (to) => {
    try { localStorage.setItem("datiq.starterPack", packKey); } catch {}
    onComplete(name, to);
  };

  return (
    <div className="ob-step rise">
      <section className="ob-hero ob-hero-compact" style={{ "--card-accent": persona.color }}>
        <div className="ob-welcome-badge" style={{ color: persona.color, borderColor: `color-mix(in srgb, ${persona.color} 30%, transparent)`, background: `color-mix(in srgb, ${persona.color} 10%, transparent)` }}>
          <Icon name={persona.icon} size={13} /> {persona.label}
        </div>
        <h1 className="ob-title">{persona.welcomeTitle}</h1>
        <p className="ob-subtitle">{persona.welcomeBody}</p>
      </section>

      <section className="ob-first-steps" aria-labelledby="ob-first-h">
        <h2 id="ob-first-h" className="ob-detail-h">Your first three steps</h2>
        <ol role="list">
          {firstThree.map((j, i) => {
            const m = ROLE_MODULES[j.module];
            return (
              <li key={j.text}>
                <span className="ob-first-num" style={{ background: persona.color }}>{i + 1}</span>
                <span className="ob-job-text">{j.text}</span>
                {m && (
                  <Link to={m.to} className="ob-first-link" onClick={(e) => { e.preventDefault(); finish(m.to); }}>
                    Open {m.label} <Icon name="arrow-right" size={12} />
                  </Link>
                )}
              </li>
            );
          })}
        </ol>
      </section>

      {/* F06 — Recipe Pack picker, defaulted to the role's pack. */}
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
        {activePack && <p className="ob-pack-desc">{activePack.description}</p>}
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
          onKeyDown={(e) => e.key === "Enter" && finish(persona.firstStep.to)}
          autoComplete="given-name"
        />
      </div>

      <Button
        variant="primary"
        iconRight="arrow-right"
        onClick={() => finish(persona.firstStep.to)}
        style={{ minWidth: 240, height: 52, fontSize: "1.05em" }}
      >
        {persona.firstStep.label}
      </Button>

      <p className="ob-skip">
        <button type="button" className="ob-skip-link" onClick={onBack}>Change role</button>
        {" · "}
        <button type="button" className="ob-skip-link" onClick={() => finish("/")}>Go to Home instead</button>
      </p>
    </div>
  );
}

export default function Onboarding() {
  useSeo({
    title: "Set up DatIQ for your role | DatIQ.app",
    description:
      "Pick your role — Sales, RevOps, Product & CI, Product Marketing, SEO & Content, Brand & Growth, Founder & VC, or Agency — and see what DatIQ does for you, which modules you'll use, and where to start.",
    canonical: "https://datiq.app/onboarding",
  });
  const navigate = useNavigate();
  const { personaId, selectPersona, completeOnboarding } = usePersona();
  const [step, setStep] = useState(1);
  // A legacy role (recruiter) is not offered here, so it shows as "none picked".
  const [localSelected, setLocalSelected] = useState(
    PERSONA_BY_ID[personaId] && !PERSONA_BY_ID[personaId].legacy ? personaId : null,
  );

  const handleSelect = (id) => {
    setLocalSelected(id);
    selectPersona(id);
  };

  const persona = PERSONAS.find((p) => p.id === localSelected) || null;

  const finish = (name, to) => {
    completeOnboarding(name);
    navigate(to || "/", { replace: true });
  };

  return (
    <div className="page ob-page">
      <div className="ob-bg-glow" />

      <div className="ob-stepper" aria-label={`Step ${step} of 2`}>
        <div className={"ob-step-dot" + (step >= 1 ? " ob-step-dot-on" : "")} />
        <div className="ob-step-line" />
        <div className={"ob-step-dot" + (step >= 2 ? " ob-step-dot-on" : "")} />
      </div>

      <div className={"ob-content" + (step === 1 ? " ob-content-wide" : "")}>
        {step === 1 || !persona ? (
          <StepOne
            selected={localSelected}
            onSelect={handleSelect}
            onNext={() => persona && setStep(2)}
            onStartHere={() => persona && finish("", persona.firstStep.to)}
            onSkip={() => finish("", "/")}
          />
        ) : (
          <StepTwo persona={persona} onComplete={finish} onBack={() => setStep(1)} />
        )}
      </div>
    </div>
  );
}
