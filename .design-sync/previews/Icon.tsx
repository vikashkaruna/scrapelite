import { Icon } from "datiq";

const NAMES = [
  "bookmark", "layers", "search", "download", "trash", "check",
  "alert-triangle", "globe", "calendar-clock", "indian-rupee",
];

export function Sizes() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
      <Icon name="bookmark" size={14} />
      <Icon name="bookmark" size={20} />
      <Icon name="bookmark" size={28} />
      <Icon name="bookmark" size={40} />
    </div>
  );
}

export function Gallery() {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(5, 1fr)",
        gap: 20,
      }}
    >
      {NAMES.map((n) => (
        <div
          key={n}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 6,
            color: "var(--text-2)",
            fontSize: 11,
          }}
        >
          <Icon name={n} size={22} />
          <span>{n}</span>
        </div>
      ))}
    </div>
  );
}

export function StrokeWeights() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
      <Icon name="alert-triangle" size={28} strokeWidth={1.5} />
      <Icon name="alert-triangle" size={28} strokeWidth={2} />
      <Icon name="alert-triangle" size={28} strokeWidth={2.5} />
    </div>
  );
}

export function UnknownFallback() {
  // Any name not in the map falls back to a plain circle — sweeping one
  // here documents that fallback behavior rather than hiding it.
  return <Icon name="not-a-real-icon-name" size={24} />;
}
