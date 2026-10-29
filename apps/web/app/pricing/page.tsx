import Link from "next/link";
import { SiteFooter } from "../../components/site-footer";
import { SiteHeader } from "../../components/site-header";
import styles from "./pricing.module.css";

export const metadata = { title: "Pricing" };

export default function PricingPage() {
  return (
    <>
      <SiteHeader />
      <main className="shell page-main" id="main" lang="en-CA">
        <div className="section-heading">
          <p className="eyebrow">Plans and pricing</p>
          <h1 style={{ fontSize: "clamp(2.8rem, 7vw, 5.4rem)" }}>
            Start free. Plan for growing audiences.
          </h1>
          <p className="lead">
            Self-hosting remains free under Apache 2.0. Hosted plans cover operations and support.
          </p>
        </div>
        <div className={`pricing-grid ${styles.plans}`}>
          <article className="card">
            <span className="status-pill">Free · Personal</span>
            <h2 style={{ marginTop: 28 }}>$0</h2>
            <p>
              Your own personal workspace. Hosted Free: 20 participants, five published checkpoint
              sets, the complete Recovery Loop and Q&A, aggregate 30-day reports, and three
              authoring jobs monthly when enabled.
            </p>
            <Link className="button-quiet" href="/signin?mode=signup&accountType=personal">
              Create an account
            </Link>
          </article>
          <article className="card">
            <span className="status-pill">Pro · Personal</span>
            <h2 style={{ marginTop: 28 }}>Pricing will be announced</h2>
            <p>
              A paid plan for your personal workspace. Hosted Pro: 100 participants, unlimited
              checkpoint sets, cohosting, CSV/JSON/QTI, accountless follow-up, 100 authoring jobs,
              365-day reports, and one contrast-checked workspace theme.
            </p>
            <Link className="button" href="/account#plan">
              Manage personal plan
            </Link>
          </article>
          <article className="card">
            <span className="status-pill">Team · Organization</span>
            <h2 style={{ marginTop: 28 }}>Pricing will be announced</h2>
            <p>
              For companies and businesses. Organization administrators manage user licenses and
              roles. Each licensed person receives a separate organization-owned workspace, with
              organization billing and access management. Personal workspaces stay separate.
            </p>
            <Link className="button-quiet" href="/account/setup?type=organization">
              Set up an organization
            </Link>
          </article>
        </div>
        <p className="notice" style={{ marginTop: 28 }}>
          Hosted pricing will be announced after review. Personal users manage Pro from Plan and
          usage. Organization billing administrators can review organization offers when published.
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
