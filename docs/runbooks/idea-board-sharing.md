# Idea Board sharing and invitations

## Facilitator groups

Open **Share board → Facilitator groups**, select groups, choose a board role, and confirm sharing. Groups belong to the board's owning workspace; sharing never adds a workspace membership or allocates a creator license.

Canvas access follows current group membership. Direct and group access are combined using the strongest applicable role. Removing a group share removes that access source; a person may retain access through another group, a direct grant, or board ownership. Existing identity, organization, license, expiry, and operational checks still apply. A licensed canvas facilitator can manage sharing; deleting and archiving remain owner actions.

Canvas boards appear in the selected groups' shared canvas collection. Legacy Guided workshops can also be added to a group's shared artifacts. Their existing workspace permissions remain in force; this curation does not introduce a separate legacy board ACL. Workshops and canvas boards cannot be scheduled through the Round/Presentation group scheduler.

## Email invitations

**Collaborators** accepts up to 20 distinct verified organization email addresses per batch and assigns the selected canvas role when each recipient accepts their invitation. Write roles still require an eligible creator license.

**Workshop guests** accepts up to 20 distinct addresses, including external recipients. Guests receive the existing public workshop join link, without an account, creator license, or editor role. Joining still checks the workshop's current phase, expiry, capacity, and anonymous or nickname settings. The email address is not attached to a guest response or ballot. A public join link can be forwarded; an email receipt is not a private admission credential or individually revocable guest grant.

Each recipient receives an individual message. The result list distinguishes sent, pending, failed, rejected, and uncertain delivery. **Retry pending invitations** reuses the same batch and sends only entries that have not been claimed. Sent and uncertain entries are never automatically resent. If a connection closes after the SMTP server may have accepted a message, the result is uncertain; an explicitly confirmed new batch can produce another email. SMTP delivery is not exactly once.

## Deployment and operations

- Apply database migrations 084–086 before using these controls.
- Enable the existing Groups, Idea Boards, Canvas, and Canvas sharing features as appropriate for the owning workspace.
- Configure `SMTP_URL`, `EMAIL_FROM`, and an externally reachable `WEB_ORIGIN`. Guest and collaborator links use the configured web origin.
- The development console mailer does not count as successful invitation delivery. Browser tests use a guarded synthetic capture instead of a real SMTP server.
- Each authenticated request has a bounded delivery window. Pending work continues only when the sender retries the same batch; there is no unattended email worker.
- Invitation receipts are private and expire with the board. Keeping the receipt for the board's lifetime prevents an old retry from resending previously delivered or uncertain messages. Normal retention sweeps remove expired records. Account and board deletion also remove them; account exports omit claim tokens and internal delivery details.
- Do not log recipient lists, invitation URLs, SMTP errors containing addresses, or message contents. Audit and rate-limit keys use identifiers or digests.

Canvas object, direct-grant, invitation, and live collaboration limits are unchanged. Group sharing adds a separate maximum of 20 group-grant records per board.
