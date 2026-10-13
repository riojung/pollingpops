import type { BillingView, OrganizationRole } from "./organization-model";
import { licenseOverflow, organizationPermissions } from "./organization-model";

export function FundingGuide({ billing }: { billing: BillingView }) {
  const overflow = licenseOverflow(billing);
  return (
    <section className="panel" aria-labelledby="funding-heading">
      <h2 id="funding-heading">Licenses and event credits</h2>
      <p>
        Workspace subscriptions cover the workspaces you license. Event credits are shared across
        your organization and do not expire.
      </p>
      <dl className="compact-definition-list">
        <div>
          <dt>Workspace licenses</dt>
          <dd>
            {billing.assignments.length} assigned / {billing.subscription.licenseQuantity} purchased
          </dd>
        </div>
        <div>
          <dt>Event credits available</dt>
          <dd>{billing.balance.available}</dd>
        </div>
        <div>
          <dt>Reserved for empty rooms</dt>
          <dd>{billing.balance.reserved}</dd>
        </div>
        <div>
          <dt>Billing status</dt>
          <dd>{billing.subscription.status}</dd>
        </div>
      </dl>
      <p>
        Choose an event credit when creating a premium Round or Presentation room. One credit is
        reserved for the room and used when its first audience member joins. Canceling an empty
        room, or letting it expire, returns the reservation.
      </p>
      <p>
        An event credit includes premium live delivery and that room’s reports. Library and AI
        authoring allowances remain part of a workspace subscription.
      </p>
      {billing.subscription.graceUntil && (
        <p role="status">
          Renewal payment needs attention. Paid workspace access is retained until{" "}
          {new Date(billing.subscription.graceUntil).toLocaleString()}.
        </p>
      )}
      {overflow > 0 && (
        <p role="alert">
          Your subscription has {overflow} fewer licenses than assigned workspaces. Review license
          assignments; workspaces beyond the paid quantity no longer have subscription access.
        </p>
      )}
      {billing.commercialHold?.held && (
        <p role="alert">
          New premium rooms are temporarily on hold while a payment reversal is reviewed. Existing
          rooms and their reports remain available. Contact support for financial review.
        </p>
      )}
    </section>
  );
}

export function OrganizationAccessGuide({ role }: { role: OrganizationRole }) {
  const permissions = organizationPermissions(role);
  return (
    <section className="panel">
      <h2>Organization access</h2>
      <p>Your organization role: {role === "billing" ? "billing administrator" : role}.</p>
      <p>
        Organization roles manage billing and administration. Workspace membership controls access
        to polls, presentations, and audience reports.
      </p>
      {!permissions.billing && (
        <p>
          Ask an organization owner, administrator, or billing administrator to manage licenses and
          event credits.
        </p>
      )}
    </section>
  );
}
