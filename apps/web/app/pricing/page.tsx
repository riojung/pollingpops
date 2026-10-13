import Link from "next/link";
import { SiteFooter } from "../../components/site-footer";
import { SiteHeader } from "../../components/site-header";

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
        <div className="pricing-grid">
          <article className="card">
            <span className="status-pill">Free</span>
            <h2 style={{ marginTop: 28 }}>$0</h2>
            <p>
              Hosted Free: 20 participants, five published checkpoint sets, the complete Recovery
              Loop and Q&A, aggregate 30-day reports, and three authoring jobs monthly when enabled.
            </p>
            <Link className="button-quiet" href="/signin">
              Create an account
            </Link>
          </article>
          <article className="card">
            <span className="status-pill">Pro</span>
            <h2 style={{ marginTop: 28 }}>Pricing will be announced</h2>
            <p>
              Hosted Pro: 100 participants, unlimited checkpoint sets, cohosting, CSV/JSON/QTI,
              accountless follow-up, 100 authoring jobs, 365-day reports, and one contrast-checked
              workspace theme.
            </p>
            <Link className="button" href="/organization">
              Organization billing
            </Link>
          </article>
        </div>
        <p className="notice" style={{ marginTop: 28 }}>
          Hosted pricing will be announced after review. Signed-in organization billing
          administrators can review offers when they are published.
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
