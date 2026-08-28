// src/components/TryExampleDemo.jsx — Q1 (alt) Interactive Try-an-Example demo.
//
// An auto-playing, self-contained walkthrough on the Home page that types a
// URL into the composer character-by-character, "extracts" it (via the mock
// provider), and progressively reveals the AI summary + headings + links.
// Gives the user an "aha moment" without forcing them to paste a URL or sign
// up. Respects prefers-reduced-motion: skips the animation and shows the
// final state immediately.

import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "./Icon.jsx";
import { LUMIO_EXTRACTION } from "../data/mockData.js";

const DEMO_URL = "https://lumio.io";
const REDUCED_MOTION = typeof window !== "undefined"
  && window.matchMedia
  && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const TYPE_SPEED_MS = REDUCED_MOTION ? 0 : 28;
const REVEAL_DELAY_MS = REDUCED_MOTION ? 0 : 350;

// Auto-play once per browser, same idea as onboardingTour.js's "seen before"
// flag. The section itself makes no real API call — it types into a mock
// composer and reveals canned data — but re-running the scripted 5-second
// sequence on every visit to Home is wasted motion for a returning user.
// The "Replay" button stays available for anyone who wants to see it again.
const SEEN_KEY = "datiq.tryDemoSeen";
function hasSeenDemo() {
  try { return localStorage.getItem(SEEN_KEY) === "1"; } catch { return false; }
}
function markDemoSeen() {
  try { localStorage.setItem(SEEN_KEY, "1"); } catch { /* unavailable */ }
}

function makeSteps() {
  return [
    { id: "type",   label: "Type a URL" },
    { id: "intent", label: "Pick what to extract" },
    { id: "extract",label: "AI runs the extraction" },
    { id: "summary",label: "Read the AI summary" },
    { id: "headings",label: "Browse headings + links" },
  ];
}

