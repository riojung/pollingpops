import { SiteFooter } from "../../components/site-footer";
import { SiteHeader } from "../../components/site-header";

export const metadata = { title: "Privacy" };

export default function PrivacyPage() {
  return (
    <>
      <SiteHeader />
      <main className="shell page-main legal-copy" id="main" lang="en-CA">
        <p className="eyebrow">Draft for legal review</p>
        <h1 style={{ fontSize: "clamp(2.8rem, 7vw, 5rem)" }}>Privacy notice</h1>
        <p>
          <strong>Launch posture.</strong> Polling Pops minimizes participant data and keeps
          Canadian hosted data in the selected Canadian region. This draft must be reviewed before
          public or school use.
        </p>
        <h2>Guest participation</h2>
        <p>
          Participants use a session-scoped nickname and opaque resume token. Polling Pops does not
          create participant accounts, build cross-session profiles, sell participant data, or use
          it for advertising.
        </p>
        <h2>Self-paced Survey beta</h2>
        <p>
          Surveys do not request participant accounts or aliases. A room-only credential is stored
          in your browser for saved progress and a hash is stored server-side with draft/final
          responses. Organizers receive question-level results, not linked respondent answers.
          Distributions are hidden below five submitted respondents. One completion per credential
          is enforced, not verified one-person participation. Clearing site data loses resume
          access. Survey responses and retry receipts are removed with the run's deletion or
          retention deadline.
        </p>
        <h2>Other data used</h2>
        <p>
          We process creator email, checkpoint-set content, session settings, participant nicknames,
          submitted responses, optional confidence, interventions, Q&A, follow-up attempts, scores,
          limited security logs, consent records, and billing status where applicable.
        </p>
        <h2>Optional authoring assistant</h2>
        <p>
          When a deployment enables source-grounded authoring, a creator may submit pasted text or a
          private document to the configured model provider. Live participant responses, session
          data, reports, and Q&A are not included in those prompts. The deployment operator must
          identify the provider, processing location, retention, and contract terms before use.
        </p>
        <h2>Optional institution integrations</h2>
        <p>
          In an approved institution workspace, a creator may explicitly link an identity-provider
          or LMS subject to an existing Polling Pops account. We do not link accounts by matching
          email addresses. Instructor OIDC/LTI does not identify live participants; learner launch,
          roster access, and grade passback remain disabled in this release.
        </p>
        <h2>Learning mode</h2>
        <p>
          Learning mode is accountless and session-scoped: it does not create a persistent learner
          profile or connect activity across sessions. Participation is pseudonymous rather than
          fully anonymous because the facilitator can see the alias chosen or assigned for that
          session. What other participants can see is controlled separately by the session&apos;s
          result and identity-visibility settings.
        </p>
        <h2>Retention and control</h2>
        <p>
          Hosted Free session reports expire after 30 days. Pro defaults to 365 days. Creators can
          delete sessions earlier, export account data, or delete their account.
        </p>
        <h2>Schools</h2>
        <p>
          Students must use accountless Learning mode. Institutional use requires an approved
          agreement and applicable privacy review. No direct child account is offered.
        </p>
        <h2>Contact</h2>
        <p>
          Configure a monitored privacy and security contact before release. Do not publish this
          placeholder unchanged.
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
