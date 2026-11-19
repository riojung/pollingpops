import Link from "next/link";
import type { ReactNode } from "react";
import {
  PUBLIC_PRODUCT_CTA_HREF,
  getPublicProductPage,
  publicProductNavigation,
  publicProductPages,
  publicSolutionPages,
  type PublicContentItem,
  type PublicFaq,
  type PublicProductPage,
  type PublicSolutionPage,
} from "../lib/public-product-content";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";
import { PublicProductDemo } from "./public-product-demo";
import { PublicCreatorLink } from "./public-creator-link";
import styles from "./public-product-pages.module.css";

function PageFrame({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <>
      <SiteHeader />
      <main className={styles.page} id="main" lang="en-CA">
        {children}
      </main>
      <SiteFooter />
    </>
  );
}

function Arrow() {
  return <span aria-hidden="true">↗</span>;
}

function Actions({ examplesHref = "/examples" }: Readonly<{ examplesHref?: string }>) {
  return (
    <div className={styles.actions}>
      <PublicCreatorLink className={styles.primaryAction} href={PUBLIC_PRODUCT_CTA_HREF}>
        Start creating <Arrow />
      </PublicCreatorLink>
      <Link className={styles.secondaryAction} href={examplesHref}>
        Explore examples <span aria-hidden="true">→</span>
      </Link>
    </div>
  );
}

