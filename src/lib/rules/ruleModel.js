// src/lib/rules/ruleModel.js — Pure rule evaluation engine for Native Signal Routing (PRD 5).
//
// Evaluates if-this-then-that routing conditions against incoming events
// (Competitor Watchlist Changes, Bulk ICP Qualifiers, Workflow Runs).
// Shared between runtime dispatcher and "Test with sample payload" UI.

export const TRIGGER_SOURCES = {
  WATCHLIST: "watchlist",
  BULK_ENRICHMENT: "bulk_enrichment",
  WORKFLOW_RUN: "workflow_run",
};

export const ACTION_TYPES = {
  SLACK: "slack",
  EMAIL: "email",
  WEBHOOK: "webhook",
  HUBSPOT: "hubspot",
};

/**
 * Evaluates a signal rule's conditions against an event payload.
 *
 * @param {{ trigger_source: string, conditions: Array<{ field: string, operator: string, value: any }> }} rule
 * @param {Record<string, any>} eventPayload
 * @returns {{ matches: boolean, reasons: string[] }}
 */
export function evaluateSignalRule(rule, eventPayload = {}) {
  if (!rule) return { matches: false, reasons: ["Rule is undefined"] };

  if (rule.trigger_source && eventPayload.source && rule.trigger_source !== eventPayload.source) {
    return {
      matches: false,
      reasons: [`Trigger source mismatch: rule expects '${rule.trigger_source}', got '${eventPayload.source}'`],
    };
  }

  const conditions = rule.conditions || [];
  if (!Array.isArray(conditions) || conditions.length === 0) {
    return { matches: true, reasons: ["No conditions specified — matched by default"] };
  }

  const reasons = [];
  let allMatched = true;

  for (const cond of conditions) {
    const { field, operator, value } = cond;
    const actual = eventPayload[field];

    let condPassed = false;
    let reason = "";

    switch (operator) {
      case "equals": {
        condPassed = String(actual).toLowerCase() === String(value).toLowerCase();
        reason = condPassed
          ? `${field} equals '${value}'`
          : `${field} is '${actual}', expected '${value}'`;
        break;
      }

      case "not_equals": {
        condPassed = String(actual).toLowerCase() !== String(value).toLowerCase();
        reason = condPassed
          ? `${field} is not '${value}'`
          : `${field} equals '${value}'`;
        break;
      }

      case "in": {
        const list = Array.isArray(value) ? value.map((v) => String(v).toLowerCase()) : [];
        condPassed = list.includes(String(actual).toLowerCase());
        reason = condPassed
          ? `${field} ('${actual}') is in [${list.join(", ")}]`
          : `${field} ('${actual}') is not in [${list.join(", ")}]`;
        break;
      }

      case "gte": {
        const nActual = parseFloat(actual);
        const nTarget = parseFloat(value);
        condPassed = !isNaN(nActual) && !isNaN(nTarget) && nActual >= nTarget;
        reason = condPassed
          ? `${field} (${nActual}) >= ${nTarget}`
          : `${field} (${nActual}) < ${nTarget}`;
        break;
      }

      case "lte": {
        const nActual = parseFloat(actual);
        const nTarget = parseFloat(value);
        condPassed = !isNaN(nActual) && !isNaN(nTarget) && nActual <= nTarget;
        reason = condPassed
          ? `${field} (${nActual}) <= ${nTarget}`
          : `${field} (${nActual}) > ${nTarget}`;
        break;
      }

      case "contains": {
        condPassed = String(actual || "").toLowerCase().includes(String(value || "").toLowerCase());
        reason = condPassed
          ? `${field} contains '${value}'`
          : `${field} does not contain '${value}'`;
        break;
      }

      case "not_empty": {
        condPassed = actual !== undefined && actual !== null && String(actual).trim() !== "";
        reason = condPassed ? `${field} is not empty` : `${field} is empty`;
        break;
      }

      default:
        condPassed = false;
        reason = `Unknown operator '${operator}'`;
    }

    reasons.push(reason);
    if (!condPassed) {
      allMatched = false;
    }
  }

  return {
    matches: allMatched,
    reasons,
  };
}

/**
 * Prepares the outgoing dispatch payload for the selected action type.
 */
export function formatActionPayload(rule, eventPayload) {
  const actionType = rule.action_type || ACTION_TYPES.SLACK;
  const config = rule.action_config || {};

  switch (actionType) {
    case ACTION_TYPES.SLACK:
      return {
        channel: config.channel || "#signals",
        text: `*DatIQ Signal Alert: ${rule.name}*\n${eventPayload.fact_summary || eventPayload.summary || "Triggered by incoming event."}`,
        attachments: [
          {
            color: eventPayload.materiality === "critical" ? "#b91c1c" : "#059669",
            fields: [
              { title: "Target", value: eventPayload.domain || "—", short: true },
              { title: "Materiality", value: eventPayload.materiality || "Normal", short: true },
              { title: "Interpretation", value: eventPayload.ai_interpretation || "—", short: false },
            ],
          },
        ],
      };

    case ACTION_TYPES.EMAIL:
      return {
        recipients: config.recipients || [],
        subject: `[DatIQ Signal] ${rule.name}: ${eventPayload.domain || "New Alert"}`,
        body: `Fact: ${eventPayload.fact_summary || eventPayload.summary}\n\nStrategic Context:\n${eventPayload.ai_interpretation || "None"}`,
      };

    case ACTION_TYPES.WEBHOOK:
      return {
        url: config.webhook_url,
        payload: {
          rule_id: rule.id,
          rule_name: rule.name,
          timestamp: new Date().toISOString(),
          event: eventPayload,
        },
      };

    case ACTION_TYPES.HUBSPOT:
      return {
        object_type: "company",
        domain: eventPayload.domain,
        properties: {
          datiq_icp_score: eventPayload.icp_score,
          datiq_last_signal: eventPayload.fact_summary || eventPayload.field,
        },
      };

    default:
      return { raw: eventPayload };
  }
}
