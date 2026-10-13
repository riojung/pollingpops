"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

type View =
  "organizations" | "billing" | "credits" | "operations" | "support" | "integrations" | "audit";
type Row = Record<string, unknown>;
type Identity = { id: string; name: string; role: string; capabilities: string[] };
const views: View[] = [
  "organizations",
  "billing",
  "credits",
  "operations",
  "support",
  "integrations",
  "audit",
];
const returnViewKey = "pollingpops-operator-return-view";
const knownView = (value: string | null): View | undefined => views.find((item) => item === value);
function updateViewUrl(selected: View, replace = false) {
  const url = new URL(window.location.href);
  url.searchParams.set("view", selected);
  window.history[replace ? "replaceState" : "pushState"](null, "", url);
}
function rememberLoginView() {
  const selected = knownView(new URL(window.location.href).searchParams.get("view"));
  try {
    if (selected) window.sessionStorage.setItem(returnViewKey, selected);
  } catch {
    // Login still works when browser storage is unavailable.
  }
}
const label = (value: string) =>
  value
    .replaceAll("-", " ")
    .replaceAll("_", " ")
    .replace(/^./, (letter) => letter.toUpperCase());
const record = (value: unknown): Row =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Row) : {};
const rows = (value: unknown): Row[] => (Array.isArray(value) ? value.map(record) : []);
const text = (value: unknown) =>
  value === null || value === undefined
    ? "—"
    : typeof value === "object"
      ? JSON.stringify(value)
      : String(value);
