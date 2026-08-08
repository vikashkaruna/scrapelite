import { Button } from "datiq";

export function Variants() {
  return (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
      <Button variant="primary">Extract page</Button>
      <Button variant="secondary">Cancel</Button>
      <Button variant="ghost">Skip</Button>
      <Button variant="danger">Delete extraction</Button>
    </div>
  );
}

export function WithIcons() {
  return (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
      <Button variant="primary" icon="arrow-up">
        Run now
      </Button>
      <Button variant="secondary" iconRight="chevron-down">
        Export
      </Button>
      <Button variant="ghost" icon="trash" />
    </div>
  );
}

export function Sizes() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      <Button variant="primary">Default size</Button>
      <Button variant="primary" size="sm">
        Small
      </Button>
    </div>
  );
}

export function FullWidth() {
  return (
    <div style={{ maxWidth: 320 }}>
      <Button variant="primary" fullWidth>
        Continue with Google
      </Button>
    </div>
  );
}

export function Disabled() {
  return (
    <div style={{ display: "flex", gap: 12 }}>
      <Button variant="primary" disabled>
        Processing…
      </Button>
      <Button variant="secondary" disabled>
        Unavailable
      </Button>
    </div>
  );
}
