// portfolioModel.js — 9-axis portfolio rollups and aggregations (Stage 4 / P3C).
//
// PURE. Imported by React components and Netlify functions.
//
// ── THE 9 ROLLUP AXES (LOCKED — §5 / §11.10) ───────────────────────────────
// 1. workspace
// 2. brand
// 3. business_unit
// 4. product_line
// 5. service_line
// 6. location
// 7. market_language
// 8. template
// 9. owner_team
//
// ⚠️ STANDING RULE (§11.10):
// "A rollup over unaudited subjects is NO DATA (null), not zero."

import { round1 } from "./scoringModel.js";

export const PORTFOLIO_ROLLUP_AXES = Object.freeze([
  "workspace",
  "brand",
  "business_unit",
  "product_line",
  "service_line",
  "location",
  "market_language",
  "template",
  "owner_team",
]);

export const PORTFOLIO_ROLLUP_AXIS_SET = Object.freeze(new Set(PORTFOLIO_ROLLUP_AXES));

/**
 * Calculates portfolio score rollups grouped along one of the 9 axes.
 *
 * @param {Array<object>} audits - List of audit objects with framework and sxo scores
 * @param {string} [axis="template"] - One of the 9 rollup axes
 * @param {object} [options={}]
 * @returns {object} { axis, groups: Array<object>, total_audits: number, unaudited_count: number }
 */
export function calculatePortfolioRollup(audits = [], axis = "template", options = {}) {
  const chosenAxis = PORTFOLIO_ROLLUP_AXIS_SET.has(axis) ? axis : "template";
  const items = Array.isArray(audits) ? audits : [];

  const groupsMap = new Map();
  let unauditedCount = 0;

  for (const item of items) {
    let axisVal = null;
    if (chosenAxis === "template") {
      axisVal = item.page_type_hint || item.template || item.template_key || "unknown";
    } else if (chosenAxis === "workspace") {
      axisVal = item.workspace_id || "default";
    } else if (chosenAxis === "owner_team") {
      axisVal = item.owner_team || item.owner || "unassigned";
    } else {
      axisVal = item[chosenAxis] || item.metadata?.[chosenAxis] || item.subject_type || "unspecified";
    }

    const key = String(axisVal || "unspecified").trim().toLowerCase();
    if (!groupsMap.has(key)) {
      groupsMap.set(key, {
        axis_key: key,
        axis_label: axisVal,
        audits: [],
      });
    }
    groupsMap.get(key).audits.push(item);
  }

  const rollups = [];

  for (const [key, group] of groupsMap.entries()) {
    const list = group.audits;
    const scoredList = list.filter((a) => {
      const s = a.master_score ?? a.final_score ?? a.result?.final_score ?? a.sxo_total_score;
      return typeof s === "number" && Number.isFinite(s);
    });

    if (scoredList.length === 0) {
      unauditedCount += list.length;
      rollups.push({
        axis: chosenAxis,
        axis_key: key,
        axis_label: group.axis_label,
        audit_count: list.length,
        scored_audit_count: 0,
        master_score: null,
        framework_scores: {
          seo: null,
          aeo: null,
          geo: null,
          sxo: null,
        },
        coverage: 0,
        status: "no_data",
      });
      continue;
    }

    // Average master score
    const avgMaster = round1(
      scoredList.reduce((acc, a) => {
        const val = a.master_score ?? a.final_score ?? a.result?.final_score ?? a.sxo_total_score;
        return acc + Number(val);
      }, 0) / scoredList.length
    );

    // Average framework scores
    const frameworks = ["seo", "aeo", "geo", "sxo"];
    const avgFrameworks = {};
    for (const fw of frameworks) {
      const withFw = scoredList.filter((a) => {
        const fwVal = a.framework_scores?.[fw]?.score ?? a.result?.framework_scores?.[fw]?.score ?? (fw === "sxo" ? a.sxo_total_score : null);
        return typeof fwVal === "number" && Number.isFinite(fwVal);
      });
      if (withFw.length > 0) {
        avgFrameworks[fw] = round1(
          withFw.reduce((acc, a) => {
            const fwVal = a.framework_scores?.[fw]?.score ?? a.result?.framework_scores?.[fw]?.score ?? (fw === "sxo" ? a.sxo_total_score : null);
            return acc + Number(fwVal);
          }, 0) / withFw.length
        );
      } else {
        avgFrameworks[fw] = null;
      }
    }

    const avgCoverage = Math.round(
      scoredList.reduce((acc, a) => acc + Number(a.coverage ?? 100), 0) / scoredList.length
    );

    rollups.push({
      axis: chosenAxis,
      axis_key: key,
      axis_label: group.axis_label,
      audit_count: list.length,
      scored_audit_count: scoredList.length,
      master_score: avgMaster,
      framework_scores: avgFrameworks,
      coverage: avgCoverage,
      status: "scored",
    });
  }

  // Sort rollups by audit_count descending
  rollups.sort((a, b) => b.audit_count - a.audit_count);

  return {
    axis: chosenAxis,
    rollups,
    total_audits: items.length,
    unaudited_count: unauditedCount,
  };
}
