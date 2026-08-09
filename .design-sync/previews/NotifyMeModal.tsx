import { NotifyMeModal } from "datiq";

// The wrapping div gives the story root real in-flow height so the modal's
// `position: fixed; inset: 0` overlay centers against the full frame
// instead of collapsing to a point (see the wave learnings note).
export function Airtable() {
  return (
    <div style={{ minHeight: 680 }}>
      <NotifyMeModal slug="airtable" label="Airtable" open={true} onClose={() => {}} />
    </div>
  );
}

export function Notion() {
  return (
    <div style={{ minHeight: 680 }}>
      <NotifyMeModal slug="notion" label="Notion" open={true} onClose={() => {}} />
    </div>
  );
}
