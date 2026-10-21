# Institution integration guide

Polling Pops’ institution features are an operator-gated foundation for approved adult and
higher-education pilots. They do not make a deployment contract-ready by themselves. K–12 mode,
identified learner launches, NRPS roster access, AGS grade passback, managed SAML/SCIM, and LMS
certification remain disabled or unimplemented until their separate privacy, security, contract,
and interoperability gates pass.

Anonymous guest participation remains the default. Enabling creator OIDC or instructor LTI does
not silently identify live participants.

## Trust model

- Only the deployment operator can grant an institution policy or register an LMS. A workspace
  owner can inspect, but cannot self-enable, these capabilities.
- A policy must be `pilot` or `active` before any institution capability can run.
- K–12 is represented by a literal `false` in the public contract and a database constraint.
- Polling Pops keys external identities by workspace, provider, issuer, and subject. It never links
  accounts from an email match.
- OIDC and LTI state are hashed, short-lived, and single-use. OIDC uses authorization code, PKCE,
  state, and nonce. LTI validates the platform signature, issuer, audience/authorized party,
  deployment, nonce, version, message type, and signed target.
- The LTI tool signing key stays in the secret manager. `/v1/lti/jwks` publishes only its public
  modulus and exponent.
- Registration endpoints must use HTTPS in production and cannot contain embedded credentials or
  fragments. Deep-link responses can return only to a registered HTTPS origin.

## 1. Grant a workspace policy

Find the workspace UUID on the Account screen or from `GET /v1/workspaces`. Use the operator
`ADMIN_TOKEN`; never put this token in browser code.

This example approves creator OIDC, instructor LTI, residency visibility, and audit export while
keeping participant identity optional:

```bash
curl --fail-with-body \
  --request PUT \
  --header "Authorization: Bearer $OPENROUND_ADMIN_TOKEN" \
  --header "Content-Type: application/json" \
  --data '{
    "contractStatus": "pilot",
    "identityRequirement": "optional",
    "capabilities": {
      "oidc": true,
      "managedSso": false,
      "scim": false,
      "lti": true,
      "nrps": false,
      "ags": false,
      "auditExports": true,
      "residencyControls": true
    },
    "k12Enabled": false
  }' \
  "$OPENROUND_API_URL/v1/admin/workspaces/$OPENROUND_WORKSPACE_ID/institution-policy"
```

`nrps` or `ags` cannot be enabled unless identity is `institution` and LTI is enabled. Those flags
are deliberately not sufficient to provide roster or grade services in this release.

## 2. Configure generic creator OIDC

Register this redirect URI at the identity provider:

```text
https://YOUR_API_ORIGIN/v1/auth/oidc/callback
```

Configure the server through the secret manager:

```dotenv
OIDC_MODE=generic
OIDC_ISSUER=https://identity.example.edu
OIDC_CLIENT_ID=openround-production
OIDC_CLIENT_SECRET=replace-in-secret-manager
OIDC_CLIENT_AUTH=client_secret_post
OIDC_PROVIDER_NAME=Example University
OIDC_TRANSACTION_TTL_SECONDS=300
```

The deployment currently supports one generic OIDC provider configuration, with access granted
per workspace. Restart the server after changing provider configuration.

An existing creator signs in by email, opens **Account**, and explicitly selects **Link
institution identity**. After linking, use:

```text
https://YOUR_WEB_ORIGIN/signin?workspaceId=WORKSPACE_UUID
```

An unknown OIDC subject is rejected with `FEDERATED_IDENTITY_NOT_LINKED`. If membership is later
removed, the linked identity cannot create a creator session. Owners can revoke their link from
Account; verified-email PIN sign-in remains available.

## 3. Configure LTI 1.3 and Deep Linking

Generate a dedicated 2048-bit or stronger RSA private JWK in a secure administrative environment.
The output is a secret:

```bash
pnpm --filter @openround/server exec node --input-type=module -e \
  "import {generateKeyPair,exportJWK} from 'jose'; const pair=await generateKeyPair('RS256',{extractable:true,modulusLength:2048}); console.log(JSON.stringify({...await exportJWK(pair.privateKey),alg:'RS256'}))"
```

Store it as a single-line secret and enable the tool:

```dotenv
LTI_MODE=tool
LTI_TOOL_PRIVATE_JWK={"kty":"RSA","n":"...","e":"AQAB","d":"...","alg":"RS256"}
LTI_TOOL_KEY_ID=openround-lti-2026-01
LTI_TRANSACTION_TTL_SECONDS=300
LTI_LAUNCH_TTL_SECONDS=900
```

