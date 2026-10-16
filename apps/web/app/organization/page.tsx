"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Brand } from "../../components/brand";
import {
  ManagementNavigationLinks,
  useManagementNavigation,
} from "../../components/management-navigation";
import { API_URL, ApiClientError, apiFetch, humanError } from "../../lib/api";
import { clientUuid } from "../../lib/uuid";
import {
  FundingGuide,
  OrganizationAccessGuide,
  OrganizationEntryState,
  OrganizationSections,
} from "./organization-panels";
import {
  offerPrice,
  organizationAccessState,
  organizationFragmentTarget,
  organizationPermissions,
  type BillingView,
  type Offer,
  type Organization,
  type OrganizationInvitation,
  type OrganizationMember,
  type OrganizationRole,
  type OrganizationWorkspace,
} from "./organization-model";
import styles from "./organization.module.css";

export default function OrganizationPage() {
  return (
    <Suspense
      fallback={
        <main className={styles.page}>
          <h1>Organization</h1>
          <p role="status">Loading organization management…</p>
        </main>
      }
    >
      <OrganizationManagementPage />
    </Suspense>
  );
}

function OrganizationManagementPage() {
  const searchParams = useSearchParams();
  const requestedOrganization =
    searchParams.get("organizationId") ?? searchParams.get("organization");
  const navigation = useManagementNavigation();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [collectionUserId, setCollectionUserId] = useState<string | null>(null);
  const [collectionUnavailable, setCollectionUnavailable] = useState(false);
  const [collectionNeedsSignIn, setCollectionNeedsSignIn] = useState(false);
  const [collectionFailed, setCollectionFailed] = useState(false);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [selected, setSelected] = useState("");
  const [loadedOrganizationId, setLoadedOrganizationId] = useState("");
  const [fragmentVersion, setFragmentVersion] = useState(0);
  const [workspaces, setWorkspaces] = useState<OrganizationWorkspace[]>([]);
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [invitations, setInvitations] = useState<OrganizationInvitation[]>([]);
  const [inviteUrl, setInviteUrl] = useState("");
  const [billing, setBilling] = useState<BillingView | null>(null);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [checkoutEnabled, setCheckoutEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [closeConfirmation, setCloseConfirmation] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [segment, setSegment] = useState<"education" | "workplace">("workplace");
  const [inviteEmail, setInviteEmail] = useState("");
  const [memberRole, setMemberRole] = useState<OrganizationRole>("member");
  const [promotion, setPromotion] = useState("");
  const [discount, setDiscount] = useState("");
  const [offerId, setOfferId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [licenseQuantity, setLicenseQuantity] = useState(1);
  const [ownershipTargets, setOwnershipTargets] = useState<Record<string, string>>({});
  const requestKeys = useRef(new Map<string, string>());
  const handledFragment = useRef<string | null>(null);
  const accessState = organizationAccessState(navigation, {
    unavailable: collectionUnavailable,
    needsSignIn: collectionNeedsSignIn,
  });
  const collectionUserMatches = collectionUserId === navigation.user?.userId;
  const canManage = accessState === "ready" && collectionUserMatches && !collectionFailed;
  const organization = canManage
    ? organizations.find((candidate) => candidate.id === selected)
    : undefined;
  const permissions = organization ? organizationPermissions(organization.role) : null;
  const base = `/v1/organizations/${selected}`;
  const currentOrganizationId = organization?.id ?? "";
  const currentOrganizationRole = organization?.role ?? null;
  const requestedSelection =
    organizations.find((item) => item.id === requestedOrganization)?.id ??
    organizations[0]?.id ??
    "";

  const reportReadFailure = useCallback((failure: unknown) => {
    if (failure instanceof ApiClientError && failure.status === 404) {
      setCollectionUnavailable(true);
      setError("");
    } else if (failure instanceof ApiClientError && failure.status === 401) {
      setCollectionNeedsSignIn(true);
      setError("");
    } else {
      setCollectionFailed(true);
      setError(humanError(failure));
    }
  }, []);

  const refresh = useCallback(async (id: string, signal?: AbortSignal) => {
    const organizationList = await apiFetch<{ organizations: Organization[] }>(
      "/v1/organizations",
      { signal },
    );
    if (signal?.aborted) return;
    setOrganizations(organizationList.organizations);
    const current = organizationList.organizations.find((candidate) => candidate.id === id);
    if (!current) return;
    const access = organizationPermissions(current.role);
    const prefix = `/v1/organizations/${id}`;
    const [workspaceList, memberList, billingData, catalog, invitationList] = await Promise.all([
      apiFetch<{ workspaces: OrganizationWorkspace[] }>(`${prefix}/workspaces`, { signal }),
      access.administer
        ? apiFetch<{ members: OrganizationMember[] }>(`${prefix}/members`, { signal })
        : Promise.resolve({ members: [] }),
      access.billing
        ? apiFetch<BillingView>(`${prefix}/billing`, { signal })
        : Promise.resolve(null),
      access.billing
        ? apiFetch<{ offers: Offer[]; checkoutEnabled: boolean }>(`${prefix}/catalog`, { signal })
        : Promise.resolve({ offers: [], checkoutEnabled: false }),
      access.administer
        ? apiFetch<{ invitations: OrganizationInvitation[] }>(`${prefix}/invitations`, { signal })
        : Promise.resolve({ invitations: [] }),
    ]);
    if (signal?.aborted) return;
    setWorkspaces(workspaceList.workspaces);
    setMembers(memberList.members);
    setInvitations(invitationList.invitations);
    setBilling(billingData);
    setOffers(
      catalog.offers.filter(
        (offer) => offer.kind !== "credit_pack" || billingData?.eventCreditsEnabled,
      ),
    );
    setCheckoutEnabled(catalog.checkoutEnabled);
    setLicenseQuantity(billingData?.subscription.licenseQuantity || 1);
    setLoadedOrganizationId(id);
  }, []);

  useEffect(() => {
    if (
      navigation.loading ||
      navigation.error ||
      !navigation.organizationManagementEnabled ||
      !navigation.user
    )
      return;
    const controller = new AbortController();
    const userId = navigation.user.userId;
    setLoading(true);
    setCollectionUnavailable(false);
    setCollectionNeedsSignIn(false);
    setCollectionFailed(false);
    setError("");
    apiFetch<{ organizations: Organization[] }>("/v1/organizations", { signal: controller.signal })
      .then(({ organizations: list }) => {
        if (controller.signal.aborted) return;
        setOrganizations(list);
        setCollectionUserId(userId);
        setSelected(
          list.find((item) => item.id === requestedOrganization)?.id ?? list[0]?.id ?? "",
        );
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) reportReadFailure(failure);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [
    navigation.loading,
    navigation.error,
    navigation.organizationManagementEnabled,
    navigation.user?.userId,
    reloadVersion,
    requestedOrganization,
    reportReadFailure,
  ]);

  useEffect(() => {
    if (!selected || accessState !== "ready" || !collectionUserMatches) return;
    const controller = new AbortController();
    setLoading(true);
    setBilling(null);
    setMembers([]);
    setInvitations([]);
    setInviteUrl("");
    setCloseConfirmation("");
    setWorkspaces([]);
    setError("");
    refresh(selected, controller.signal)
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) reportReadFailure(failure);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [refresh, selected, accessState, collectionUserMatches, reloadVersion, reportReadFailure]);

  useEffect(() => {
    const onFragmentNavigation = () => {
      handledFragment.current = null;
      setFragmentVersion((version) => version + 1);
    };
    window.addEventListener("hashchange", onFragmentNavigation);
    window.addEventListener("popstate", onFragmentNavigation);
    return () => {
      window.removeEventListener("hashchange", onFragmentNavigation);
      window.removeEventListener("popstate", onFragmentNavigation);
    };
  }, []);

  useEffect(() => {
    const location = new URL(window.location.href);
    if (!location.hash) {
      handledFragment.current = null;
      return;
    }
    if (
      (location.searchParams.get("organizationId") ?? location.searchParams.get("organization")) !==
      requestedOrganization
    )
      return;
    // Next may consume a fragment before its section exists. Restore it once the
    // requested organization's details are committed, never after ordinary refreshes.
    if (
      !canManage ||
      loading ||
      !currentOrganizationRole ||
      loadedOrganizationId !== currentOrganizationId ||
      currentOrganizationId !== requestedSelection
    )
      return;
    const targetId = organizationFragmentTarget(location.hash, currentOrganizationRole);
    const href = location.href;
    if (!targetId || handledFragment.current === href) return;
    const target = document.getElementById(targetId);
    if (!target) return;
    target.scrollIntoView({ block: "start", behavior: "instant" });
    handledFragment.current = href;
  }, [
    canManage,
    loading,
    currentOrganizationId,
    currentOrganizationRole,
    loadedOrganizationId,
    requestedSelection,
    requestedOrganization,
    fragmentVersion,
  ]);

  async function mutate(action: string, path: string, body: unknown, method = "POST") {
    if (!canManage) return;
    const intent = JSON.stringify({ userId: navigation.user?.userId, action, path, body });
    const key = requestKeys.current.get(intent) ?? clientUuid();
    requestKeys.current.set(intent, key);
    setBusy(action);
    setError("");
    setMessage("");
    try {
      const result = await apiFetch<{
        url?: string;
        organization?: Organization;
        inviteUrl?: string;
      }>(path, {
        method,
        headers: { "x-idempotency-key": key },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      requestKeys.current.delete(intent);
      if (result.url) {
        window.location.assign(result.url);
        return;
      }
      if (result.inviteUrl) {
        setInviteUrl(result.inviteUrl);
        setInviteEmail("");
      }
      if (result.organization) {
        await refresh(result.organization.id);
        selectOrganization(result.organization.id);
        setOrganizationName("");
      } else await refresh(selected);
      setMessage("Changes saved.");
    } catch (failure) {
      if (failure instanceof ApiClientError && [401, 404].includes(failure.status))
        reportReadFailure(failure);
      else setError(humanError(failure));
    } finally {
      setBusy("");
    }
  }

  function submit(event: FormEvent, action: () => void) {
    event.preventDefault();
    action();
  }

  function selectOrganization(id: string) {
    setSelected(id);
    const url = new URL(window.location.href);
    url.searchParams.set("organizationId", id);
    url.searchParams.delete("organization");
    window.history.replaceState(null, "", url);
  }

  function retry() {
    if (navigation.error) void navigation.refresh();
    else setReloadVersion((previous) => previous + 1);
  }

  const viewState =
    accessState !== "ready"
      ? accessState
      : collectionFailed
        ? "error"
        : !collectionUserMatches || loading
          ? "loading"
          : "ready";

  const chrome = (
    <>
      <header className={styles.header}>
        <Brand href="/home" />
        <nav aria-label="Organization navigation" aria-busy={navigation.loading}>
          <Link href="/home">Workspace</Link>
          {navigation.user ? (
            <>
              <span className={styles.identity}>{navigation.user.email}</span>
              <Link href="/account">Account</Link>
            </>
          ) : (
            !navigation.loading && <Link href="/signin?returnTo=%2Forganization">Sign in</Link>
          )}
          <ManagementNavigationLinks navigation={navigation} />
        </nav>
      </header>
      <div className={styles.row}>
        <div>
          <p className="eyebrow">PollingPops management</p>
          <h1>Organization</h1>
          <p>Manage independent workspaces, shared billing, and event credits.</p>
        </div>
        {canManage && organizations.length > 0 && (
          <label className="field">
            <span>Organization</span>
            <select
              className="select"
              value={selected}
              disabled={Boolean(busy)}
              onChange={(event) => {
                setMessage("");
                selectOrganization(event.target.value);
              }}
            >
              {organizations.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
    </>
  );

  if (!canManage) {
    return (
      <main className={styles.page}>
        {chrome}
        <OrganizationEntryState
          state={viewState === "ready" ? "loading" : viewState}
          error={error || navigation.error}
          onRetry={retry}
        />
      </main>
    );
  }

  return (
    <main className={styles.page}>
      {chrome}
      {error && !collectionFailed && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {canManage && message && (
        <p className={styles.success} role="status">
          {message}
        </p>
      )}
      {viewState !== "ready" && (
        <OrganizationEntryState
          state={viewState}
          error={error || navigation.error}
          onRetry={retry}
        />
      )}
      <div className={styles.stack}>
        {!loading && organizations.length === 0 && !error && (
          <p>Create an organization to bring your workspaces and billing together.</p>
        )}
        {organization && (
          <>
            <OrganizationSections role={organization.role} />
            <OrganizationAccessGuide role={organization.role} />
          </>
        )}
        {organization && (
          <div className={styles.grid}>
            {organization && permissions?.administer && (
              <section className="panel" id="settings">
                <h2>Organization settings</h2>
                <p>
                  Workspace access and organization membership are managed in their sections above.
                  Organization owners control closure.
                </p>
                {!permissions.appointOwner ? (
                  <p>Ask an organization owner to close this organization.</p>
                ) : (
                  <>
                    <h3>Close organization</h3>
                    {organization.status === "closed" ? (
                      <p>
                        This organization is closed. Its content and financial history are retained.
                      </p>
                    ) : (
                      <>
                        <p>
                          Cancel your subscription through billing management, cancel unfinished
                          checkouts, and finish all active rooms before closing. Closing stops new
                          paid activity and keeps your content and financial records.
                        </p>
                        <form
                          className={styles.form}
                          onSubmit={(event) =>
                            submit(
                              event,
                              () =>
                                void mutate("close", `${base}/close`, {
                                  confirmation: closeConfirmation,
                                }),
                            )
                          }
                        >
                          <label>
                            <span>Type {organization.name} to confirm closure</span>
                            <input
                              className="input"
                              value={closeConfirmation}
                              onChange={(event) => setCloseConfirmation(event.target.value)}
                              autoComplete="off"
                            />
                          </label>
                          <button
                            className="button button-danger"
                            disabled={Boolean(busy) || closeConfirmation !== organization.name}
                          >
                            Close organization
                          </button>
                        </form>
                      </>
                    )}
                  </>
                )}
              </section>
            )}
            <section className="panel" id="workspaces">
              <h2>Workspaces</h2>
              <p>Each workspace keeps its content and audience data separate.</p>
              <ul className={styles.list}>
                {workspaces.map((workspace) => {
                  const assigned = billing?.assignments.some(
                    (assignment) => assignment.workspaceId === workspace.id,
                  );
                  return (
                    <li key={workspace.id}>
                      <div className={styles.row}>
                        <div>
                          <strong>{workspace.name}</strong>
                          <small>
                            {workspace.segment} · {workspace.status}
                            {assigned ? " · license assigned" : ""}
                          </small>
                        </div>
                        {permissions?.billing && billing && (
                          <button
                            className="button button-quiet"
                            disabled={Boolean(busy)}
                            onClick={() =>
                              void mutate(
                                `license-${workspace.id}`,
                                `${base}/workspaces/${workspace.id}/license`,
                                { assigned: !assigned },
                                "PUT",
                              )
                            }
                          >
                            {assigned ? "Unassign license" : "Assign license"}
                          </button>
                        )}
                      </div>
                      {permissions?.administer && (
                        <div className={styles.actions}>
                          <label className="field">
                            <span>Transfer workspace ownership</span>
                            <select
                              className="select"
                              value={ownershipTargets[workspace.id] ?? ""}
                              onChange={(event) =>
                                setOwnershipTargets((previous) => ({
                                  ...previous,
                                  [workspace.id]: event.target.value,
                                }))
                              }
                            >
                              <option value="">Choose existing workspace member</option>
                              {members
                                .filter(
                                  (member) =>
                                    member.userId !== workspace.ownerId &&
                                    workspace.eligibleOwnerIds?.includes(member.userId),
                                )
                                .map((member) => (
                                  <option key={member.userId} value={member.userId}>
                                    {member.email ?? "Organization member"}
                                  </option>
                                ))}
                            </select>
                          </label>
                          <button
                            className="button button-quiet"
                            disabled={Boolean(busy) || !ownershipTargets[workspace.id]}
                            onClick={() =>
                              void mutate(
                                `ownership-${workspace.id}`,
                                `${base}/workspaces/${workspace.id}/ownership`,
                                { userId: ownershipTargets[workspace.id] },
                              )
                            }
                          >
                            Transfer ownership
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
              {permissions?.administer && (
                <form
                  className={styles.form}
                  onSubmit={(event) =>
                    submit(
                      event,
                      () =>
                        void mutate("workspace", `${base}/workspaces`, {
                          name: workspaceName,
                          segment,
                        }),
                    )
                  }
                >
                  <label>
                    <span>New workspace name</span>
                    <input
                      className="input"
                      required
                      maxLength={120}
                      value={workspaceName}
                      onChange={(event) => setWorkspaceName(event.target.value)}
                    />
                  </label>
                  <label>
                    <span>Workspace type</span>
                    <select
                      className="select"
                      value={segment}
                      onChange={(event) =>
                        setSegment(event.target.value as "education" | "workplace")
                      }
                    >
                      <option value="workplace">Workplace</option>
                      <option value="education">Education</option>
                    </select>
                  </label>
                  <button className="button" disabled={Boolean(busy)}>
                    Create workspace
                  </button>
                </form>
              )}
            </section>
            {permissions?.administer && (
              <section className="panel" id="members">
                <h2>Members and roles</h2>
                <p>Adding a member here does not give them access to workspace content.</p>
                <ul className={styles.list}>
                  {members.map((member) => (
                    <li key={member.userId}>
                      <div className={styles.row}>
                        <div>
                          <strong>{member.email ?? "Organization member"}</strong>
                        </div>
                        <div className={styles.actions}>
                          <label>
                            <span className="sr-only">
                              Role for {member.email ?? "organization member"}
                            </span>
                            <select
                              className="select"
                              value={member.role}
                              disabled={
                                Boolean(busy) ||
                                (member.role === "owner" && !permissions.appointOwner)
                              }
                              onChange={(event) =>
                                void mutate(
                                  `member-${member.userId}`,
                                  `${base}/members/${member.userId}`,
                                  { role: event.target.value },
                                  "PUT",
                                )
                              }
                            >
                              <option value="member">Member</option>
                              <option value="billing">Billing administrator</option>
                              <option value="admin">Administrator</option>
                              {(permissions.appointOwner || member.role === "owner") && (
                                <option value="owner">Owner</option>
                              )}
                            </select>
                          </label>
                          <button
                            className="button button-quiet"
                            disabled={
                              Boolean(busy) ||
                              (member.role === "owner" && !permissions.appointOwner)
                            }
                            onClick={() =>
                              void mutate(
                                `remove-${member.userId}`,
                                `${base}/members/${member.userId}`,
                                undefined,
                                "DELETE",
                              )
                            }
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
                <form
                  className={styles.form}
                  onSubmit={(event) =>
                    submit(
                      event,
                      () =>
                        void mutate("invitation", `${base}/invitations`, {
                          email: inviteEmail,
                          role: memberRole,
                        }),
                    )
                  }
                >
                  <label>
                    <span>Invite by email</span>
                    <input
                      className="input"
                      type="email"
                      required
                      maxLength={254}
                      value={inviteEmail}
                      onChange={(event) => setInviteEmail(event.target.value)}
                      placeholder="colleague@example.com"
                    />
                  </label>
                  <label>
                    <span>Organization role</span>
                    <select
                      className="select"
                      value={memberRole}
                      onChange={(event) => setMemberRole(event.target.value as OrganizationRole)}
                    >
                      <option value="member">Member</option>
                      <option value="billing">Billing administrator</option>
                      <option value="admin">Administrator</option>
                      {permissions.appointOwner && <option value="owner">Owner</option>}
                    </select>
                  </label>
                  <button className="button" disabled={Boolean(busy)}>
                    Send invitation
                  </button>
                </form>
                {inviteUrl && (
                  <p>
                    Invitation sent.{" "}
                    <button
                      className="button button-quiet"
                      onClick={() =>
                        void navigator.clipboard
                          .writeText(inviteUrl)
                          .then(() => setMessage("Invitation link copied."))
                          .catch(() => setError("The invitation link could not be copied."))
                      }
                    >
                      Copy invitation link
                    </button>
                  </p>
                )}
                <ul className={styles.list} aria-label="Pending organization invitations">
                  {invitations
                    .filter((invitation) => !invitation.acceptedAt && !invitation.revokedAt)
                    .map((invitation) => (
                      <li key={invitation.id}>
                        <div className={styles.row}>
                          <div>
                            <strong>{invitation.email}</strong>
                            <small>
                              {invitation.role} ·{" "}
                              {new Date(invitation.expiresAt).getTime() <= Date.now()
                                ? "expired"
                                : `expires ${new Date(invitation.expiresAt).toLocaleDateString()}`}
                            </small>
                          </div>
                          <button
                            className="button button-quiet"
                            disabled={Boolean(busy)}
                            onClick={() =>
                              void mutate(
                                `revoke-${invitation.id}`,
                                `${base}/invitations/${invitation.id}`,
                                undefined,
                                "DELETE",
                              )
                            }
                          >
                            Revoke invitation
                          </button>
                        </div>
                      </li>
                    ))}
                </ul>
              </section>
            )}
          </div>
        )}
        {permissions?.billing && billing && (
          <>
            <FundingGuide billing={billing} />
            <section className="panel" id="event-credits">
              <h2>Billing and event credits</h2>
              {billing.purchases?.some((purchase) => purchase.status === "pending") && (
                <ul className={styles.list} aria-label="Unfinished purchases">
                  {billing.purchases
                    .filter((purchase) => purchase.status === "pending")
                    .map((purchase) => (
                      <li key={purchase.id}>
                        <div className={styles.row}>
                          <span>
                            {purchase.offer.name} · quantity {purchase.quantity} · awaiting payment
                            confirmation
                          </span>
                          <button
                            className="button button-quiet"
                            disabled={Boolean(busy)}
                            onClick={() =>
                              void mutate(
                                `cancel-${purchase.id}`,
                                `${base}/billing/purchases/${purchase.id}/cancel`,
                                {},
                              )
                            }
                          >
                            Cancel unfinished checkout
                          </button>
                        </div>
                      </li>
                    ))}
                </ul>
              )}
              <div className={styles.actions}>
                <button
                  className="button button-quiet"
                  disabled={
                    Boolean(busy) || !billing.subscription.customerId || billing.mode !== "stripe"
                  }
                  onClick={() => void mutate("portal", `${base}/billing/portal`, {})}
                >
                  Manage payment and invoices
                </button>
                <a className="button button-quiet" href={`${API_URL}${base}/billing/export`}>
                  Export billing history
                </a>
                <button
                  className="button button-quiet"
                  disabled={Boolean(busy)}
                  onClick={() =>
                    void refresh(selected).catch((failure: unknown) =>
                      setError(humanError(failure)),
                    )
                  }
                >
                  Refresh billing
                </button>
              </div>
              {billing.subscription.subscriptionId && billing.mode === "stripe" && (
                <form
                  className={styles.form}
                  onSubmit={(event) =>
                    submit(
                      event,
                      () =>
                        void mutate("quantity", `${base}/billing/quantity`, {
                          quantity: licenseQuantity,
                        }),
                    )
                  }
                >
                  <label>
                    <span>Paid workspace quantity</span>
                    <input
                      className={`input ${styles.quantity}`}
                      type="number"
                      required
                      min={1}
                      max={1000}
                      value={licenseQuantity}
                      onChange={(event) => setLicenseQuantity(Number(event.target.value))}
                    />
                  </label>
                  <button className="button" disabled={Boolean(busy)}>
                    Update subscription quantity
                  </button>
                  <p>
                    Unassign idle workspaces before reducing quantity. Additional licenses become
                    available when payment succeeds.
                  </p>
                </form>
              )}
              {offers.length === 0 ? (
                <p>
                  No offers are currently published. Your existing subscription and credits remain
                  visible above.
                </p>
              ) : (
                <form
                  className={styles.stack}
                  onSubmit={(event) =>
                    submit(event, () => {
                      const offer = offers.find((item) => item.id === offerId);
                      if (offer)
                        void mutate("checkout", `${base}/billing/checkout`, {
                          offerId: offer.id,
                          offerVersion: offer.version,
                          quantity,
                          ...(discount.trim() ? { promotionCode: discount.trim() } : {}),
                        });
                    })
                  }
                >
                  <div className={styles.grid}>
                    {offers.map((offer) => (
                      <label className={styles.offer} key={offer.id}>
                        <input
                          type="radio"
                          name="offer"
                          value={offer.id}
                          required
                          checked={offerId === offer.id}
                          disabled={
                            !checkoutEnabled ||
                            Boolean(busy) ||
                            (offer.kind === "workspace_subscription" &&
                              Boolean(billing.subscription.subscriptionId) &&
                              !["free", "canceled", "incomplete_expired"].includes(
                                billing.subscription.status,
                              ))
                          }
                          onChange={() => setOfferId(offer.id)}
                        />
                        <h3>{offer.name}</h3>
                        <p>{offerPrice(offer)}</p>
                        <p>
                          {offer.kind === "credit_pack"
                            ? `${offer.creditQuantity} event credits per pack`
                            : "Premium features for each licensed workspace"}
                        </p>
                      </label>
                    ))}
                  </div>
                  <div className={styles.form}>
                    <label>
                      <span>Quantity</span>
                      <input
                        className="input"
                        type="number"
                        required
                        min={1}
                        max={1000}
                        value={quantity}
                        onChange={(event) => setQuantity(Number(event.target.value))}
                      />
                    </label>
                    <label>
                      <span>Discount code (optional)</span>
                      <input
                        className="input"
                        maxLength={120}
                        value={discount}
                        onChange={(event) => setDiscount(event.target.value)}
                      />
                    </label>
                    <button
                      className="button"
                      disabled={!checkoutEnabled || Boolean(busy) || !offerId}
                    >
                      Continue to checkout
                    </button>
                  </div>
                  <p>
                    Payment confirmation updates access. A checkout return page does not confirm
                    payment.
                  </p>
                </form>
              )}
              {billing.eventCreditsEnabled && (
                <form
                  className={styles.form}
                  onSubmit={(event) =>
                    submit(
                      event,
                      () =>
                        void mutate("promotion", `${base}/promotions/redeem`, {
                          code: promotion,
                        }),
                    )
                  }
                >
                  <label>
                    <span>Free event credit code</span>
                    <input
                      className="input"
                      required
                      minLength={3}
                      maxLength={120}
                      value={promotion}
                      onChange={(event) => setPromotion(event.target.value)}
                      autoComplete="off"
                    />
                  </label>
                  <button className="button" disabled={Boolean(busy)}>
                    Redeem credit code
                  </button>
                </form>
              )}
            </section>
          </>
        )}
        <section className="panel">
          <h2>Create organization</h2>
          <form
            className={styles.form}
            onSubmit={(event) =>
              submit(
                event,
                () => void mutate("organization", "/v1/organizations", { name: organizationName }),
              )
            }
          >
            <label>
              <span>Organization name</span>
              <input
                className="input"
                required
                maxLength={120}
                value={organizationName}
                onChange={(event) => setOrganizationName(event.target.value)}
              />
            </label>
            <button className="button" disabled={Boolean(busy) || loading}>
              Create organization
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
