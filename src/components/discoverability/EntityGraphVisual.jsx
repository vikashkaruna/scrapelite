// EntityGraphVisual.jsx — Visual Topological Graph for Entity Graph Builder.
// Renders nodes and directed relationship edges with predicate labels.

import { useState, useMemo } from "react";
import Icon from "../Icon.jsx";
import { ENTITY_TYPES, PREDICATES } from "../../lib/discoverability/entityGraph.js";

const TYPE_COLORS = {
  organization: { bg: "rgba(59, 130, 246, 0.15)", border: "#3b82f6", text: "#2563eb" },
  brand: { bg: "rgba(99, 102, 241, 0.15)", border: "#6366f1", text: "#4f46e5" },
  product: { bg: "rgba(16, 185, 129, 0.15)", border: "#10b981", text: "#059669" },
  service: { bg: "rgba(245, 158, 11, 0.15)", border: "#f59e0b", text: "#d97706" },
  location: { bg: "rgba(236, 72, 153, 0.15)", border: "#ec4899", text: "#db2777" },
  person: { bg: "rgba(139, 92, 246, 0.15)", border: "#8b5cf6", text: "#7c3aed" },
  topic: { bg: "rgba(14, 165, 233, 0.15)", border: "#0ea5e9", text: "#0284c7" },
  industry: { bg: "rgba(100, 116, 139, 0.15)", border: "#64748b", text: "#475569" },
};

