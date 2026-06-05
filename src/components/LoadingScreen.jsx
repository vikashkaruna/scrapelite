// LoadingScreen.jsx — full-screen "Parsing webpage…" state with stepped progress.
import { useEffect, useState } from "react";
import Icon from "./Icon.jsx";

const STEPS = ["Fetching webpage", "Parsing structure", "Extracting links", "Summarizing with AI"];

export default function LoadingScreen({ url }) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 560);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="page" style={{ alignItems: "center", justifyContent: "center" }}>
      <div
        className="fade"
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          padding: 40,
        }}
      >
        <div className="load-orb">
          <div className="spinner" style={{ "--sp-size": "40px", borderWidth: "3.5px" }} />
          <Icon name="layers" size={22} style={{ position: "absolute", color: "var(--accent)" }} />
        </div>
        <div
          style={{
            fontSize: "clamp(22px,3vw,28px)",
            fontWeight: 750,
            letterSpacing: "-.02em",
            marginTop: 30,
          }}
        >
          Parsing webpage…
        </div>
        <div
          style={{
            color: "var(--text-3)",
            marginTop: 8,
            fontSize: ".95em",
            fontWeight: 550,
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            maxWidth: "70ch",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          <Icon name="globe" size={15} /> {url}
        </div>

        <div className="load-steps">
          {STEPS.map((s, i) => (
            <div
              key={s}
              className={"load-step" + (i < step ? " done" : i === step ? " active" : "")}
            >
              <span className="load-step-dot">
                {i < step ? (
                  <Icon name="check" size={13} strokeWidth={3} />
                ) : i === step ? (
                  <span className="spinner" style={{ "--sp-size": "14px", borderWidth: "2px" }} />
                ) : (
                  <span className="load-step-idle" />
                )}
              </span>
              {s}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