Give the LMS administrator these Polling Pops values:

| LMS field                 | Polling Pops value                      |
| ------------------------- | --------------------------------------- |
| OIDC login initiation URL | `https://YOUR_API_ORIGIN/v1/lti/login`  |
| Redirect/launch URL       | `https://YOUR_API_ORIGIN/v1/lti/launch` |
| Deep Linking target URL   | `https://YOUR_API_ORIGIN/v1/lti/launch` |
| Public JWKS URL           | `https://YOUR_API_ORIGIN/v1/lti/jwks`   |

Collect the LMS issuer, client ID, deployment ID, authorization endpoint, optional token endpoint,
JWKS URL, and every permitted Deep Linking return origin. Register them with the operator API:

```bash
curl --fail-with-body \
  --request POST \
  --header "Authorization: Bearer $OPENROUND_ADMIN_TOKEN" \
  --header "Content-Type: application/json" \
  --data '{
    "name": "Example LMS production",
    "issuer": "https://lms.example.edu",
    "clientId": "openround-client-id",
    "deploymentId": "deployment-id",
    "authorizationEndpoint": "https://lms.example.edu/api/lti/authorize",
    "tokenEndpoint": "https://lms.example.edu/login/oauth2/token",
    "jwksUrl": "https://lms.example.edu/api/lti/security/jwks",
    "deepLinkReturnOrigins": ["https://lms.example.edu"],
    "status": "active"
  }' \
  "$OPENROUND_API_URL/v1/admin/workspaces/$OPENROUND_WORKSPACE_ID/lti-registrations"
```

An instructor's first verified LMS launch opens an explicit account-link page. The raw link token
travels in the URL fragment, is moved to tab-scoped storage, and is never matched by email. Later
launches issue the normal creator cookie. A Deep Linking launch lets an owner or editor choose one
published checkpoint set and posts a signed `JWT` response to the registered LMS return origin.
Completing the same launch twice returns the original signed response.

Resource-link launches support instructors and a published `openround_quiz_id`. Learner launches
are rejected in this release. Use Polling Pops’ anonymous live-round link or QR for participants;
do not enable institution identity, NRPS, or AGS based only on these instructor flows.

## 4. Audit and residency evidence

The Account screen displays the workspace's immutable home-region assignment. Polling Pops never
moves an existing workspace automatically. A deployment still needs infrastructure evidence that
database, object storage, cache, telemetry, backups, and processors obey that assignment.

When `auditExports` is approved, an owner can download versioned JSON from Account or call:

```bash
curl --fail-with-body \
  --cookie "$OPENROUND_CREATOR_COOKIE" \
  "$OPENROUND_API_URL/v1/workspace/audit-export?since=2026-01-01T00:00:00Z"
```

The export is ordered, labels the home region, excludes bearer secrets, and contains up to 10,000
events. `range.truncated=true` means the operator must request a narrower `since` interval. The
export action itself is appended to the audit trail after the exported snapshot.

`AUDIT_RETENTION_DAYS` controls scheduled deletion of audit events and defaults to 365 days. Set
the contract-approved value before pilot data is created; the supported range is 30–3,650 days.
Changing it affects future retention runs and does not restore already-purged events.

## Pilot and production gates

Before an institution pilot, complete all of the following:

- Confirm issuer/client/deployment values and key rotation in a non-production LMS tenant.
- Test first-link, repeat login, revocation, removed membership, state replay, nonce failure,
  wrong audience, wrong deployment, disabled registration, and unregistered return origin.
- Verify Deep Linking in every supported LMS and retain vendor/version evidence. Passing unit tests
  is not 1EdTech certification.
- Keep platform and tool private keys in separate secret-management and rotation workflows.
- Set and test the contract-approved `AUDIT_RETENTION_DAYS` value, then verify both export and
  scheduled purge behavior in the target region.
- Complete DPA, subprocessor, residency, incident, retention, accessibility, support, and legal
  review for the exact deployment.
- Leave K–12, learner identity, NRPS, and AGS off until their implementation and counsel gates pass.

The protocol implementation follows the 1EdTech LTI 1.3 implementation and Deep Linking models,
but external conformance testing and each LMS's interoperability testing remain release evidence,
not repository claims.
