import { AuthModal } from "datiq";

// AuthModal takes NO props at all — it is entirely context-driven, reading
// `authMode` from useAuth() (AuthProvider) only to pick its INITIAL tab
// ("signup" vs the default "signin") via a plain useState initializer.
// AuthProvider's own default is authMode="signin", and there is no prop or
// URL hook on AuthModal itself to override that from outside — the sign-up
// tab, the forgot-password view, and the post-signup persona step are all
// reachable only via clicks on the mounted sign-in form (switchTab /
// handleEmail success), which this mount-only capture harness cannot drive.
// So the sign-in view is the only state reachable from a fresh render, and
// it happens to be the one 99% of real opens land on (every "Sign in" /
// "Sign up" button in TopBar opens straight to this screen). One honest
// story.
export function SignIn() {
  return <AuthModal />;
}
