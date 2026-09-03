// RecipeGallery.jsx — outcome-first view of what the integrations actually do.
//
// PRD: "customers do not buy DatIQ because 'it has a Zapier integration'. They
// buy it because a relevant event is detected and the next action occurs
// automatically." So each card leads with the OUTCOME, then when → then, and
// the destination logo is the smallest thing on it — the reverse of the logo
// grid on /integrations.
//
// Roadmap recipes are shown but never rendered as runnable: a card whose
// button does nothing is how a gallery teaches users it is decorative.
import { Link } from "react-router";
import { recipesForPersona, isRunnable, RECIPE_READINESS } from "../lib/recipes/recipeCatalog.js";
import { PUSH_PROVIDERS } from "../lib/integrationsClient.js";
import Icon from "./Icon.jsx";

const PROVIDER_BY_SLUG = Object.fromEntries(PUSH_PROVIDERS.map((p) => [p.slug, p]));

function ReadinessTag({ recipe }) {
  if (recipe.readiness === RECIPE_READINESS.RULES) {
    return (
      // Short tag, phase named once in the footer. Saying it in both places
      // made the same six words appear twice on one small card.
      <span className="recipe-tag recipe-tag-soon" title={`Needs: ${recipe.phase}`}>Soon</span>
    );
  }
  if (recipe.readiness === RECIPE_READINESS.MANUAL) {
    // Deliberately explicit. The destination works; the trigger is a button
    // press, not an automatic rule. Calling this "live" would over-promise an
    // automation that does not exist yet.
    return <span className="recipe-tag recipe-tag-manual" title="Runs when you press Push — automatic triggers arrive with signal routing">One click</span>;
  }
  return <span className="recipe-tag recipe-tag-live">Ready now</span>;
}

export default function RecipeGallery({ personaId = null, limit = null, heading = "What you can wire up" }) {
  const all = recipesForPersona(personaId);
  const recipes = limit ? all.slice(0, limit) : all;
  if (!recipes.length) return null;

  return (
    <section className="recipe-gallery" aria-labelledby="recipe-gallery-heading">
      <div className="recipe-gallery-head">
        <h2 id="recipe-gallery-heading">{heading}</h2>
        <p className="recipe-gallery-sub">
          Every one of these ends somewhere your team already works — not in a downloads folder.
        </p>
      </div>

      <ul className="recipe-grid">
        {recipes.map((r) => {
          const provider = PROVIDER_BY_SLUG[r.provider];
          const runnable = isRunnable(r);
          return (
            <li key={r.key} className={"recipe-card card" + (runnable ? "" : " recipe-card-soon")}>
              <div className="recipe-card-top">
                <span className="recipe-provider" title={provider?.desc || r.provider}>
                  <Icon name={provider?.icon || "share"} size={14} />
                  {provider?.name || r.provider}
                </span>
                <ReadinessTag recipe={r} />
              </div>

              <h3 className="recipe-title">{r.title}</h3>
              <p className="recipe-outcome">{r.outcome}</p>

              <dl className="recipe-flow">
                <dt>When</dt><dd>{r.when}</dd>
                <dt>Then</dt><dd>{r.then}</dd>
              </dl>

              {runnable ? (
                <Link className="btn btn-secondary btn-sm recipe-cta" to={r.cta.to}>
                  {r.cta.label}
                </Link>
              ) : (
                // No button at all, rather than a disabled one. A control that
                // looks pressable and is not is worse than none.
                <p className="recipe-cta-soon">Not available yet — arrives with {r.phase}.</p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