export default function EntityGraphVisual({
  entities = [],
  relationships = [],
  onSelectEntity = null,
}) {
  const [activeEntityId, setActiveEntityId] = useState(null);

  // Compute 2D node layout positions
  const { nodePositions, width, height } = useMemo(() => {
    const w = 820;
    const h = 420;
    const cx = w / 2;
    const cy = h / 2;
    const count = entities.length;
    const pos = {};

    if (count === 1) {
      pos[entities[0].id] = { x: cx, y: cy };
    } else if (count > 1) {
      const radius = Math.min(cx - 90, cy - 60);
      entities.forEach((ent, i) => {
        // Place organization / brand in center or top if present
        const angle = (2 * Math.PI * i) / count - Math.PI / 2;
        pos[ent.id] = {
          x: Math.round(cx + radius * Math.cos(angle)),
          y: Math.round(cy + radius * 0.82 * Math.sin(angle)),
        };
      });
    }

    return { nodePositions: pos, width: w, height: h };
  }, [entities]);

  const activeRelationships = useMemo(() => {
    if (!activeEntityId) return relationships;
    return relationships.filter(
      (r) => r.subject_id === activeEntityId || r.object_id === activeEntityId,
    );
  }, [relationships, activeEntityId]);

  if (entities.length === 0) {
    return (
      <div
        className="dsc-panel"
        style={{
          padding: "2rem",
          textAlign: "center",
          background: "var(--surface)",
          border: "1px dashed var(--border)",
          borderRadius: "var(--r-lg)",
        }}
      >
        <Icon name="share-2" size={32} style={{ color: "var(--text-sub)", margin: "0 auto 0.75rem" }} />
        <h4 style={{ fontWeight: 600, fontSize: "1rem", margin: "0 0 0.25rem" }}>Knowledge Graph Canvas</h4>
        <p style={{ color: "var(--text-sub)", fontSize: "0.875rem", maxWidth: "540px", margin: "0 auto" }}>
          Map your business entities (Brand, Products, Services, Locations) and link them with verified relationships
          to guide search engines and AI knowledge graphs.
        </p>
      </div>
    );
  }

  const approvedEntitiesCount = entities.filter((e) => e.state === "approved").length;
  const approvedRelsCount = relationships.filter((r) => r.state === "approved").length;

  return (
    <div
      className="dsc-panel dsc-graph-visual-card"
      style={{
        padding: "1.25rem",
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--r-lg)",
        position: "relative",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem", flexWrap: "wrap", gap: "0.5rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <Icon name="share-2" size={18} style={{ color: "var(--accent)" }} />
          <strong style={{ fontSize: "0.9375rem" }}>Visual Entity & Relationship Topology</strong>
        </div>
        <div style={{ display: "flex", gap: "0.75rem", fontSize: "0.8125rem", color: "var(--text-sub)" }}>
          <span>
            Entities: <strong>{entities.length}</strong> ({approvedEntitiesCount} approved)
          </span>
          <span>•</span>
          <span>
            Relationships: <strong>{relationships.length}</strong> ({approvedRelsCount} approved)
          </span>
        </div>
      </div>

      <div style={{ width: "100%", overflowX: "auto", background: "var(--bg)", borderRadius: "var(--r)", border: "1px solid var(--border)" }}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          style={{ width: "100%", height: "auto", minHeight: "360px", maxHeight: "460px", display: "block" }}
        >
          <defs>
            <marker
              id="arrow-head"
              viewBox="0 0 10 10"
              refX="16"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 10 5 L 0 9 z" fill="var(--text-sub)" opacity="0.8" />
            </marker>
            <marker
              id="arrow-head-active"
              viewBox="0 0 10 10"
              refX="16"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 10 5 L 0 9 z" fill="var(--accent)" />
            </marker>
          </defs>

          {/* Relationship Edges */}
          {relationships.map((rel) => {
            const from = nodePositions[rel.subject_id];
            const to = nodePositions[rel.object_id];
            if (!from || !to) return null;

            const isHighlighted =
              !activeEntityId ||
              rel.subject_id === activeEntityId ||
              rel.object_id === activeEntityId;
            const midX = (from.x + to.x) / 2;
            const midY = (from.y + to.y) / 2;
            const predLabel = PREDICATES[rel.predicate]?.label || rel.predicate;

            return (
              <g key={rel.id} opacity={isHighlighted ? 1 : 0.25} style={{ transition: "opacity 0.2s" }}>
                <line
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  stroke={rel.state === "approved" ? "var(--accent)" : "var(--border)"}
                  strokeWidth={isHighlighted && activeEntityId ? 2.5 : 1.5}
                  strokeDasharray={rel.state === "approved" ? "none" : "4 3"}
                  markerEnd={isHighlighted && activeEntityId ? "url(#arrow-head-active)" : "url(#arrow-head)"}
                />
                <rect
                  x={midX - 35}
                  y={midY - 10}
                  width="70"
                  height="18"
                  rx="4"
                  fill="var(--surface)"
                  stroke="var(--border)"
                  strokeWidth="1"
                />
                <text
                  x={midX}
                  y={midY + 3}
                  textAnchor="middle"
                  fontSize="9.5"
                  fill="var(--text-sub)"
                  fontWeight="500"
                >
                  {predLabel}
                </text>
              </g>
            );
          })}

          {/* Entity Nodes */}
          {entities.map((ent) => {
            const pos = nodePositions[ent.id];
            if (!pos) return null;
            const isSelected = activeEntityId === ent.id;
            const styleConf = TYPE_COLORS[ent.entity_type] || TYPE_COLORS.topic;
            const isApproved = ent.state === "approved";

            return (
              <g
                key={ent.id}
                transform={`translate(${pos.x}, ${pos.y})`}
                onClick={() => {
                  const nextId = isSelected ? null : ent.id;
                  setActiveEntityId(nextId);
                  if (onSelectEntity) onSelectEntity(nextId);
                }}
                style={{ cursor: "pointer" }}
              >
                {/* Outer halo if selected */}
                {isSelected && (
                  <circle r="44" fill="none" stroke="var(--accent)" strokeWidth="2" strokeDasharray="3 3" />
                )}

                {/* Node circle */}
                <circle
                  r="34"
                  fill={styleConf.bg}
                  stroke={isSelected ? "var(--accent)" : styleConf.border}
                  strokeWidth={isSelected ? "2.5" : "1.75"}
                />

                {/* Status indicator dot */}
                <circle
                  cx="24"
                  cy="-24"
                  r="6"
                  fill={isApproved ? "#10b981" : "#f59e0b"}
                  stroke="var(--surface)"
                  strokeWidth="1.5"
                />

                {/* Entity Name */}
                <text
                  textAnchor="middle"
                  y="2"
                  fontSize="10"
                  fontWeight="600"
                  fill="var(--text)"
                  style={{ pointerEvents: "none", userSelect: "none" }}
                >
                  {ent.name.length > 13 ? `${ent.name.slice(0, 12)}…` : ent.name}
                </text>

                {/* Entity Type Label */}
                <text
                  textAnchor="middle"
                  y="15"
                  fontSize="8"
                  fill={styleConf.text}
                  fontWeight="500"
                  style={{ pointerEvents: "none", userSelect: "none", textTransform: "uppercase" }}
                >
                  {ENTITY_TYPES[ent.entity_type]?.label || ent.entity_type}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <div style={{ marginTop: "0.75rem", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.75rem", color: "var(--text-sub)", flexWrap: "wrap", gap: "0.5rem" }}>
        <span>Click any entity node to highlight its connected relationships.</span>
        <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
          <span style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
            <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#10b981", display: "inline-block" }} />
            Approved
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
            <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#f59e0b", display: "inline-block" }} />
            Proposed
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
            <span style={{ width: "16px", height: "2px", borderTop: "2px dashed var(--border)", display: "inline-block" }} />
            Pending edge
          </span>
        </div>
      </div>
    </div>
  );
}
