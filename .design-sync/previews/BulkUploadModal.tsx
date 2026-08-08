import { BulkUploadModal } from "datiq";

// BulkUploadModal's only props are open/onClose/onUrls — the paste-vs-CSV
// tab and the textarea content are internal state (useState "paste" / "")
// with no prop to seed them, so every fresh mount lands on the same "Paste
// URLs" tab with an empty textarea regardless of props. That's the one
// state reachable here, and it's also genuinely the modal's real starting
// point every time a user opens it via the Home FAB — one honest story.
//
// Now that the modal shell is properly styled (real position:fixed overlay
// — see NOTES.md), it hits the same capture-harness trap as every other
// fixed-position modal in this project: `.ds-single{transform:translateZ(0)}`
// becomes the containing block for the overlay's `inset:0`, collapsing it
// and cropping the top of the card off-frame. Neutralized the same way.
function ResetCaptureTransform() {
  return <style>{".ds-single{transform:none!important}"}</style>;
}

export function Default() {
  return (
    <>
      <ResetCaptureTransform />
      <BulkUploadModal open={true} onClose={() => {}} onUrls={() => {}} />
    </>
  );
}
