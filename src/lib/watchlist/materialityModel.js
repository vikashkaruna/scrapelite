// src/lib/watchlist/materialityModel.js — Pure materiality classifier & delta model (PRD 4).
//
// Separates objective FACTS (the verbatim delta) from INTERPRETATION (strategic meaning).
// Classifies changes into:
//   - CRITICAL: immediate alert (major price hikes, plan removals, core positioning shift)
//   - HIGH: daily digest (minor price shifts, tier limit changes, new feature additions)
//   - MEDIUM: weekly digest (marketing copy adjustments, FAQ updates)
//   - LOW: store, no alert (whitespace, copyright year bumps)
//   - UNKNOWN: review queue

export const MATERIALITY = {
  CRITICAL: "critical",
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
  UNKNOWN: "unknown",
};

export const CADENCE_FOR_MATERIALITY = {
  [MATERIALITY.CRITICAL]: "immediate",
  [MATERIALITY.HIGH]: "daily",
  [MATERIALITY.MEDIUM]: "weekly",
  [MATERIALITY.LOW]: "none",
  [MATERIALITY.UNKNOWN]: "review",
};

function parsePrice(str) {
  if (typeof str === "number") return str;
  if (!str || typeof str !== "string") return null;
  const match = str.replace(/,/g, "").match(/[\d.]+/);
  return match ? parseFloat(match[0]) : null;
}

/**
 * Deterministically classifies the materiality of a detected field change.
 *
 * @param {{ field: string, category: string, oldValue: string, newValue: string }} delta
 * @returns {{ materiality: string, reason: string, alertCadence: string }}
 */
export function classifyMateriality({ field, category = "other", oldValue = "", newValue = "" }) {
  const oldStr = String(oldValue || "").trim();
  const newStr = String(newValue || "").trim();

  // Low materiality: purely cosmetic or copyright year changes
  if (oldStr.toLowerCase() === newStr.toLowerCase()) {
    return {
      materiality: MATERIALITY.LOW,
      reason: "Cosmetic or case change only",
      alertCadence: CADENCE_FOR_MATERIALITY[MATERIALITY.LOW],
    };
  }

  if (/202[0-9]/.test(oldStr) && /202[0-9]/.test(newStr) && oldStr.replace(/202[0-9]/g, "") === newStr.replace(/202[0-9]/g, "")) {
    return {
      materiality: MATERIALITY.LOW,
      reason: "Copyright or calendar year update",
      alertCadence: CADENCE_FOR_MATERIALITY[MATERIALITY.LOW],
    };
  }

  // Pricing changes
  if (category === "pricing" || field.toLowerCase().includes("price") || field.toLowerCase().includes("plan")) {
    const oldPrice = parsePrice(oldStr);
    const newPrice = parsePrice(newStr);

    if (oldPrice != null && newPrice != null) {
      const pctChange = Math.abs((newPrice - oldPrice) / oldPrice) * 100;
      if (pctChange >= 20 || oldPrice === 0 || newPrice === 0) {
        return {
          materiality: MATERIALITY.CRITICAL,
          reason: `Significant price movement (${pctChange.toFixed(1)}%)`,
          alertCadence: CADENCE_FOR_MATERIALITY[MATERIALITY.CRITICAL],
        };
      }
      return {
        materiality: MATERIALITY.HIGH,
        reason: `Modest price change (${pctChange.toFixed(1)}%)`,
        alertCadence: CADENCE_FOR_MATERIALITY[MATERIALITY.HIGH],
      };
    }

    // Plan added or removed
    if (!oldStr && newStr) {
      return {
        materiality: MATERIALITY.HIGH,
        reason: "New plan or pricing tier introduced",
        alertCadence: CADENCE_FOR_MATERIALITY[MATERIALITY.HIGH],
      };
    }
    if (oldStr && !newStr) {
      return {
        materiality: MATERIALITY.CRITICAL,
        reason: "Plan or tier removed from public pricing",
        alertCadence: CADENCE_FOR_MATERIALITY[MATERIALITY.CRITICAL],
      };
    }
  }

  // Positioning changes
  if (category === "positioning" || field.includes("tagline") || field.includes("headline") || field.includes("hero")) {
    // Check if the change is substantial (> 40% words changed)
    const oldWords = new Set(oldStr.toLowerCase().split(/\s+/));
    const newWords = new Set(newStr.toLowerCase().split(/\s+/));
    const common = [...oldWords].filter((w) => newWords.has(w)).length;
    const overlap = common / Math.max(oldWords.size, 1);

    if (overlap < 0.4) {
      return {
        materiality: MATERIALITY.CRITICAL,
        reason: "Major positioning or messaging pivot",
        alertCadence: CADENCE_FOR_MATERIALITY[MATERIALITY.CRITICAL],
      };
    }
    return {
      materiality: MATERIALITY.MEDIUM,
      reason: "Copy refinement in positioning statement",
      alertCadence: CADENCE_FOR_MATERIALITY[MATERIALITY.MEDIUM],
    };
  }

  // Product changes
  if (category === "product" || field.includes("feature")) {
    if (!oldStr && newStr) {
      return {
        materiality: MATERIALITY.HIGH,
        reason: "New capability or feature advertised",
        alertCadence: CADENCE_FOR_MATERIALITY[MATERIALITY.HIGH],
      };
    }
    return {
      materiality: MATERIALITY.MEDIUM,
      reason: "Feature description update",
      alertCadence: CADENCE_FOR_MATERIALITY[MATERIALITY.MEDIUM],
    };
  }

  return {
    materiality: MATERIALITY.MEDIUM,
    reason: "General content update",
    alertCadence: CADENCE_FOR_MATERIALITY[MATERIALITY.MEDIUM],
  };
}

/**
 * Builds the strictly separated fact summary vs strategic AI interpretation.
 */
export function buildChangeRecord({ targetDomain, field, category, oldValue, newValue }) {
  const { materiality, reason, alertCadence } = classifyMateriality({
    field,
    category,
    oldValue,
    newValue,
  });

  const factSummary = oldValue
    ? `'${field}' changed on ${targetDomain} from "${oldValue}" to "${newValue}"`
    : `New '${field}' published on ${targetDomain}: "${newValue}"`;

  let aiInterpretation = "";
  if (materiality === MATERIALITY.CRITICAL) {
    aiInterpretation = `High-impact change on ${targetDomain}: ${reason}. Re-evaluate competitive positioning and sales battlecards.`;
  } else if (materiality === MATERIALITY.HIGH) {
    aiInterpretation = `Noteworthy competitive move: ${reason}. Monitor for downstream churn or sales inquiries.`;
  } else {
    aiInterpretation = `Routine update: ${reason}.`;
  }

  return {
    field,
    category,
    oldValue,
    newValue,
    materiality,
    reason,
    alertCadence,
    factSummary,
    aiInterpretation,
  };
}
