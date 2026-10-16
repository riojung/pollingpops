"use client";

import { useState } from "react";
import type { ProductFeatureDefinition, ProductFeatureRules } from "@openround/contracts";

type Plan = "free" | "pro" | "team";
type Rules = ProductFeatureRules;
type Feature = ProductFeatureDefinition;
type Policy = { revision: number; features: Rules; updatedAt: string | null };
export type FeaturePolicyData = { policy: Policy; catalog: readonly Feature[] };
const plans: Plan[] = ["free", "pro", "team"];
const planLabel = (plan: Plan) => plan.charAt(0).toUpperCase() + plan.slice(1);

export default function FeaturesPanel({
  data,
  writable,
  busy,
  onReview,
}: {
  data: FeaturePolicyData;
  writable: boolean;
  busy: boolean;
  onReview: (payload: Record<string, unknown>) => void;
}) {
  const { policy, catalog } = data;
  const [draft, setDraft] = useState<Rules>(() => structuredClone(policy.features));
  const [tab, setTab] = useState<"features" | "plans">(() =>
    typeof window !== "undefined" &&
    new URL(window.location.href).searchParams.get("tab") === "plans"
      ? "plans"
      : "features",
  );
  const [filter, setFilter] = useState("");
  const dirty = catalog.some((feature) => {
    const before = policy.features[feature.key];
    const after = draft[feature.key];
    return (
      before?.enabled !== after?.enabled ||
      plans.some(
        (plan) => Boolean(before?.plans.includes(plan)) !== Boolean(after?.plans.includes(plan)),
      )
    );
  });
  const enabledCount = catalog.filter((feature) => draft[feature.key]?.enabled === true).length;
  const inheritedCount = catalog.filter((feature) => !draft[feature.key]).length;
  const labels = new Map(catalog.map((feature) => [feature.key, feature.label]));
  const visibleFeatures = catalog.filter((feature) =>
    `${feature.label} ${feature.description} ${feature.category}`
      .toLowerCase()
      .includes(filter.toLowerCase()),
  );
  function selectTab(selected: "features" | "plans") {
    setTab(selected);
    const url = new URL(window.location.href);
    if (selected === "plans") url.searchParams.set("tab", "plans");
    else url.searchParams.delete("tab");
    window.history.replaceState(null, "", url);
  }
  function dependencyIssues(feature: Feature): string[] {
    const rule = draft[feature.key];
    if (!rule?.enabled || rule.plans.length === 0) return [];
    return feature.dependencies
      .filter((key) => {
        const dependency = draft[key];
        return (
          dependency &&
          (!dependency.enabled || rule.plans.some((plan) => !dependency.plans.includes(plan)))
        );
      })
      .map((key) => labels.get(key) ?? key);
  }

  function setMode(feature: Feature, mode: string) {
    setDraft((current) => {
      const next = { ...current };
      if (mode === "inherit") delete next[feature.key];
      else
        next[feature.key] = {
          enabled: mode === "enabled",
          plans: current[feature.key]?.plans ?? [...feature.defaultPlans],
        };
      return next;
    });
  }

  function setPlan(feature: Feature, plan: Plan, checked: boolean) {
    setDraft((current) => {
      const previous = current[feature.key];
      if (!previous) return current;
      return {
        ...current,
        [feature.key]: {
          ...previous,
          plans: plans.filter((item) => (item === plan ? checked : previous.plans.includes(item))),
        },
      };
    });
  }

  const modeControl = (feature: Feature) => {
    const rule = draft[feature.key];
    const mode = rule ? (rule.enabled ? "enabled" : "disabled") : "inherit";
    return writable ? (
      <select
        aria-label={`Availability for ${feature.label}`}
        value={mode}
        disabled={busy}
        onChange={(event) => setMode(feature, event.target.value)}
      >
        <option value="inherit">Inherit deployment</option>
        <option value="enabled">Enabled</option>
        <option value="disabled">Disabled</option>
      </select>
    ) : (
      <span className={`status-pill ${mode === "enabled" ? "positive" : ""}`}>
        {mode === "inherit" ? "Inherit deployment" : mode === "enabled" ? "Enabled" : "Disabled"}
      </span>
    );
  };

  const planControl = (feature: Feature, plan: Plan) => {
    const rule = draft[feature.key];
    const checked = rule?.plans.includes(plan) ?? false;
    return (
      <label className="plan-check" key={plan}>
        <input
          type="checkbox"
          checked={checked}
          disabled={!writable || !rule || busy}
          onChange={(event) => setPlan(feature, plan, event.target.checked)}
          aria-label={`${planLabel(plan)} plan includes ${feature.label}`}
        />
        {tab === "features" && <span>{planLabel(plan)}</span>}
      </label>
    );
  };

  return (
    <>
      <div className="stat-grid feature-stats">
        <div className="stat-card">
          <span>Implemented features</span>
          <strong>{catalog.length}</strong>
          <small>Implemented product capabilities</small>
        </div>
        <div className="stat-card">
          <span>{dirty ? "Explicitly enabled in draft" : "Explicitly enabled"}</span>
          <strong>{enabledCount}</strong>
          <small>{dirty ? "Unsaved plan assignments" : "Assigned through operator policy"}</small>
        </div>
        <div className="stat-card">
          <span>{dirty ? "Deployment defaults in draft" : "Using deployment defaults"}</span>
          <strong>{inheritedCount}</strong>
          <small>
            {dirty ? "Unsaved availability choices" : "Environment and workspace configuration"}
          </small>
        </div>
        <div className="stat-card">
          <span>Policy revision</span>
          <strong>{policy.revision}</strong>
          <small>
            {policy.updatedAt
              ? `Updated ${new Date(policy.updatedAt).toLocaleDateString()}`
              : "No policy changes yet"}
          </small>
        </div>
      </div>
      <section className="feature-policy">
        <div className="section-heading">
          <div>
            <h2>Product availability</h2>
            <p>One policy for feature access and plan assignments.</p>
          </div>
          <span className="badge">Revision {policy.revision}</span>
        </div>
        {policy.revision === 0 && Object.keys(policy.features).length === 0 && (
          <p className="notice">
            No feature overrides have been saved. Features use deployment defaults, which may leave
            them disabled.
          </p>
        )}
        <p className="note policy-explanation">
          Inherit uses deployment flags and workspace allowlists; it does not mean a feature is
          available. Choose Enabled to assign plans. An explicit enabled or disabled setting
          overrides that feature’s deployment flag and workspace allowlist. Dependencies and
          required provider configuration still apply.
        </p>
        <p className="note policy-explanation">
          Community mode uses Team assignments. Event-credit rooms use Pro; retained funded rooms
          keep their launch grants.
        </p>
        <div className="feature-toolbar">
          <div className="segmented" role="group" aria-label="Feature management view">
            <button
              type="button"
              aria-pressed={tab === "features"}
              onClick={() => selectTab("features")}
            >
              Features
            </button>
            <button type="button" aria-pressed={tab === "plans"} onClick={() => selectTab("plans")}>
              Plans
            </button>
          </div>
          <label className="feature-search">
            <span className="sr-only">Search features</span>
            <input
              type="search"
              placeholder="Search features…"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
          </label>
        </div>
        {tab === "plans" && (
          <p className="note">
            Choose the plans that include each explicitly managed feature. Inherited rows are
            deployment controlled and have no plan assignments in this policy.
          </p>
        )}
        <p className="table-scroll-hint" id="feature-table-scroll-hint">
          <span aria-hidden="true">↔</span> Scroll horizontally to see availability and plans.
        </p>
        <div
          className="table-scroll feature-table-scroll"
          role="region"
          aria-label="Feature availability and plan assignments"
          aria-describedby="feature-table-scroll-hint"
          tabIndex={0}
        >
          <table className="feature-table">
            <thead>
              <tr>
                <th>Feature</th>
                <th>Availability</th>
                {tab === "features" ? (
                  <th>Included in plans</th>
                ) : (
                  plans.map((plan) => (
                    <th className="plan-column" key={plan}>
                      {planLabel(plan)}
                    </th>
                  ))
                )}
              </tr>
            </thead>
            <tbody>
              {visibleFeatures.map((feature) => (
                <tr key={feature.key}>
                  <td className="feature-description">
                    <span className="feature-category">{feature.category}</span>
                    <strong>{feature.label}</strong>
                    <p>{feature.description}</p>
                    {feature.dependencies.length > 0 && (
                      <small>
                        Requires{" "}
                        {feature.dependencies.map((key) => labels.get(key) ?? key).join(", ")}
                      </small>
                    )}
                    {dependencyIssues(feature).length > 0 && (
                      <small className="dependency-warning">
                        Dependency policy excludes selected plans:{" "}
                        {dependencyIssues(feature).join(", ")}.
                      </small>
                    )}
                    {draft[feature.key]?.enabled && draft[feature.key]?.plans.length === 0 && (
                      <small className="dependency-warning">
                        Choose at least one plan to make this feature available.
                      </small>
                    )}
                  </td>
                  <td className="feature-mode">
                    {modeControl(feature)}
                    {!draft[feature.key] && (
                      <small className="field-hint">Deployment defaults</small>
                    )}
                  </td>
                  {!draft[feature.key] ? (
                    <td colSpan={tab === "plans" ? plans.length : 1}>
                      <span>Deployment controlled</span>
                      <small className="field-hint">
                        {writable
                          ? "Choose Enabled to assign plans."
                          : "Plans follow deployment settings."}
                      </small>
                    </td>
                  ) : tab === "features" ? (
                    <td>
                      <div className="plan-checks">
                        {plans.map((plan) => planControl(feature, plan))}
                      </div>
                    </td>
                  ) : (
                    plans.map((plan) => (
                      <td className="plan-column" key={plan}>
                        {planControl(feature, plan)}
                      </td>
                    ))
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {visibleFeatures.length === 0 && <p className="empty">No features match this search.</p>}
        <div className="policy-footer">
          <div>
            <strong>{dirty ? "You have unsaved changes" : "Policy is up to date"}</strong>
            <p>
              {writable
                ? "Changes require a reason and are recorded in the audit timeline."
                : "Your operator role can review this policy."}
            </p>
          </div>
          {writable && (
            <div className="actions">
              <button
                type="button"
                disabled={!dirty || busy}
                onClick={() => setDraft(structuredClone(policy.features))}
              >
                Discard changes
              </button>
              <button
                type="button"
                className="primary"
                disabled={!dirty || busy}
                onClick={() =>
                  onReview({
                    action: "features.update",
                    expectedRevision: policy.revision,
                    features: draft,
                  })
                }
              >
                Review changes
              </button>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
