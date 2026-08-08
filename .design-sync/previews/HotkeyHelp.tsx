import { HotkeyHelp } from "datiq";

export function Default() {
  // The wrapping div gives the story root real in-flow height so the
  // modal's `position: fixed; inset: 0` backdrop centers against the full
  // frame instead of collapsing to a point (see the wave learnings note).
  return (
    <div style={{ minHeight: 680 }}>
      <HotkeyHelp open={true} onClose={() => {}} />
    </div>
  );
}
