import { PlanChangeWarning } from "datiq";

// Plan objects mirror src/lib/pricingConfig.js exactly (id + name + limits) —
// describePlanChange() (called inside the component) derives its loss/gain
// list purely from `.limits`, and isDowngrade()/isUpgrade() rank by `.id`
// against a fixed table (free < go < select < pro/developer < business < agency).

const FREE = {
  id: "free",
  name: "Free",
  limits: {
    extractions: 10,
    batch_max_urls: 5,
    scheduled_monitoring: 0,
    team_seats: 1,
    workspaces: 1,
    exports: ["csv"],
    email_export: false,
    api_access: false,
    white_label_pdf: false,
    priority_support: false,
  },
};

const SELECT = {
  id: "select",
  name: "Select",
  limits: {
    extractions: 500,
    batch_max_urls: 50,
    scheduled_monitoring: 0,
    team_seats: 1,
    workspaces: 1,
    exports: ["csv", "pdf", "markdown"],
    email_export: true,
    api_access: false,
    white_label_pdf: false,
    priority_support: false,
  },
};

const PRO = {
  id: "pro",
  name: "Pro",
  limits: {
    extractions: 1000,
    batch_max_urls: 100,
    scheduled_monitoring: 1,
    team_seats: 1,
    workspaces: 1,
    exports: ["csv", "pdf", "markdown", "json"],
    email_export: true,
    api_access: false,
    white_label_pdf: false,
    priority_support: false,
  },
};

const BUSINESS = {
  id: "business",
  name: "Business",
  limits: {
    extractions: 10000,
    batch_max_urls: 250,
    scheduled_monitoring: 5,
    team_seats: 3,
    workspaces: 1,
    exports: ["csv", "pdf", "markdown", "json"],
    email_export: true,
    api_access: true,
    white_label_pdf: true,
    priority_support: true,
  },
};

const AGENCY = {
  id: "agency",
  name: "Agency",
  limits: {
    extractions: Infinity,
    batch_max_urls: 500,
    scheduled_monitoring: Infinity,
    team_seats: 5,
    workspaces: 5,
    exports: ["csv", "pdf", "markdown", "json"],
    email_export: true,
    api_access: true,
    white_label_pdf: true,
    priority_support: true,
  },
};

export function DowngradeBusinessToSelect() {
  return (
    <PlanChangeWarning
      fromPlan={BUSINESS}
      toPlan={SELECT}
      periodEnd={new Date(Date.now() + 18 * 24 * 3600_000).toISOString()}
      onConfirm={() => {}}
      onCancel={() => {}}
    />
  );
}

export function UpgradeSelectToPro() {
  return (
    <PlanChangeWarning
      fromPlan={SELECT}
      toPlan={PRO}
      periodEnd={null}
      onConfirm={() => {}}
      onCancel={() => {}}
    />
  );
}

export function DowngradeAgencyToFreeLongLossList() {
  return (
    <PlanChangeWarning
      fromPlan={AGENCY}
      toPlan={FREE}
      periodEnd={new Date(Date.now() + 26 * 24 * 3600_000).toISOString()}
      onConfirm={() => {}}
      onCancel={() => {}}
    />
  );
}

export function UpgradeFreeToBusiness() {
  return (
    <PlanChangeWarning
      fromPlan={FREE}
      toPlan={BUSINESS}
      periodEnd={null}
      onConfirm={() => {}}
      onCancel={() => {}}
    />
  );
}