export default function TryExampleDemo() {
  const steps = useMemo(makeSteps, []);
  // A returning visitor starts already at the finished state — the existing
  // `stepIdx >= steps.length` guard in the auto-advance effect below then
  // simply never fires, so the sequence doesn't re-run. Manually clicking
  // "Replay" still resets stepIdx to 0 and plays it, same as before.
  const [alreadySeen] = useState(hasSeenDemo);
  const [stepIdx, setStepIdx] = useState(() => (alreadySeen ? steps.length : 0));
  const [typed, setTyped] = useState(() => (alreadySeen ? DEMO_URL : ""));
  const [intentPicked, setIntentPicked] = useState(alreadySeen);
  const [extracting, setExtracting] = useState(false);
  const [extracted, setExtracted] = useState(alreadySeen);
  const [summaryShown, setSummaryShown] = useState(alreadySeen);
  const [headingsShown, setHeadingsShown] = useState(alreadySeen);
  const [paused, setPaused] = useState(false);
  const timerRef = useRef(null);

  // Auto-advance loop. Each step has a clear trigger so we don't need
  // arbitrary waits.
  useEffect(() => {
    if (paused) return;
    if (stepIdx >= steps.length) return;

    const step = steps[stepIdx];
    let cleanup = null;
    const advance = () => setStepIdx((i) => Math.min(i + 1, steps.length));

    if (step.id === "type") {
      // Type the URL character-by-character.
      let i = 0;
      const id = setInterval(() => {
        i += 1;
        setTyped(DEMO_URL.slice(0, i));
        if (i >= DEMO_URL.length) {
          clearInterval(id);
          setTimeout(advance, REVEAL_DELAY_MS);
        }
      }, TYPE_SPEED_MS);
      cleanup = () => clearInterval(id);
    } else if (step.id === "intent") {
      const t = setTimeout(() => { setIntentPicked(true); advance(); }, REVEAL_DELAY_MS * 2);
      cleanup = () => clearTimeout(t);
    } else if (step.id === "extract") {
      setExtracting(true);
      const t = setTimeout(() => { setExtracting(false); setExtracted(true); advance(); }, REVEAL_DELAY_MS * 4);
      cleanup = () => clearTimeout(t);
    } else if (step.id === "summary") {
      const t = setTimeout(() => { setSummaryShown(true); advance(); }, REVEAL_DELAY_MS * 2);
      cleanup = () => clearTimeout(t);
    } else if (step.id === "headings") {
      const t = setTimeout(() => { setHeadingsShown(true); advance(); }, REVEAL_DELAY_MS * 2);
      cleanup = () => clearTimeout(t);
    }

    return () => { if (cleanup) cleanup(); };
  }, [stepIdx, paused, steps]);

  // Mark seen once the sequence reaches its end — whether that's a real
  // completed play-through or (for a returning visitor) the already-finished
  // initial state above. Idempotent, so re-firing on the initial render is
  // harmless.
  useEffect(() => {
    if (stepIdx >= steps.length) markDemoSeen();
  }, [stepIdx, steps.length]);

  // Reset on unmount.
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const restart = () => {
    setStepIdx(0);
    setTyped("");
    setIntentPicked(false);
    setExtracting(false);
    setExtracted(false);
    setSummaryShown(false);
    setHeadingsShown(false);
  };

  const isDone = stepIdx >= steps.length;

  return (
    <section className="try-demo" aria-label="Interactive try-an-example demo">
      <div className="try-demo-head">
        <span className="try-demo-eyebrow">
          <Icon name="party" size={12} />
          Try it now
        </span>
        <h2 className="try-demo-title">See a real extraction in 5 seconds.</h2>
        <p className="try-demo-sub">
          No signup. No URL to paste. We auto-type a public example and walk
          you through the result.
        </p>
      </div>

      <div className="try-demo-stage card">
        <div className="try-demo-chips">
          {steps.map((s, i) => (
            <span
              key={s.id}
              className={
                "try-demo-chip"
                + (i < stepIdx ? " done" : "")
                + (i === stepIdx ? " active" : "")
              }
            >
              {i < stepIdx ? <Icon name="check-big" size={10} /> : <span className="try-demo-num">{i + 1}</span>}
              {s.label}
            </span>
          ))}
        </div>

        <div className="try-demo-frame">
          {/* Mocked composer with auto-typed URL */}
          <div className="try-demo-composer">
            <Icon name="link" size={13} className="try-demo-icon-left" />
            <span className="try-demo-url">{typed}<span className="try-demo-caret" /></span>
            <button
              type="button"
              className={"try-demo-cta" + (extracting ? " running" : "") + (extracted ? " done" : "")}
              disabled
            >
              {extracting
                ? <><Icon name="loader" size={12} className="spin" /> Extracting…</>
                : extracted
                  ? <><Icon name="check" size={12} /> Extracted</>
                  : <><Icon name="zap" size={12} /> Extract</>}
            </button>
          </div>

          {intentPicked && (
            <div className="try-demo-intent">
              <span className="try-demo-intent-pill">
                <Icon name="sparkles" size={10} />
                AI summary
              </span>
            </div>
          )}

          {extracted && (
            <div className={"try-demo-result" + (summaryShown ? " show-summary" : "") + (headingsShown ? " show-headings" : "")}>
              <h3 className="try-demo-result-title">
                {LUMIO_EXTRACTION.page_title}
              </h3>
              {summaryShown && (
                <p className="try-demo-summary">{LUMIO_EXTRACTION.ai_summary}</p>
              )}
              {headingsShown && (
                <ul className="try-demo-headings">
                  {LUMIO_EXTRACTION.headings.slice(0, 5).map((h, i) => (
                    <li key={i}>
                      <span className="try-demo-h-level">H{h.level}</span> {h.text}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="try-demo-foot">
          <button
            type="button"
            className="try-demo-ctrl"
            onClick={() => setPaused((p) => !p)}
          >
            <Icon name={paused ? "play" : "pause"} size={11} />
            {paused ? "Resume" : "Pause"}
          </button>
          <button
            type="button"
            className="try-demo-ctrl"
            onClick={restart}
          >
            <Icon name="rotate-cw" size={11} />
            Replay
          </button>
          {isDone && (
            <span className="try-demo-cta-final">
              <Icon name="check-big" size={11} />
              That's it — your turn
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
