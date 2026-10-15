export type ConsoleView =
  | "overview"
  | "organizations"
  | "features"
  | "operations"
  | "billing"
  | "staff"
  | "credits"
  | "support"
  | "integrations"
  | "audit";

export const consoleViews: ConsoleView[] = [
  "overview",
  "organizations",
  "features",
  "operations",
  "billing",
  "staff",
  "credits",
  "support",
  "integrations",
  "audit",
];

export function viewCapability(view: ConsoleView): string {
  if (view === "overview") return "operations.read";
  if (view === "staff") return "operators.write";
  return `${view}.read`;
}

export function apiView(view: ConsoleView): string {
  return view === "overview" || view === "staff" ? "operations" : view;
}

export function allowedViews(capabilities: string[]): ConsoleView[] {
  return consoleViews.filter(
    (view) =>
      capabilities.includes(viewCapability(view)) &&
      (view !== "staff" || capabilities.includes("operations.read")),
  );
}

export function initialView(
  capabilities: string[],
  requested?: ConsoleView,
): ConsoleView | undefined {
  const allowed = allowedViews(capabilities);
  if (requested && allowed.includes(requested)) return requested;
  if (!requested && allowed.includes("overview")) return "overview";
  // Keep existing restricted-link behavior predictable for support and read-only staff.
  return allowed.find((view) => view !== "overview") ?? allowed[0];
}

export const viewDetails: Record<ConsoleView, { title: string; description: string }> = {
  overview: {
    title: "Overview",
    description: "Monitor services and keep daily operations running smoothly.",
  },
  organizations: {
    title: "Organizations",
    description: "Manage organizations, workspaces, and access to new work.",
  },
  features: {
    title: "Features",
    description: "Control product availability and choose which plans include each feature.",
  },
  operations: {
    title: "Operations",
    description: "Inspect active rooms, queue health, and worker activity.",
  },
  billing: {
    title: "Billing",
    description: "Review subscriptions, commercial holds, and billing events.",
  },
  staff: {
    title: "Staff",
    description: "Manage operator access and review the people running Polling Pops.",
  },
  credits: {
    title: "Credits",
    description: "Review balances, grant event credits, and manage promotions.",
  },
  support: {
    title: "Support",
    description: "Review feedback and manage private, redacted support cases.",
  },
  integrations: {
    title: "Integrations",
    description: "Manage approved connections and reconcile provider records.",
  },
  audit: { title: "Audit", description: "Trace operational changes and the reasons behind them." },
};