function Table({ items, columns }: { items: Row[]; columns: string[] }) {
  if (!items.length) return <p className="empty">No records yet.</p>;
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{label(column)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => (
            <tr key={String(item.id ?? index)}>
              {columns.map((column) => (
                <td key={column}>{text(item[column])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export default function ControlRoom({
  enabled,
  localAdmin = false,
}: {
  enabled: boolean;
  localAdmin?: boolean;
}) {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [csrf, setCsrf] = useState("");
  const [view, setView] = useState<View>("organizations");
  const [data, setData] = useState<Row>({});
  const [organizations, setOrganizations] = useState<Row[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [contacts, setContacts] = useState<Row[]>([]);
  const exactCommand = useRef<{ body: string; key: string } | null>(null);
  const loadSequence = useRef(0);
  const can = (capability: string) => Boolean(identity?.capabilities.includes(capability));
  const clearAccess = useCallback(() => {
    loadSequence.current += 1;
    setIdentity(null);
    setCsrf("");
    setData({});
    setOrganizations([]);
    setContacts([]);
    setPending(null);
    setLoading(false);
    exactCommand.current = null;
  }, []);
  const refresh = useCallback(
    async (selected: View, primeOrganizations = false) => {
      const sequence = ++loadSequence.current;
      setLoading(true);
      setData({});
      try {
        const responses = await Promise.all([
          fetch(`/api/views/${selected}`, { cache: "no-store" }),
          ...(primeOrganizations ? [fetch("/api/views/organizations", { cache: "no-store" })] : []),
        ]);
        const bodies = await Promise.all(
          responses.map(async (response) => record(await response.json())),
        );
        if (sequence !== loadSequence.current) return;
        for (const [index, response] of responses.entries()) {
          if (!response.ok) {
            if (response.status === 401 || response.status === 403) clearAccess();
            throw new Error(text(record(bodies[index]?.error).message));
          }
        }
        setData(bodies[0]!);
        if (selected === "organizations") setOrganizations(rows(bodies[0]!.organizations));
        else if (primeOrganizations) setOrganizations(rows(bodies[1]!.organizations));
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Unable to load the view");
      } finally {
        if (sequence === loadSequence.current) setLoading(false);
      }
    },
    [clearAccess],
  );
  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    let current = true;
    void fetch("/api/me", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) {
          if (response.status === 401) return;
          throw new Error("Operator service is temporarily unavailable");
        }
        const body = (await response.json()) as { operator: Identity; csrfToken: string };
        if (!current) return;
        setIdentity(body.operator);
        setCsrf(body.csrfToken ?? "");
        const allowed = views.filter((item) => body.operator.capabilities.includes(`${item}.read`));
        let requested = knownView(new URL(window.location.href).searchParams.get("view"));
        try {
          requested ??= knownView(window.sessionStorage.getItem(returnViewKey));
          window.sessionStorage.removeItem(returnViewKey);
        } catch {
          // URL links and ordinary login do not depend on browser storage.
        }
        const selected = requested && allowed.includes(requested) ? requested : allowed[0];
        if (!selected) {
          clearAccess();
          setMessage("This operator has no permitted console areas");
          return;
        }
        setView(selected);
        updateViewUrl(selected, true);
        await refresh(selected, selected !== "organizations" && allowed.includes("organizations"));
      })
      .catch(() => {
        if (current) setMessage("Operator service is temporarily unavailable");
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [enabled, refresh, clearAccess]);
  useEffect(() => {
    if (!identity) return;
    const handleHistory = () => {
      const allowed = views.filter((item) => identity.capabilities.includes(`${item}.read`));
      const requested = knownView(new URL(window.location.href).searchParams.get("view"));
      const selected = requested && allowed.includes(requested) ? requested : allowed[0];
      if (!selected) return;
      if (selected !== requested) updateViewUrl(selected, true);
      setView(selected);
      setMessage("");
      setPending(null);
      void refresh(selected);
    };
    window.addEventListener("popstate", handleHistory);
    return () => window.removeEventListener("popstate", handleHistory);
  }, [identity, refresh]);
  async function command(payload: Row, reason: string) {
    setBusy(true);
    setMessage("");
    const body = JSON.stringify({ ...payload, reason });
    if (!exactCommand.current || exactCommand.current.body !== body)
      exactCommand.current = { body, key: crypto.randomUUID() };
    try {
      const response = await fetch("/api/commands", {
        method: "POST",
        headers: { "content-type": "application/json", "x-operator-csrf": csrf },
        body: JSON.stringify({ ...payload, idempotencyKey: exactCommand.current.key, reason }),
      });
      const body = record(await response.json());
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) clearAccess();
        throw new Error(text(record(body.error).message));
      }
      exactCommand.current = null;
      setMessage("Command completed and recorded in the audit timeline.");
      setPending(null);
      await refresh(view);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Command failed; refresh before retrying",
      );
    } finally {
      setBusy(false);
    }
  }
  async function signInLocally() {
    rememberLoginView();
    setSigningIn(true);
    setMessage("");
    try {
      const response = await fetch("/auth/local", { method: "POST" });
      const body = record(await response.json());
      if (!response.ok) throw new Error(text(record(body.error).message));
      window.location.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Local admin sign-in failed");
      setSigningIn(false);
    }
  }
  async function signOut() {
    setSigningOut(true);
    setMessage("");
    try {
      const response = await fetch("/api/logout", {
        method: "POST",
        headers: { "x-operator-csrf": csrf },
      });
      if (response.ok || response.status === 401) clearAccess();
      else
        setMessage(
          "Sign-out could not be confirmed. Your session may still be active. Reload this page before trying again.",
        );
    } catch {
      setMessage(
        "Sign-out could not be confirmed. Your session may still be active. Check your connection and try again.",
      );
    } finally {
      setSigningOut(false);
    }
  }
  function submitForm(event: FormEvent<HTMLFormElement>, action: string) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const reason = String(fields.get("reason") ?? "");
    const value = (name: string) => String(fields.get(name) ?? "").trim();
    const payload: Row = { action };
    if (action === "credits.grant")
      Object.assign(payload, {
        organizationId: value("organizationId"),
        quantity: Number(value("quantity")),
      });
    if (action === "promotion.create" || action === "promotion.discount.create")
      Object.assign(payload, {
        name: value("name"),
        code: value("code"),
        ...(action === "promotion.create"
          ? { creditQuantity: Number(value("creditQuantity")) }
          : { stripePromotionCodeId: value("stripePromotionCodeId") }),
        maximumRedemptions: Number(value("maximumRedemptions")),
        expiresAt: new Date(value("expiresAt")).toISOString(),
        ...(value("organizationId") ? { organizationId: value("organizationId") } : {}),
      });
    if (action === "case.create")
      Object.assign(payload, {
        title: value("title"),
        category: value("category"),
        redactedDescription: value("redactedDescription"),
        sendToSupport: fields.get("sendToSupport") === "on",
        ...(value("organizationId") ? { organizationId: value("organizationId") } : {}),
      });
    if (action === "integration.crm.designate")
      Object.assign(payload, {
        organizationId: value("organizationId"),
        userId: value("userId"),
        designated: true,
      });
    if (action === "case.reconcile")
      Object.assign(payload, {
        caseId: value("caseId"),
        originalJobId: value("originalJobId"),
        issueId: value("issueId"),
      });
    if (action === "integration.accounting.reconcile") {
      let transactionMappings: unknown;
      try {
        transactionMappings = JSON.parse(value("transactionMappings") || "[]");
      } catch {
        setMessage("Transaction mappings must be a valid JSON array.");
        return;
      }
      Object.assign(payload, {
        organizationId: value("organizationId"),
        externalCustomerId: value("externalCustomerId"),
        startDate: value("startDate"),
        endDate: value("endDate"),
        homeCurrency: value("homeCurrency").toUpperCase(),
        transactionMappings,
      });
    }
    if (action === "integration.connect") {
      Object.assign(payload, {
        integration: value("integration"),
        accessToken: value("accessToken"),
      });
      for (const name of [
        "cloudId",
        "serviceDeskId",
        "requestTypeId",
        "realmId",
        "refreshToken",
        "clientId",
        "clientSecret",
      ])
        if (value(name)) payload[name] = value(name);
      if (value("expiresAt")) payload.expiresAt = new Date(value("expiresAt")).toISOString();
      form.reset();
    }
    void command(payload, reason);
  }
  const organizationField = (required = true) => (
    <label>
      Organization
      <select name="organizationId" required={required}>
        <option value="">
          {required ? "Select an organization" : "All organizations / internal"}
        </option>
        {organizations.map((organization) => (
          <option value={text(organization.id)} key={text(organization.id)}>
            {text(organization.name)}
          </option>
        ))}
      </select>
    </label>
  );
  const reasonField = (
    <label>
      Reason
      <input
        name="reason"
        minLength={10}
        maxLength={500}
        required
        placeholder="Record why this action is needed"
      />
    </label>
  );
  if (!identity)
    return (
      <main className="signin">
        <div className="brand">
          Polling Pops <span>CONTROL</span>
        </div>
        <h1>Business operations</h1>
        <p>Manage organizations, billing, credits, support, and operational controls.</p>
        {enabled && localAdmin ? (
          <>
            <button disabled={signingIn || loading} onClick={() => void signInLocally()}>
              {signingIn ? "Signing in…" : "Sign in as local admin"}
            </button>
            <p className="note">Local development access for business administration.</p>
          </>
        ) : enabled ? (
          <>
            <a className="button" href="/auth/start" onClick={rememberLoginView}>
              Sign in with operator identity
            </a>
            <p className="note">Only provisioned operators with verified MFA can sign in.</p>
          </>
        ) : (
          <p className="notice">
            The operator console is disabled. Configure its dedicated identity provider and database
            before enabling it.
          </p>
        )}
        {loading && <p role="status">Checking access…</p>}
        {message && <p role="alert">{message}</p>}
      </main>
    );
  return (
    <div className="shell">
      <aside>
        <div className="brand">
          Polling Pops <span>CONTROL</span>
        </div>
        <nav aria-label="Operator areas">
          {views
            .filter((item) => can(`${item}.read`))
            .map((item) => (
              <button
                key={item}
                className={item === view ? "active" : ""}
                aria-current={item === view ? "page" : undefined}
                onClick={() => {
                  setView(item);
                  updateViewUrl(item);
                  setData({});
                  setMessage("");
                  setPending(null);
                  void refresh(item);
                }}
              >
                {label(item)}
              </button>
            ))}
        </nav>
        <div className="identity">
          <strong>{identity.name}</strong>
          <small>{identity.role === "founder" ? "Super admin" : label(identity.role)}</small>
          <button disabled={signingOut} onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </aside>
      <main>
        <header>
          <div>
            <p className="eyebrow">Polling Pops business platform</p>
            <h1>{label(view)}</h1>
          </div>
          <button disabled={loading} onClick={() => void refresh(view)}>
            Refresh
          </button>
        </header>
        {message && (
          <p role="status" className="notice">
            {message}{" "}
            {message.includes("Sign in again") &&
              (localAdmin ? (
                <button disabled={signingIn} onClick={() => void signInLocally()}>
                  Sign in as local admin
                </button>
              ) : (
                <a href="/auth/start" onClick={rememberLoginView}>
                  Verify identity again
                </a>
              ))}
          </p>
        )}
        {loading ? (
          <p role="status">Loading current records…</p>
        ) : (
          <>
            {view === "organizations" && (
              <>
                <p className="intro">
                  Organization policy applies to every workspace. Pausing stops new work; active
                  rooms retain their launch grants.
                </p>
                {rows(data.organizations).map((organization) => (
                  <section key={text(organization.id)}>
                    <div className="section-heading">
                      <div>
                        <h2>{text(organization.name)}</h2>
                        <p>{text(organization.id)}</p>
                      </div>
                      <span className="badge">{text(organization.status)}</span>
                      {can("organizations.write") && (
                        <button
                          onClick={() =>
                            setPending({
                              action: "organization.status",
                              organizationId: organization.id,
                              status: organization.status === "active" ? "suspended" : "active",
                              expectedUpdatedAt: organization.updatedAt,
                            })
                          }
                        >
                          {organization.status === "active" ? "Pause new work" : "Resume new work"}
                        </button>
                      )}
                    </div>
                    {rows(organization.workspaces).map((workspace) => (
                      <div className="workspace" key={text(workspace.id)}>
                        <div>
                          <strong>{text(workspace.name)}</strong>
                          <small>{text(workspace.id)}</small>
                        </div>
                        <span>{text(workspace.status)}</span>
                        {can("organizations.write") && (
                          <button
                            onClick={() =>
                              setPending({
                                action: "workspace.status",
                                organizationId: organization.id,
                                workspaceId: workspace.id,
                                status: workspace.status === "active" ? "suspended" : "active",
                                expectedStatus: workspace.status,
                              })
                            }
                          >
                            {workspace.status === "active" ? "Pause" : "Resume"}
                          </button>
                        )}
                        {can("organizations.write") && (
                          <button
                            onClick={() =>
                              setPending({
                                action: "workspace.admission.restrict",
                                organizationId: organization.id,
                                workspaceId: workspace.id,
                                blocked: !workspace.admissionBlocked,
                                expectedBlocked: Boolean(workspace.admissionBlocked),
                              })
                            }
                          >
                            {workspace.admissionBlocked ? "Allow new joins" : "Restrict new joins"}
                          </button>
                        )}
                      </div>
                    ))}
                  </section>
                ))}
                {!rows(data.organizations).length && (
                  <p className="empty">Organizations appear after customer organization setup.</p>
                )}
              </>
            )}
            {view === "billing" && (
              <>
                <section>
                  <h2>Subscriptions</h2>
                  <Table
                    items={rows(data.subscriptions).map((entry) => ({
                      organization: entry.organizationName,
                      ...record(entry.subscription),
                    }))}
                    columns={[
                      "organization",
                      "status",
                      "licenseQuantity",
                      "paidThrough",
                      "graceUntil",
                    ]}
                  />
                </section>
                <section>
                  <h2>Commercial holds</h2>
                  {rows(data.subscriptions)
                    .filter((entry) => record(entry.commercialHold).held)
                    .map((entry) => (
                      <div className="workspace" key={text(entry.organizationId)}>
                        <div>
                          <strong>{text(entry.organizationName)}</strong>
                          <small>{text(record(entry.commercialHold).reason)}</small>
                        </div>
                        {can("billing.write") && (
                          <button
                            onClick={() =>
                              setPending({
                                action: "billing.hold.resolve",
                                organizationId: entry.organizationId,
                                expectedHeld: true,
                                expectedUpdatedAt: record(entry.commercialHold).updatedAt,
                              })
                            }
                          >
                            Resolve after finance review
                          </button>
                        )}
                      </div>
                    ))}
                  <p className="note">
                    Refund or dispute holds stop new paid work. Resolving a hold does not grant
                    credits or issue a payment.
                  </p>
                </section>
                <section>
                  <h2>Catalog</h2>
                  <p>
                    Offers remain unavailable for purchase until published with configured provider
                    prices.
                  </p>
                  <Table
                    items={rows(data.offers)}
                    columns={["name", "kind", "status", "version", "currency", "amountMinor"]}
                  />
                </section>
                <section>
                  <h2>Billing events</h2>
                  <Table
                    items={rows(data.events)}
                    columns={["eventType", "state", "attempts", "availableAt", "lastError"]}
                  />
                  {can("billing.write") &&
                    rows(data.events)
                      .filter((event) => event.state === "failed")
                      .map((event) => (
                        <button
                          key={text(event.id)}
                          className="inline-action"
                          onClick={() =>
                            setPending({ action: "billing.job.retry", eventId: event.id })
                          }
                        >
                          Retry failed billing event · {text(event.id)}
                        </button>
                      ))}
                  <p className="note">
                    Retries schedule the retained verified event for the billing worker. They do not
                    edit the provider payload or initiate a payment.
                  </p>
                </section>
              </>
            )}
            {view === "credits" && (
              <>
                {rows(data.balances).map((entry) => (
                  <section key={text(entry.organizationId)}>
                    <div className="section-heading">
                      <h2>{text(entry.organizationName)}</h2>
                    </div>
                    <form action="/api/credits/export" method="get" className="export-period">
                      <input
                        type="hidden"
                        name="organizationId"
                        value={text(entry.organizationId)}
                      />
                      <label>
                        From (UTC)
                        <input name="from" type="date" required />
                      </label>
                      <label>
                        Through (UTC)
                        <input name="through" type="date" required />
                      </label>
                      <button>Export complete period</button>
                    </form>
                    <p className="note">
                      Choose up to 366 days. Periods over 100,000 entries require a shorter range;
                      exports are never silently truncated.
                    </p>
                    <div className="stats">
                      {["balance", "reserved", "available"].map((key) => (
                        <div key={key}>
                          <strong>{text(record(entry.balance)[key])}</strong>
                          <span>{label(key)}</span>
                        </div>
                      ))}
                    </div>
                    <Table
                      items={rows(entry.ledger)}
                      columns={["delta", "reason", "sourceKey", "createdAt"]}
                    />
                  </section>
                ))}
                {can("credits.write") && (
                  <section>
                    <h2>Grant event credits</h2>
                    <form onSubmit={(event) => submitForm(event, "credits.grant")}>
                      {organizationField()}
                      <label>
                        Credits
                        <input name="quantity" type="number" min={1} max={100000} required />
                      </label>
                      {reasonField}
                      <button disabled={busy}>Grant credits</button>
                    </form>
                  </section>
                )}
                {can("credits.write") && (
                  <section>
                    <h2>Map an existing Stripe discount</h2>
                    <form onSubmit={(event) => submitForm(event, "promotion.discount.create")}>
                      {organizationField(false)}
                      <label>
                        Name
                        <input name="name" required maxLength={120} />
                      </label>
                      <label>
                        Application coupon code
                        <input
                          name="code"
                          required
                          minLength={8}
                          maxLength={80}
                          autoComplete="off"
                        />
                      </label>
                      <label>
                        Stripe promotion code ID
                        <input name="stripePromotionCodeId" required pattern="promo_[A-Za-z0-9]+" />
                      </label>
                      <label>
                        Maximum redemptions
                        <input
                          name="maximumRedemptions"
                          type="number"
                          min={1}
                          max={10000}
                          required
                        />
                      </label>
                      <label>
                        Expires at
                        <input name="expiresAt" type="datetime-local" required />
                      </label>
                      {reasonField}
                      <button disabled={busy}>Map discount promotion</button>
                    </form>
                  </section>
                )}
                <section>
                  <h2>Promotions</h2>
                  <Table
                    items={rows(data.promotions)}
                    columns={[
                      "name",
                      "creditQuantity",
                      "maximumRedemptions",
                      "expiresAt",
                      "active",
                    ]}
                  />
                  {can("credits.write") && (
                    <form onSubmit={(event) => submitForm(event, "promotion.create")}>
                      {organizationField(false)}
                      <label>
                        Name
                        <input name="name" required maxLength={120} />
                      </label>
                      <label>
                        Code
                        <input
                          name="code"
                          required
                          minLength={8}
                          maxLength={80}
                          autoComplete="off"
                        />
                      </label>
                      <label>
                        Credits per redemption
                        <input name="creditQuantity" type="number" min={1} max={10000} required />
                      </label>
                      <label>
                        Maximum redemptions
                        <input
                          name="maximumRedemptions"
                          type="number"
                          min={1}
                          max={10000}
                          required
                        />
                      </label>
                      <label>
                        Expires at
                        <input name="expiresAt" type="datetime-local" required />
                      </label>
                      {reasonField}
                      <button disabled={busy}>Create credit promotion</button>
                    </form>
                  )}
                </section>
              </>
            )}
            {view === "operations" && (
              <>
                <section>
                  <h2>Active rooms</h2>
                  <Table
                    items={rows(data.activeRooms)}
                    columns={[
                      "organizationName",
                      "workspaceName",
                      "artifactType",
                      "roomId",
                      "code",
                      "participantCount",
                      "expiresAt",
                      "funding",
                    ]}
                  />
                </section>
                <section>
                  <h2>Product queues</h2>
                  <Table
                    items={rows(data.productQueues)}
                    columns={["kind", "pending", "processing", "failed", "oldestPendingAgeSeconds"]}
                  />
                  {rows(data.productQueues).map((queue) => (
                    <div key={text(queue.kind)}>
                      {can("operations.write") &&
                        (Array.isArray(queue.retryableFailedIds)
                          ? queue.retryableFailedIds
                          : []
                        ).map((id) => (
                          <button
                            key={text(id)}
                            className="inline-action"
                            onClick={() =>
                              setPending({
                                action: "product.job.retry",
                                kind: queue.kind,
                                jobId: id,
                              })
                            }
                          >
                            Retry failed {label(text(queue.kind))} · {text(id)}
                          </button>
                        ))}
                      {Array.isArray(queue.failedIds) &&
                        queue.failedIds.length >
                          (Array.isArray(queue.retryableFailedIds)
                            ? queue.retryableFailedIds.length
                            : 0) && (
                          <p className="note">
                            Some failed {label(text(queue.kind))} jobs have no retained retry
                            source.{" "}
                            {queue.kind === "authoring"
                              ? "Erased, expired, or already applied authoring input requires a new upload by the workspace member."
                              : "Report regeneration requires retained room evidence; inspect the incident before attempting recovery."}
                          </p>
                        )}
                    </div>
                  ))}
                </section>
                <section>
                  <h2>Worker heartbeats</h2>
                  <Table
                    items={rows(data.heartbeats)}
                    columns={["id", "status", "updatedAt", "details"]}
                  />
                </section>
                <section>
                  <h2>Queue controls</h2>
                  {rows(data.workerControls).map((worker) => (
                    <div className="workspace" key={text(worker.id)}>
                      <strong>{label(text(worker.id))}</strong>
                      <span>{worker.paused ? "Paused" : "Running"}</span>
                      {can("operations.write") && (
                        <button
                          onClick={() =>
                            setPending({
                              action: "worker.pause",
                              workerId: worker.id,
                              paused: !worker.paused,
                            })
                          }
                        >
                          {worker.paused ? "Resume" : "Pause"}
                        </button>
                      )}
                    </div>
                  ))}
                </section>
                <section>
                  <h2>Integration queue</h2>
                  <Table
                    items={rows(data.jobs)}
                    columns={["integration", "eventType", "state", "attempts", "lastError"]}
                  />
                </section>
                {rows(data.operators).length > 0 && (
                  <section>
                    <h2>Operator access</h2>
                    {rows(data.operators).map((operator) => (
                      <div className="workspace" key={text(operator.id)}>
                        <div>
                          <strong>{text(operator.name)}</strong>
                          <small>
                            {text(operator.role)} · {operator.active ? "Active" : "Disabled"}
                          </small>
                        </div>
                        <button
                          onClick={() =>
                            setPending({ action: "operators.revoke", operatorId: operator.id })
                          }
                        >
                          Revoke sessions
                        </button>
                        <button
                          onClick={() =>
                            setPending({
                              action: "operators.update",
                              operatorId: operator.id,
                              role: operator.role,
                              active: !operator.active,
                            })
                          }
                        >
                          {operator.active ? "Disable access" : "Restore access"}
                        </button>
                        <select
                          aria-label={`Role for ${text(operator.name)}`}
                          value={text(operator.role)}
                          onChange={(event) =>
                            setPending({
                              action: "operators.update",
                              operatorId: operator.id,
                              role: event.target.value,
                              active: operator.active,
                            })
                          }
                        >
                          {["founder", "support", "billing", "operations", "readonly"].map(
                            (role) => (
                              <option key={role}>{role}</option>
                            ),
                          )}
                        </select>
                      </div>
                    ))}
                  </section>
                )}
              </>
            )}
            {view === "support" && (
              <>
                <section>
                  <h2>Recent product feedback</h2>
                  <p className="note">
                    Review reports privately. Create a redacted case before sending a report to the
                    external support system.
                  </p>
                  <Table
                    items={rows(data.feedback)}
                    columns={["category", "message", "workspaceId", "contactEmail", "createdAt"]}
                  />
                </section>
                <section>
                  <h2>Cases</h2>
                  {rows(data.cases).map((entry) => (
                    <article key={text(entry.id)}>
                      <div className="section-heading">
                        <h3>{text(entry.title)}</h3>
                        <span className="badge">{text(entry.state)}</span>
                        {entry.externalIssueKey && can("support.write") ? (
                          <button
                            onClick={() => setPending({ action: "case.sync", caseId: entry.id })}
                          >
                            Refresh support status
                          </button>
                        ) : null}
                        {entry.state === "open" && can("support.write") && (
                          <button
                            onClick={() => setPending({ action: "case.close", caseId: entry.id })}
                          >
                            Close case
                          </button>
                        )}
                      </div>
                      <p>{text(record(entry.details).redactedDescription)}</p>
                      {entry.externalDeliveryState === "ambiguous" && can("support.write") ? (
                        <form onSubmit={(event) => submitForm(event, "case.reconcile")}>
                          <input type="hidden" name="caseId" value={text(entry.id)} />
                          <input
                            type="hidden"
                            name="originalJobId"
                            value={text(entry.externalJobId)}
                          />
                          <p className="note">
                            Look up this case in the approved Jira service desk, then provide the
                            existing request ID. The worker must verify the exact case and
                            organization references before linking it. No new request is created.
                          </p>
                          <label>
                            Existing Jira request ID
                            <input name="issueId" pattern="[0-9]+" maxLength={30} required />
                          </label>
                          {reasonField}
                          <button disabled={busy}>Verify existing support request</button>
                        </form>
                      ) : null}
                      {entry.externalDeliveryState ? (
                        <p>
                          Jira: {text(entry.externalIssueKey)} · {text(entry.externalDeliveryState)}{" "}
                          · {text(record(entry.providerMirror).status)} · Assigned to{" "}
                          {text(record(record(entry.providerMirror).assignee).displayName)}
                        </p>
                      ) : null}
                      <small>
                        {text(entry.id)} · {text(entry.category)}
                      </small>
                    </article>
                  ))}
                  {!rows(data.cases).length && <p className="empty">No support cases yet.</p>}
                </section>
                {can("support.write") && (
                  <section>
                    <h2>Open a case</h2>
                    <form onSubmit={(event) => submitForm(event, "case.create")}>
                      {organizationField(false)}
                      <label>
                        Category
                        <select name="category">
                          {["incident", "billing", "feedback", "integration"].map((category) => (
                            <option key={category}>{category}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Title
                        <input name="title" required maxLength={160} />
                      </label>
                      <label>
                        Redacted description
                        <textarea
                          name="redactedDescription"
                          required
                          minLength={10}
                          maxLength={4000}
                          placeholder="Use request/build references. Exclude credentials and participant content."
                        />
                      </label>
                      <label className="check">
                        <input type="checkbox" name="sendToSupport" />
                        Send this redacted case to the configured Jira service desk
                      </label>
                      {reasonField}
                      <button disabled={busy}>Open case</button>
                    </form>
                  </section>
                )}
              </>
            )}
            {view === "integrations" && (
              <>
                <section>
                  <h2>Connections</h2>
                  <p>
                    Jira handles support; HubSpot receives designated business contacts; QuickBooks
                    reconciliation reads existing invoices.
                  </p>
                  {rows(data.connections).map((connection) => (
                    <div className="workspace" key={text(connection.provider)}>
                      <strong>{label(text(connection.provider))}</strong>
                      <span className="badge">{text(connection.status)}</span>
                      {connection.status === "connected" && can("integrations.write") && (
                        <button
                          onClick={() =>
                            setPending({
                              action: "integration.disconnect",
                              integration: connection.provider,
                            })
                          }
                        >
                          Disconnect
                        </button>
                      )}
                    </div>
                  ))}
                </section>
                <section>
                  <h2>Designate a CRM contact</h2>
                  <p className="note">
                    Select a verified organization member. This sends their business contact email
                    to HubSpot and does not subscribe them to marketing.
                  </p>
                  {can("integrations.write") && (
                    <form onSubmit={(event) => submitForm(event, "integration.crm.designate")}>
                      <label>
                        Organization
                        <select
                          name="organizationId"
                          required
                          onChange={(event) => {
                            setContacts([]);
                            if (event.target.value)
                              void fetch(
                                `/api/views/integrations?organizationId=${encodeURIComponent(event.target.value)}`,
                                { cache: "no-store" },
                              ).then(async (response) => {
                                if (response.status === 401 || response.status === 403) {
                                  clearAccess();
                                  setMessage("Operator sign-in required");
                                  return;
                                }
                                if (response.ok)
                                  setContacts(rows(record(await response.json()).contacts));
                              });
                          }}
                        >
                          <option value="">Select an organization</option>
                          {organizations.map((organization) => (
                            <option key={text(organization.id)} value={text(organization.id)}>
                              {text(organization.name)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Verified member
                        <select name="userId" required>
                          <option value="">Select a member</option>
                          {contacts.map((contact) => (
                            <option key={text(contact.userId)} value={text(contact.userId)}>
                              {text(contact.email)}
                            </option>
                          ))}
                        </select>
                      </label>
                      {reasonField}
                      <button disabled={busy}>Designate and sync contact</button>
                    </form>
                  )}
                </section>
                <section>
                  <h2>Reconcile accounting records</h2>
                  <p className="note">
                    Map this organization to an existing QuickBooks customer and read the selected
                    period against imported Stripe facts. Explicit one-to-one mappings establish
                    document identity; amounts alone never establish a match. This does not post
                    sales or refunds.
                  </p>
                  {can("integrations.write") && can("billing.read") && (
                    <form
                      onSubmit={(event) => submitForm(event, "integration.accounting.reconcile")}
                    >
                      <label>
                        Organization
                        <select
                          name="organizationId"
                          required
                          onChange={(event) => {
                            if (event.target.value)
                              void fetch(
                                `/api/views/integrations?organizationId=${encodeURIComponent(event.target.value)}`,
                                { cache: "no-store" },
                              ).then(async (response) => {
                                if (response.status === 401 || response.status === 403) {
                                  clearAccess();
                                  setMessage("Operator sign-in required");
                                  return;
                                }
                                if (response.ok) setData(record(await response.json()));
                              });
                          }}
                        >
                          <option value="">Select an organization</option>
                          {organizations.map((organization) => (
                            <option key={text(organization.id)} value={text(organization.id)}>
                              {text(organization.name)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        External customer ID
                        <input name="externalCustomerId" required pattern="[0-9]+" />
                      </label>
                      <label>
                        From
                        <input name="startDate" type="date" required />
                      </label>
                      <label>
                        Through
                        <input name="endDate" type="date" required />
                      </label>
                      <label>
                        QuickBooks home currency
                        <input
                          name="homeCurrency"
                          required
                          pattern="[A-Za-z]{3}"
                          maxLength={3}
                          placeholder="USD"
                        />
                      </label>
                      <label>
                        Explicit transaction mappings (JSON)
                        <textarea
                          name="transactionMappings"
                          placeholder={
                            '[{"stripeTransactionId":"pi_…","entity":"Invoice","externalId":"123"}]'
                          }
                        />
                      </label>
                      {reasonField}
                      <button disabled={busy}>Queue read-only reconciliation</button>
                    </form>
                  )}
                  <Table
                    items={rows(data.stripeTransactions)}
                    columns={[
                      "id",
                      "kind",
                      "amountMinor",
                      "currency",
                      "occurredAt",
                      "paymentId",
                      "invoiceId",
                    ]}
                  />
                </section>
                <section>
                  <h2>Delivery attempts</h2>
                  <Table
                    items={rows(data.jobs)}
                    columns={[
                      "integration",
                      "eventType",
                      "state",
                      "attempts",
                      "externalId",
                      "lastError",
                      "result",
                    ]}
                  />
                  {can("integrations.write") &&
                    rows(data.jobs)
                      .filter((job) => job.state === "failed")
                      .map((job) => (
                        <button
                          className="inline-action"
                          key={text(job.id)}
                          onClick={() => setPending({ action: "integration.retry", jobId: job.id })}
                        >
                          Retry {text(job.eventType)} · {text(job.id)}
                        </button>
                      ))}
                  <p className="note">
                    An ambiguous creation outcome requires reconciliation before another provider
                    request.
                  </p>
                </section>
                {can("integrations.write") && (
                  <section>
                    <h2>Configure an approved provider credential</h2>
                    <p className="note">
                      Use a scoped access token from the approved provider account. Tokens are
                      encrypted in private storage and never appear in views or audit records.
                    </p>
                    <form onSubmit={(event) => submitForm(event, "integration.connect")}>
                      <label>
                        Provider
                        <select name="integration">
                          <option value="jira-service-management">Jira Service Management</option>
                          <option value="hubspot">HubSpot</option>
                          <option value="quickbooks">QuickBooks sandbox</option>
                        </select>
                      </label>
                      <label>
                        Access token
                        <input
                          name="accessToken"
                          type="password"
                          required
                          maxLength={8000}
                          autoComplete="off"
                        />
                      </label>
                      <label>
                        Refresh token (optional)
                        <input name="refreshToken" type="password" autoComplete="off" />
                      </label>
                      <label>
                        Provider client ID (for refresh)
                        <input name="clientId" autoComplete="off" />
                      </label>
                      <label>
                        Provider client secret (for refresh)
                        <input name="clientSecret" type="password" autoComplete="off" />
                      </label>
                      <label>
                        Access token expires at
                        <input name="expiresAt" type="datetime-local" />
                      </label>
                      <label>
                        Jira cloud ID
                        <input name="cloudId" />
                      </label>
                      <label>
                        Jira service desk ID
                        <input name="serviceDeskId" />
                      </label>
                      <label>
                        Jira request type ID
                        <input name="requestTypeId" />
                      </label>
                      <label>
                        QuickBooks realm ID
                        <input name="realmId" />
                      </label>
                      {reasonField}
                      <button disabled={busy}>Save encrypted connection</button>
                    </form>
                  </section>
                )}
              </>
            )}
            {view === "audit" && (
              <section>
                <h2>Operator audit timeline</h2>
                <Table
                  items={rows(data.events)}
                  columns={[
                    "createdAt",
                    "actorId",
                    "action",
                    "targetId",
                    "reason",
                    "requestId",
                    "before",
                    "after",
                  ]}
                />
              </section>
            )}
          </>
        )}
      </main>
      {pending && (
        <div className="modal" role="dialog" aria-modal="true" aria-labelledby="command-title">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const reason = String(new FormData(event.currentTarget).get("reason") ?? "");
              void command(pending, reason);
            }}
          >
            <h2 id="command-title">Review {text(pending.action)}</h2>
            <p>This operational change will be recorded with your operator identity.</p>
            <pre>{JSON.stringify(pending, null, 2)}</pre>
            {reasonField}
            <div className="actions">
              <button type="button" onClick={() => setPending(null)}>
                Cancel
              </button>
              <button disabled={busy}>Apply command</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
