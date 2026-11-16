# Polling Pops deployment architecture guide

Polling Pops uses a **modular monolith deployed on one virtual machine**, supported by
external services. Its business features form one coordinated application, while separate
containers run the website, API, database and supporting tools.

This guide brings together the account checklist, provider boundaries and five diagrams for a
real deployment rehearsal. AWS EC2 is the selected hosted provider. The AWS production overlay
uses private S3 for live media; the generic single-VM profile retains MinIO. Cloudflare,
Resend, Better Stack and S3 in a separate backup account are the proposed supporting products.
These diagrams describe the intended connections; they do not establish that any account,
integration or environment has been provisioned.

Start with the disposable local AWS staging rehearsal, then complete hosted staging acceptance.
Hosted staging and production each need their own VM, credentials, database and live media. They
can use the same hosting provider account while remaining separate deployments. The repository's
new EC2/EBS/S3 foundation does not establish that either hosted environment has been provisioned.

## Contents

- [Products and architectural roles](#products-and-architectural-roles)
- [Account checklist in priority order](#account-checklist-in-priority-order)
- [Local rehearsal and AWS production path](#local-rehearsal-and-aws-production-path)
- [1. Overall product and account boundaries](#1-overall-product-and-account-boundaries)
- [2. Inside the AWS virtual machine](#2-inside-the-aws-virtual-machine)
- [3. From code to a running deployment](#3-from-code-to-a-running-deployment)
- [4. Email authentication and payments](#4-email-authentication-and-payments)
- [5. Monitoring and disaster recovery](#5-monitoring-and-disaster-recovery)
- [Environment and access boundaries](#environment-and-access-boundaries)
- [Operational references](#operational-references)

## Products and architectural roles

| Product                              | Architectural role                  | What it provides                                                            |
| ------------------------------------ | ----------------------------------- | --------------------------------------------------------------------------- |
| GitHub and GitHub Container Registry | Development and delivery            | Source code, independent review, automated checks and signed release images |
| AWS EC2 and EBS                      | Hosting infrastructure              | A Linux virtual machine and persistent disk for the running application     |
| AWS S3 in the hosting account        | Private live media                  | Quarantine and clean objects accessed through constrained signed URLs       |
| Cloudflare Registrar and DNS         | Domain and DNS                      | Domain ownership and lookup of the application's server address             |
| Resend                               | External email service              | Verification links and sign-in PIN delivery                                 |
| Better Stack                         | Observability and incident response | Logs, metrics, traces, external uptime checks and incident notifications    |
| Separate AWS account and S3          | Disaster recovery                   | Encrypted recovery copies outside the active server's account               |
| Stripe                               | External payment service            | Hosted checkout, subscriptions, billing portal and payment events           |

PostgreSQL, Valkey, ClamAV and Caddy run in the Docker stack. The AWS production overlay disables
MinIO and uses S3 through the VM's instance role; the generic single-VM profile retains MinIO.
The application is organized into presentation, application and data layers on one VM, with
private media in S3 for the AWS path shown below.

## Account checklist in priority order

- [ ] **1. GitHub:** reuse the existing account with administration access to
      `riojung/pollingpops`. Arrange a second human collaborator with their own account and repository
      write access for independent review. Configure the protected staging environment before the
      first signed-image build.
- [ ] **2. AWS hosting:** create or reuse an account with billing enabled, MFA and a budget alert.
      Prepare EC2 and EBS access. The documented starting host is Linux **amd64**, with **4 vCPUs,
      8 GB RAM and 100 GB SSD**. Launch it when the required deployment inputs are ready.
- [ ] **3. Cloudflare Registrar and DNS:** create an account and register an available domain,
      or use an existing domain and DNS provider. One domain can provide separate application and media
      subdomains for staging and production. The diagrams below use Cloudflare in DNS-only mode.
- [ ] **4. Resend:** create an account, verify the sending domain through DNS and create a dedicated
      API key for SMTP. Prepare a test inbox for verification links and sign-in PINs.
- [ ] **5. Better Stack:** create one account for Telemetry and Uptime/Incidents. Configure the
      telemetry source, separate host log shipping, uptime checks and distinct page, warning and ticket
      alert integrations. The readiness observer adapters also need provider-specific configuration.
- [ ] **6. AWS backup account and S3:** create a separately administered backup account and a private
      bucket with encryption, versioning and retention. Keep backup credentials and recovery keys
      outside the active application VM. Configure scheduled backup jobs and a clean-host restore drill.
- [ ] **7. Stripe:** create an account when billing testing begins and use its test environment
      first. Stripe can wait for the initial billing-disabled staging deployment. The unchanged
      production configuration and release gates require a real Stripe test-mode billing rehearsal;
      complete merchant and bank setup before accepting live payments.

Items 1–6 supply the accounts for the staging deployment and recovery exercises. Account creation
must be followed by configuration, integration and verification. Public production promotion also
requires the existing [release-readiness gates](release-readiness.json).

## Local rehearsal and AWS production path

`pnpm aws:staging build`, `start`, and `verify` run the real app, PostgreSQL, Valkey, ClamAV, and
Mailpit with official AWS Emulator S3 in an isolated local Compose project. Open exactly
`http://localhost:19180`; the local S3 gateway and email inbox use ports 19181 and 19182. Its
synthetic database/cache/media are disposable, and existing development volumes are separate.

The [AWS staging and production runbook](runbooks/aws-staging-production.md) describes the full
sequence: rehearse the exact protected production manifest with same-origin browser API routing,
retain the image/manifest-bound qualification receipt, prepare the real EC2/EBS/S3 foundation,
then promote through the existing signed-release and readiness gates. A local development
candidate cannot satisfy production promotion. Emulator tests cannot qualify IAM, AWS networking,
hardware, load, public-provider behavior, or clean-host recovery; hosted acceptance is still required.

## 1. Overall product and account boundaries

Each outer box represents a provider or account boundary. Solid arrows show application,
deployment or operational flows. The dotted arrow represents DNS lookup.

```mermaid
flowchart TB
    Users["Creators, hosts and participants"]
    Operator["You / deployment operator"]

    subgraph Cloudflare["Cloudflare account"]
        DNS["Domain registration + DNS<br/>Find the server's address"]
    end

    subgraph GitHub["GitHub account"]
        Releases["Source code, tests<br/>signed application images"]
    end

    subgraph Hosting["AWS hosting account"]
        App["EC2 virtual machine<br/>Polling Pops application + live data"]
    end

    subgraph Email["Resend account"]
        SMTP["Send verification links<br/>and sign-in PINs"]
    end

    subgraph Payments["Stripe account — later"]
        Stripe["Checkout, subscriptions<br/>payment events"]
    end

    subgraph Monitoring["Better Stack account"]
        Observe["Logs, metrics, traces<br/>uptime checks and alerts"]
    end

    subgraph Backup["Separate AWS backup account"]
        S3["S3<br/>Encrypted recovery copies"]
    end

    Users -.->|"DNS lookup via resolver"| DNS
    Users <-->|"HTTPS and live session connections"| App

    Releases -->|"Reviewed release"| Operator
    Operator -->|"Deploy over SSH"| App

    App -->|"Email through SMTP"| SMTP
    SMTP -->|"Deliver to inbox"| Users

    App <-->|"Checkout requests and signed events"| Stripe
    Users -->|"Pay on hosted checkout"| Stripe

    App -->|"Telemetry and alerts"| Observe
    Observe -->|"Notify responders"| Operator

    App -->|"Encrypted backup process"| S3
```

Cloudflare in **DNS-only mode** tells browsers where the server lives; browsers then connect
directly to AWS. Enabling Cloudflare's proxy would add Cloudflare to the web traffic path and
requires a separate reviewed ingress configuration. See
[Cloudflare proxy status](https://developers.cloudflare.com/dns/proxy-status/).

## 2. Inside the AWS virtual machine

EC2 is the rented computer. Docker Compose runs the components together on that computer.
Caddy is the public HTTPS entrance; the other services communicate over internal networks.

```mermaid
flowchart TB
    Browser["User's browser"]

    subgraph AWS["AWS hosting account"]
        subgraph VM["One EC2 VM — Docker Compose"]
            Caddy["Caddy<br/>Public HTTPS entrance + certificates"]

            subgraph Private["Internal services — no direct public access"]
                Web["Next.js<br/>Website and user interface"]
                API["Fastify + Socket.IO<br/>Authentication, rules and live sessions"]
                DB[("PostgreSQL<br/>Durable application data")]
                Cache[("Valkey<br/>Live coordination and temporary state")]
                Scan["ClamAV<br/>Uploaded-file malware scanning"]
            end

            Disk["EBS disk<br/>Persistent Docker volumes"]
        end
        Media[("AWS S3<br/>Private live media outside the VM")]
    end

    Browser <-->|"HTTPS"| Caddy
    Caddy -->|"Page requests"| Web
    Caddy <-->|"API requests and live events"| API
    Browser <-->|"Authorized short-lived S3 HTTPS transfers"| Media

    API <-->|"Read and write"| DB
    API <-->|"Coordinate sessions"| Cache
    API <-->|"Manage media"| Media
    API -->|"Scan before publishing"| Scan

    DB --- Disk
    Cache --- Disk
```

The three logical application layers are:

- **Presentation:** Next.js serves pages and the browser user interface.
- **Application:** Fastify owns authorization, business rules and API operations; Socket.IO
  carries live session updates.
- **Data:** PostgreSQL stores durable application records and AWS S3 stores private media.
  Valkey supports live coordination and is rebuildable.

PostgreSQL is the durable source of truth. The API authorizes media access and issues constrained,
short-lived upload or download URLs. Uploads enter S3 quarantine; the server validates and
scans the content before promoting clean files.

Caddy routes the app hostname to Next.js and the API. Browsers transfer media directly through
signed AWS S3 HTTPS URLs, and the API accesses the private bucket through its EC2 instance role.
Signed transfers do not make the bucket anonymous. Database, cache, scanning, metrics and
administration endpoints remain private. The generic single-VM profile instead routes a separate
media hostname through Caddy to MinIO.

All these containers share one VM and disk failure domain. Losing that VM interrupts the service;
container restart policies do not provide failover. The minimum host size is a starting point
that requires capacity testing on the actual target.

## 3. From code to a running deployment

GitHub prepares the release. The operator initiates deployment to AWS using the reviewed release
manifest and configuration.

```mermaid
flowchart TB
    Developer["Developer changes code"]
    Review["Another human reviews the change"]

    subgraph GitHub["GitHub — build and release boundary"]
        Main["Reviewed main branch"]
        Actions["GitHub Actions<br/>Test, build, scan and sign"]
        Registry["GitHub Container Registry<br/>Versioned application images"]
        Manifest["Signed release manifest<br/>Identifies exact images"]
    end

    Rehearsal["Local Docker rehearsal<br/>Exact app images + emulator S3"]
    Evidence["Manifest/image-bound local receipt<br/>Hosted acceptance remains required"]
    Operator["Operator runs promotion script<br/>with accepted release + approved configuration"]

    subgraph AWS["AWS — runtime boundary"]
        Deploy["EC2 pulls verified images<br/>and runs database migrations"]
        Compose["Docker Compose starts services"]
        Checks["Health and release checks"]
    end

    Developer --> Review --> Main
    Main --> Actions
    Actions --> Registry
    Actions --> Manifest
    Manifest --> Rehearsal --> Evidence --> Operator
    Operator -->|"SSH with verified host identity"| Deploy
    Registry -->|"Download exact image digests"| Deploy
    Deploy --> Compose --> Checks
```

This is the **CI/CD architecture**. Continuous integration checks changes; the controlled
deployment process installs a reviewed release. GitHub Actions signs release images using its
approved identity. GitHub Container Registry stores those images, so no separate container-registry
provider account is needed.

The AWS wrapper first verifies the local receipt and the real foundation, then delegates to the
existing deployment script over pinned SSH. A local receipt never substitutes for protected
release signatures or independent readiness acceptance. The diagram does not imply
that GitHub Actions automatically logs into the production server. Runtime database credentials
remain restricted; the one-shot migration receives separate elevated credentials.

Production adds the protected release-tag, signed-release and readiness acceptance requirements
in the [deployment runbook](runbooks/deployment.md).

## 4. Email authentication and payments

These are separate workflows. Both refer to the same Polling Pops API running on EC2.

```mermaid
flowchart TB
    subgraph Login["Creator sign-in flow"]
        L1["Creator requests a sign-in PIN"]
        L2["Polling Pops API creates PIN challenge"]
        L3["Resend delivers PIN email"]
        L4["Creator submits PIN to Polling Pops"]
        L5["API validates PIN<br/>and creates application session"]

        L1 --> L2 --> L3 --> L4 --> L5
    end

    subgraph Billing["Paid-plan flow — enabled later"]
        P1["Creator selects a paid plan"]
        P2["Polling Pops API creates Stripe checkout"]
        P3["Creator pays on Stripe"]
        P4["Stripe sends signed webhook<br/>to Polling Pops API"]
        P5["API verifies event<br/>and updates plan in PostgreSQL"]

        P1 --> P2 --> P3 --> P4 --> P5
    end
```

New creators first verify their email address through a separate verification link. Verification
establishes mailbox ownership; it does not sign them in. They then request a six-digit PIN to create
an application session. Participants can join sessions without creating accounts.

Resend delivers the messages through [SMTP](https://resend.com/docs/send-with-smtp); Polling Pops
owns identity verification, PIN validation and sessions. Domain verification records live in DNS.

Stripe owns checkout and payment processing; Polling Pops owns application permissions. Stripe
webhooks enter through Caddy. The API verifies their signatures and handles event identity and
ordering before changing entitlements. Returning to a browser success page does not itself grant
an upgrade. Billing can remain disabled during the initial staging exercise.

## 5. Monitoring and disaster recovery

Monitoring reports what is happening. Backups provide recoverable copies of durable data.

```mermaid
flowchart TB
    subgraph Hosting["AWS hosting account"]
        API["Polling Pops API"]

        Collector["OpenTelemetry Collector<br/>Metrics and traces"]
        Logs["Separate host log shipper<br/>Application logs"]
        Prometheus["Prometheus<br/>Scrape metrics and evaluate rules"]
        Alertmanager["Alertmanager<br/>Route alert notifications"]

        DB[("PostgreSQL")]
        Media[("AWS S3 live media<br/>Outside the active VM")]
    end

    subgraph Maintenance["Restricted maintenance environment"]
        Job["Backup process<br/>Dedicated credentials held outside source VM<br/>Export, verify and encrypt"]
    end

    subgraph BetterStack["Better Stack account"]
        Telemetry["Search logs, metrics and traces"]
        Incidents["Uptime monitoring<br/>and incident notifications"]
    end

    subgraph BackupAccount["Separate AWS backup account"]
        S3[("S3 encrypted backup sets")]
    end

    Responder["Named human responder"]
    Replacement["Clean replacement EC2 VM"]

    API -->|"Push traces"| Collector
    Collector -->|"Authenticated scrape /metrics"| API
    Collector -->|"Export metrics and traces"| Telemetry
    API --> Logs --> Telemetry
    Prometheus -->|"Authenticated scrape /metrics"| API
    Prometheus -->|"Forward firing alerts"| Alertmanager
    Alertmanager -->|"Page, warning and ticket routes"| Incidents
    Incidents -->|"External HTTPS checks"| API
    Incidents -->|"Notify"| Responder

    DB --> Job
    Media --> Job
    Job -->|"Copy off the active VM"| S3
    S3 -->|"Controlled restore using recovery keys"| Replacement
```

The API pushes traces to the private OpenTelemetry Collector. The collector and Prometheus each
initiate authenticated scrapes of the API's `/metrics` endpoint. The scrape arrows show request
initiation; metric responses travel back over those connections. Prometheus evaluates alert rules
and forwards firing alerts to Alertmanager, which routes page, warning and ticket notifications
to distinct receiver integrations. A separately managed host log shipper sends application logs;
the supplied telemetry overlay does not collect Docker logs itself. Better Stack also checks the
public HTTPS endpoint from outside the VM.

Better Stack supports the required [OpenTelemetry ingestion](https://betterstack.com/docs/logs/open-telemetry/)
and [Alertmanager webhooks](https://betterstack.com/docs/uptime/prometheus/). Configuring these
connections, log shipping, readiness observers and named responders remains deployment work.

The hosting account's private S3 bucket serves **live media** for the AWS overlay. The separately
administered backup account holds **recovery copies** of the PostgreSQL export and media,
including the metadata and tags required for recovery. The generic profile uses MinIO as its
live-media source. Backups must be encrypted, verified and retained outside the active deployment;
recovery keys must remain available outside it as well. A versioned live-media bucket in the
hosting account does not provide this separation.
The backup process runs from a restricted maintenance environment using dedicated source-read
identities and a separate destination-write identity. Backup credentials stay outside the source
VM and the backup payload; source access uses approved restricted connections.
[S3 versioning](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Versioning.html) helps retain
previous object versions, but a successful clean-host restore is the recovery exercise.

The replacement VM is a restore target, not an automatically running standby. The current
single-VM topology does not provide automatic failover or a high-availability guarantee.

## Environment and access boundaries

| Boundary                               | Rule                                                                                              |
| -------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Staging and production                 | Separate VMs, credentials, databases, media and Compose projects                                  |
| Internet and application               | App requests enter through Caddy; authorized media goes directly to private S3; SSH is restricted |
| Application and database               | The long-running application uses a restricted role; migrations use separate credentials          |
| Public media route and private storage | Short-lived authorized transfers; quarantine and scanning before publication                      |
| Hosting and backup accounts            | Separate administration and credentials, with encrypted off-host copies                           |
| Application and external providers     | Dedicated credentials for email, telemetry, alerts and payments                                   |
| Operator and independent reviewer      | A second human reviews the protected release path                                                 |

## Operational references

- [Architecture and protocol](architecture.md)
- [Single-VM hosting profile](../infra/single-vm/README.md)
- [Local AWS staging and production promotion](runbooks/aws-staging-production.md)
- [Pinned emulator distribution and compatibility notes](../infra/aws-emulator/README.md)
- [Beta release preparation](runbooks/beta-release-preparation.md)
- [Build, service and deployment runbook](runbooks/deployment.md)
- [Staging readiness and observer configuration](runbooks/staging-readiness.md)
- [Repository governance](runbooks/repository-governance.md)
- [Backup and restore](runbooks/backup-restore.md)
- [API reference including billing](api.md)
- [Production deployment configuration](../config/deploy/production.json)
- [Release-readiness ledger](release-readiness.json)
