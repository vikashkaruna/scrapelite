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
// Entry (see lib/postAuthIntent.js): ?next= is where to return afterwards (a
// mid-task sign-in, the Personalise card); ?role= pre-selects a role (a use-case
// page sign-up); ?mode=switch is "Switch persona" from the account menu — the
// current role stays in force until a new one is confirmed, and "Keep" leaves
// everything exactly as it was. Nothing is written until the user finishes.
//
// Style: the Home hero card (accent-tinted gradient card, eyebrow, big title)
// and the existing ob-* tokens — no new visual language.
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import Icon from "../components/Icon.jsx";
import Button from "../components/Button.jsx";
import { PERSONAS, PERSONA_BY_ID } from "../lib/personaConfig.js";
import { ROLE_MODULES, roleModuleStatus } from "../lib/roleModules.js";
import { usePersona } from "../components/PersonaProvider.jsx";
import { RECIPE_PACKS, getPackByKey } from "../lib/extractionTemplates.js";
import { useSeo } from "../hooks/useSeo.js";
import { useAuth } from "../components/AuthProvider.jsx";
import { safeNext } from "../lib/postAuthIntent.js";
import { track } from "../lib/analyticsService.js";

const offered = (id) => (PERSONA_BY_ID[id] && !PERSONA_BY_ID[id].legacy ? id : null);

// First name from the account, so step two does not ask for something we know.
function nameFromUser(user) {
  const m = user?.user_metadata || {};
  const full = m.user_name || m.full_name || m.name || "";
  return String(full).trim().split(/\s+/)[0] || "";
}

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

function RoleDetail({ persona, onContinue, onStartHere, startLabel }) {
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
          {startLabel || `Or start here: ${persona.firstStep.label}`}
        </button>
      </div>
    </aside>
  );
}

function StepOne({ selected, onSelect, onNext, onStartHere, onSkip, switchMode, currentLabel, returning, headingRef }) {
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
          {switchMode ? "Switch persona" : "Set up DatIQ for your work"}
        </div>
        <h1 id="ob-title" className="ob-title" tabIndex={-1} ref={headingRef}>
          {switchMode ? "Switch your role" : "What do you want DatIQ to do for you?"}
        </h1>
        <p className="ob-subtitle">
          {switchMode
            ? "Pick a new role and we'll re-tailor your home screen, templates and first steps. Your saved extractions, audits, lists and settings stay exactly as they are."
            : "Pick the role closest to yours. We'll tailor your home screen, templates and first steps to it — you can change it any time from the account menu."}
        </p>
        {switchMode && currentLabel && (
          <p className="ob-switch-note">Current role: <b>{currentLabel}</b></p>
        )}
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
        <RoleDetail
          persona={persona}
          onContinue={onNext}
          onStartHere={onStartHere}
          startLabel={returning ? "Save and go back to what I was doing" : null}
        />
      </div>

      <p className="ob-skip">
        {switchMode ? (
          <button type="button" className="ob-skip-link" onClick={onSkip}>
            {currentLabel ? `Keep ${currentLabel}` : "Cancel"}
          </button>
        ) : (
          <>
            Just exploring?{" "}
            <button type="button" className="ob-skip-link" onClick={onSkip}>Skip for now</button>
          </>
        )}
      </p>
    </div>
  );
}

function StepTwo({ persona, onComplete, onBack, initialName = "", returnTo }) {
  const [name, setName] = useState(initialName);
  const primaryTo = returnTo || persona.firstStep.to;
  const primaryLabel = returnTo ? "Save and go back to what I was doing" : persona.firstStep.label;
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
          onKeyDown={(e) => e.key === "Enter" && finish(primaryTo)}
          autoComplete="given-name"
        />
      </div>

      <Button
        variant="primary"
        iconRight="arrow-right"
        onClick={() => finish(primaryTo)}
        style={{ minWidth: 240, height: 52, fontSize: "1.05em" }}
      >
        {primaryLabel}
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
  const [params] = useSearchParams();
  const { user } = useAuth();
  const { personaId, onboarded, userName, selectPersona, completeOnboarding } = usePersona();
  const switchMode = params.get("mode") === "switch";
  const next = safeNext(params.get("next"));
  const returnTo = next && !next.startsWith("/onboarding") ? next : null;
  const [step, setStep] = useState(1);
  // A legacy role (recruiter) is not offered here, so it shows as "none picked".
  // A ?role= hint (signed up from a use-case page) is pre-selected, never saved
  // until the user confirms it.
  const current = offered(personaId);
  const [localSelected, setLocalSelected] = useState(() => offered(params.get("role")) || current);
  const headingRef = useRef(null);

  // Land keyboard and screen-reader users on the question, not the page top.
  useEffect(() => { headingRef.current?.focus?.(); }, []);

  const persona = PERSONAS.find((p) => p.id === localSelected) || null;
  const currentLabel = current ? PERSONA_BY_ID[current].label : "";

  // Selection is local until the user finishes, so backing out of a switch
  // leaves the current role exactly as it was.
  const finish = (name, to) => {
    if (localSelected && localSelected !== personaId) selectPersona(localSelected);
    completeOnboarding(name);
    try {
      track("onboarding_completed", {
        persona: localSelected || null,
        mode: switchMode ? "switch" : "first_run",
        returned: Boolean(returnTo),
      });
    } catch { /* best-effort */ }
    navigate(to || returnTo || "/", { replace: true });
  };

  const skip = () => {
    if (switchMode) {
      navigate(returnTo || "/", { replace: true });
      return;
    }
    // "Skip for now" still counts as onboarded, so nobody is asked again; the
    // role stays changeable from the account menu.
    if (!onboarded) completeOnboarding("");
    try { track("onboarding_completed", { persona: current, mode: "first_run", skipped: true }); } catch { /* best-effort */ }
    navigate(returnTo || "/", { replace: true });
  };

  return (
    <div className="page ob-page">
      <div className="ob-bg-glow" />

      <p className="sr-only" role="status" aria-live="polite">Step {step} of 2</p>
      <div className="ob-stepper" aria-hidden="true">
        <div className={"ob-step-dot" + (step >= 1 ? " ob-step-dot-on" : "")} />
        <div className="ob-step-line" />
        <div className={"ob-step-dot" + (step >= 2 ? " ob-step-dot-on" : "")} />
      </div>

      <div className={"ob-content" + (step === 1 ? " ob-content-wide" : "")}>
        {step === 1 || !persona ? (
          <StepOne
            selected={localSelected}
            onSelect={setLocalSelected}
            onNext={() => persona && setStep(2)}
            onStartHere={() => persona && finish("", returnTo || persona.firstStep.to)}
            onSkip={skip}
            switchMode={switchMode}
            currentLabel={currentLabel}
            returning={Boolean(returnTo)}
            headingRef={headingRef}
          />
        ) : (
          <StepTwo
            persona={persona}
            onComplete={finish}
            onBack={() => setStep(1)}
            initialName={userName || nameFromUser(user)}
            returnTo={returnTo}
          />
        )}
      </div>
    </div>
  );
}
