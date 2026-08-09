// Hand-authored bundle entry for design-sync.
//
// DatIQ's components are all `export default function Name(...)` (plain JSX,
// no TypeScript, no library build). `export * from '<file>'` — what the
// design-sync converter auto-synthesizes when no dist/ exists — does NOT
// re-export default exports, so every component would come through as
// `undefined` on window.DatIQ. This file re-exports each one under its real
// name instead. Re-generate by re-listing src/components/*.jsx if components
// are added/removed/renamed (see .design-sync/NOTES.md).

// ── Design-system components (get a browsable card via componentSrcMap) ──
export { default as AuthModal } from "../src/components/AuthModal.jsx";
export { default as BrandLoader } from "../src/components/BrandLoader.jsx";
export { default as BulkUploadModal } from "../src/components/BulkUploadModal.jsx";
export { default as Button } from "../src/components/Button.jsx";
export { default as CollectionPicker } from "../src/components/CollectionPicker.jsx";
export { default as CommandPalette } from "../src/components/CommandPalette.jsx";
export { default as ContentModal } from "../src/components/ContentModal.jsx";
export { default as CreditEstimator } from "../src/components/CreditEstimator.jsx";
export { default as DemoPaymentModal } from "../src/components/DemoPaymentModal.jsx";
export { default as EmailModal } from "../src/components/EmailModal.jsx";
export { ErrorModalProvider, useErrorModal } from "../src/components/ErrorModal.jsx";
export { default as ExportIntegrations } from "../src/components/ExportIntegrations.jsx";
export { default as ExtractSimilarCard } from "../src/components/ExtractSimilarCard.jsx";
export { default as ExtractionCharts } from "../src/components/ExtractionCharts.jsx";
export { default as ExtractionProgressDock } from "../src/components/ExtractionProgressDock.jsx";
export { default as FaviconDot } from "../src/components/FaviconDot.jsx";
export { default as FeedbackWidget } from "../src/components/FeedbackWidget.jsx";
export { default as Footer } from "../src/components/Footer.jsx";
export { default as GuestTrialBanner } from "../src/components/GuestTrialBanner.jsx";
export { default as GuestTrialModal } from "../src/components/GuestTrialModal.jsx";
export { default as HeroComposer } from "../src/components/HeroComposer.jsx";
export { default as HotkeyHelp } from "../src/components/HotkeyHelp.jsx";
export { default as Icon } from "../src/components/Icon.jsx";
export { default as InvoiceModal } from "../src/components/InvoiceModal.jsx";
export { default as NotifyMeModal } from "../src/components/NotifyMeModal.jsx";
export { default as OnboardingTour } from "../src/components/OnboardingTour.jsx";
export { default as OutcomeTiles } from "../src/components/OutcomeTiles.jsx";
export { default as PaymentConfirmModal } from "../src/components/PaymentConfirmModal.jsx";
export { default as PaymentProcessingModal } from "../src/components/PaymentProcessingModal.jsx";
export { default as PlanChangeWarning } from "../src/components/PlanChangeWarning.jsx";
export { default as PricingMatrix } from "../src/components/PricingMatrix.jsx";
export { default as ProvenanceBadge, ProvenanceSummary } from "../src/components/ProvenanceBadge.jsx";
export { default as RecentExtractions } from "../src/components/RecentExtractions.jsx";
export { default as ReferralBanner } from "../src/components/ReferralBanner.jsx";
export { default as ScheduleEditor } from "../src/components/ScheduleEditor.jsx";
export { default as StructuredData } from "../src/components/StructuredData.jsx";
export { default as SuspendedBanner } from "../src/components/SuspendedBanner.jsx";
export { default as TagChips } from "../src/components/TagChips.jsx";
export { default as TemplateGallery } from "../src/components/TemplateGallery.jsx";
export { ToastProvider, useToast } from "../src/components/Toast.jsx";
export { default as Toggle } from "../src/components/Toggle.jsx";
export { default as TopBar } from "../src/components/TopBar.jsx";
export { default as TopupBundleModal } from "../src/components/TopupBundleModal.jsx";
export { default as TrustStrip } from "../src/components/TrustStrip.jsx";
export { default as TryExampleDemo } from "../src/components/TryExampleDemo.jsx";
export { default as UrlReviewTable } from "../src/components/UrlReviewTable.jsx";
export { default as UsageUpsellBanner } from "../src/components/UsageUpsellBanner.jsx";
export { default as WatchlistCard } from "../src/components/WatchlistCard.jsx";
export { default as WhiteLabelTemplateUploader } from "../src/components/WhiteLabelTemplateUploader.jsx";

// ── App-state providers (bundle-only — needed for cfg.provider's context
// chain so the components above don't crash on useAuth()/useBilling()/etc.
// Never given a componentSrcMap entry, so they never get their own card —
// nobody composes a design by rendering a bare provider. ──
export { AuthProvider } from "../src/components/AuthProvider.jsx";
export { BillingProvider } from "../src/components/BillingProvider.jsx";
export { ExtractionProvider } from "../src/components/ExtractionProvider.jsx";
export { PersonaProvider } from "../src/components/PersonaProvider.jsx";
export { ThemeProvider } from "../src/components/ThemeProvider.jsx";
export { GuestTrialProvider } from "../src/components/GuestTrialProvider.jsx";