function Workflow({
  title,
  steps,
}: Readonly<{ title: string; steps: readonly PublicContentItem[] }>) {
  return (
    <section aria-labelledby="workflow-title" className={styles.section} id="how-it-works">
      <div className={styles.sectionHeading}>
        <p className={styles.eyebrow}>How it works</p>
        <h2 id="workflow-title">{title}</h2>
      </div>
      <ol className={styles.steps}>
        {steps.map((step, index) => (
          <li key={step.title}>
            <span aria-hidden="true" className={styles.stepNumber}>
              0{index + 1}
            </span>
            <h3>{step.title}</h3>
            <p>{step.description}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function UseCases({ items }: Readonly<{ items: readonly PublicContentItem[] }>) {
  return (
    <section aria-labelledby="use-cases-title" className={styles.useCases}>
      <div className={styles.sectionHeading}>
        <p className={styles.eyebrow}>Put it to work</p>
        <h2 id="use-cases-title">Start with a real moment.</h2>
      </div>
      <div className={styles.useCaseGrid}>
        {items.map((item) => (
          <article key={item.title}>
            <span aria-hidden="true" className={styles.caseMark}>
              ↳
            </span>
            <h3>{item.title}</h3>
            <p>{item.description}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function Faqs({ faqs }: Readonly<{ faqs: readonly PublicFaq[] }>) {
  return (
    <section aria-labelledby="faq-title" className={`${styles.section} ${styles.faqSection}`}>
      <div className={styles.sectionHeading}>
        <p className={styles.eyebrow}>A few useful answers</p>
        <h2 id="faq-title">Before you start.</h2>
      </div>
      <div className={styles.faqs}>
        {faqs.map((faq) => (
          <details key={faq.question}>
            <summary>
              {faq.question}
              <span aria-hidden="true">+</span>
            </summary>
            <p>{faq.answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

function ClosingCta({ title, examplesHref }: Readonly<{ title: string; examplesHref?: string }>) {
  return (
    <section aria-labelledby="start-title" className={styles.closing}>
      <div>
        <p className={styles.eyebrow}>Your next session starts with a question.</p>
        <h2 id="start-title">{title}</h2>
        <p>Create an account, explore your workspace, and choose the format that fits.</p>
      </div>
      <Actions examplesHref={examplesHref} />
    </section>
  );
}

function ProductCard({ page }: Readonly<{ page: PublicProductPage }>) {
  return (
    <Link className={styles.productCard} href={`/product/${page.slug}`}>
      <span className={styles.cardTop}>
        <span>{page.group}</span>
        <Arrow />
      </span>
      <h3>{page.title}</h3>
      <p>{page.shortDescription}</p>
      <span className={styles.cardLink}>
        Explore {page.title.toLowerCase()} <span aria-hidden="true">→</span>
      </span>
    </Link>
  );
}

export function ProductOverviewPage() {
  const groups = [...new Set(publicProductPages.map((page) => page.group))];
  return (
    <PageFrame>
      <div className={styles.shell}>
        <section className={styles.hero}>
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>The Polling Pops toolkit</p>
            <h1>
              Good questions.
              <br />
              <span>More possibilities.</span>
            </h1>
            <p className={styles.lead}>
              Bring people into the conversation with polls, quizzes, word clouds, and Q&A. Build
              the story around them, then use the evidence to choose what happens next.
            </p>
            <Actions />
            <p className={styles.heroNote}>
              For live sessions, self-paced feedback, and the follow-through.
            </p>
          </div>
          <div className={styles.heroDemo}>
            <PublicProductDemo kind="poll" />
          </div>
        </section>
        <section aria-labelledby="product-index-title" className={styles.section}>
          <div className={styles.sectionHeading}>
            <p className={styles.eyebrow}>Find your format</p>
            <h2 id="product-index-title">One useful moment can lead to another.</h2>
            <p>
              Start with the response you need. Explore how each format works, when to use it, and
              which capabilities it requires.
            </p>
          </div>
          {groups.map((group) => (
            <div className={styles.productGroup} key={group}>
              <h3 className={styles.groupTitle}>{group}</h3>
              <div className={styles.productGrid}>
                {publicProductPages
                  .filter((page) => page.group === group)
                  .map((page) => (
                    <ProductCard key={page.slug} page={page} />
                  ))}
              </div>
            </div>
          ))}
        </section>
        <section aria-labelledby="connected-title" className={styles.connection}>
          <div>
            <p className={styles.eyebrow}>Connect the moments</p>
            <h2 id="connected-title">
              Ask. Respond.
              <br />
              Keep the next step close.
            </h2>
          </div>
          <div>
            <p>
              A live answer is a starting point. Explain an idea, invite another perspective, or use
              a supported recovery recheck. Then review the session and give people a useful next
              step.
            </p>
            <Link className={styles.textLink} href="/product/reports">
              Explore reports & the Recovery Loop <span aria-hidden="true">→</span>
            </Link>
            <p className={styles.finePrint}>
              Availability depends on your workspace's enabled capabilities, plan, and permissions.
              Each feature page explains the relevant boundaries.
            </p>
          </div>
        </section>
        <ClosingCta title="Make your next question count." />
      </div>
    </PageFrame>
  );
}

export function ProductFeaturePage({ page }: Readonly<{ page: PublicProductPage }>) {
  const related = page.relatedSlugs
    .map(getPublicProductPage)
    .filter((item): item is PublicProductPage => Boolean(item));
  return (
    <PageFrame>
      <div className={styles.shell}>
        <nav aria-label="Breadcrumb" className={styles.breadcrumb}>
          <Link href="/product">Product</Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page">{page.title}</span>
        </nav>
        <section className={styles.hero}>
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>{page.title}</p>
            <h1>{page.outcome}</h1>
            <p className={styles.lead}>{page.description}</p>
            <Actions examplesHref={page.examplesHref} />
            <ul aria-label={`${page.title} highlights`} className={styles.benefits}>
              {page.benefits.map((benefit) => (
                <li key={benefit}>
                  <span aria-hidden="true">✓</span>
                  {benefit}
                </li>
              ))}
            </ul>
          </div>
          <div className={styles.heroDemo}>
            <PublicProductDemo kind={page.demoKind} />
          </div>
        </section>
        <p className={styles.availability}>
          <strong>Availability</strong>
          <span>{page.availability}</span>
          <Link href="/pricing">
            View plans <span aria-hidden="true">→</span>
          </Link>
        </p>
        <Workflow steps={page.steps} title={page.workflowTitle} />
        <section
          aria-labelledby="details-title"
          className={`${styles.section} ${styles.detailSection}`}
        >
          <div className={styles.detailHeading}>
            <p className={styles.eyebrow}>A closer look</p>
            <h2 id="details-title">{page.detailTitle}</h2>
            <Link className={styles.textLink} href={page.examplesHref}>
              Find an original starting point <span aria-hidden="true">→</span>
            </Link>
          </div>
          <div className={styles.details}>
            {page.details.map((detail, index) => (
              <article key={detail.title}>
                <span aria-hidden="true" className={styles.detailNumber}>
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div>
                  <h3>{detail.title}</h3>
                  <p>{detail.description}</p>
                </div>
              </article>
            ))}
          </div>
        </section>
        <UseCases items={page.useCases} />
        <Faqs faqs={page.faqs} />
        <section aria-labelledby="related-title" className={styles.section}>
          <div className={styles.rowHeading}>
            <h2 id="related-title">Keep exploring.</h2>
            <Link className={styles.textLink} href="/product">
              All features <span aria-hidden="true">→</span>
            </Link>
          </div>
          <div className={styles.productGrid}>
            {related.map((item) => (
              <ProductCard key={item.slug} page={item} />
            ))}
          </div>
        </section>
        <ClosingCta examplesHref={page.examplesHref} title="Bring your next idea to the room." />
      </div>
    </PageFrame>
  );
}

export function SolutionsOverviewPage() {
  return (
    <PageFrame>
      <div className={styles.shell}>
        <section className={`${styles.hero} ${styles.solutionHero}`}>
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>Made for your next gathering</p>
            <h1>
              Different rooms.
              <br />
              <span>A place for every voice.</span>
            </h1>
            <p className={styles.lead}>
              A team meeting, a class, a workshop, or an event. Choose a few purposeful interactions
              and leave time to respond to what people share.
            </p>
            <Actions />
          </div>
          <div className={styles.heroDemo}>
            <PublicProductDemo kind="word-cloud" />
          </div>
        </section>
        <section aria-labelledby="solutions-title" className={styles.section}>
          <div className={styles.sectionHeading}>
            <p className={styles.eyebrow}>Find your moment</p>
            <h2 id="solutions-title">What are you bringing people together for?</h2>
          </div>
          <div className={styles.solutionGrid}>
            {publicSolutionPages.map((page, index) => (
              <Link
                className={styles.solutionCard}
                href={`/solutions/${page.slug}`}
                key={page.slug}
              >
                <span aria-hidden="true" className={styles.solutionNumber}>
                  0{index + 1}
                </span>
                <div>
                  <h3>{page.title}</h3>
                  <p>{page.shortDescription}</p>
                  <span className={styles.cardLink}>
                    Explore the workflow <span aria-hidden="true">→</span>
                  </span>
                </div>
                <Arrow />
              </Link>
            ))}
          </div>
        </section>
        <Workflow
          title="Build a session around three useful moments."
          steps={[
            {
              title: "Hear the starting point",
              description:
                "Ask an opinion, check a concept, or invite a short phrase before you decide how to begin.",
            },
            {
              title: "Respond while it matters",
              description:
                "Explain, discuss, answer questions, or collect ideas. Let the audience's contribution change what you do next.",
            },
            {
              title: "Give the next step a home",
              description:
                "Review the evidence, offer eligible practice, or collect a self-paced reflection after the session.",
            },
          ]}
        />
        <ClosingCta title="Start with the moment you want to make." />
      </div>
    </PageFrame>
  );
}

export function SolutionDetailPage({ page }: Readonly<{ page: PublicSolutionPage }>) {
  const features = page.featureSlugs
    .map(getPublicProductPage)
    .filter((item): item is PublicProductPage => Boolean(item));
  return (
    <PageFrame>
      <div className={styles.shell}>
        <nav aria-label="Breadcrumb" className={styles.breadcrumb}>
          <Link href="/solutions">Solutions</Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page">{page.title}</span>
        </nav>
        <section className={styles.hero}>
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>{page.title}</p>
            <h1>{page.outcome}</h1>
            <p className={styles.lead}>{page.description}</p>
            <Actions examplesHref={page.examplesHref} />
          </div>
          <div className={styles.heroDemo}>
            <PublicProductDemo kind={page.demoKind} />
          </div>
        </section>
        <Workflow steps={page.steps} title={page.workflowTitle} />
        <UseCases items={page.useCases} />
        <section aria-labelledby="formats-title" className={styles.section}>
          <div className={styles.sectionHeading}>
            <p className={styles.eyebrow}>Choose your tools</p>
            <h2 id="formats-title">A format for each part of the session.</h2>
            <p>Explore the supported workflow and availability before choosing what to use.</p>
          </div>
          <div className={styles.productGrid}>
            {features.map((feature) => (
              <ProductCard key={feature.slug} page={feature} />
            ))}
          </div>
        </section>
        <aside className={styles.takeaway}>
          <span aria-hidden="true">↳</span>
          <p>{page.takeaway}</p>
        </aside>
        <Faqs faqs={page.faqs} />
        <ClosingCta
          examplesHref={page.examplesHref}
          title="Make space for a better next session."
        />
      </div>
    </PageFrame>
  );
}

export function PublicContentNotFound({ kind }: Readonly<{ kind: "product" | "solutions" }>) {
  return (
    <PageFrame>
      <div className={`${styles.shell} ${styles.notFound}`}>
        <p className={styles.eyebrow}>Let's find a useful starting point</p>
        <h1>That page is not here.</h1>
        <p>
          The link may have changed. Explore the{" "}
          {kind === "product"
            ? "available product features"
            : "meeting, teaching, training, and event workflows"}{" "}
          below.
        </p>
        <Link className={styles.primaryAction} href={`/${kind}`}>
          Explore {kind === "product" ? "the product" : "solutions"}{" "}
          <span aria-hidden="true">→</span>
        </Link>
        <nav aria-label="Explore product features" className={styles.recoveryLinks}>
          {publicProductNavigation.map((item) => (
            <Link href={item.href} key={item.slug}>
              {item.title}
            </Link>
          ))}
        </nav>
      </div>
    </PageFrame>
  );
}
