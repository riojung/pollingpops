import Link from "next/link";
import { publicResources, type PublicResource } from "../lib/public-resources";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";
import { PublicCreatorLink } from "./public-creator-link";
import styles from "./public-resources-page.module.css";

function ResourceCard({ resource, index }: { resource: PublicResource; index: number }) {
  return (
    <Link className={styles.card} href={`/resources/${resource.slug}`}>
      <div className={styles.cardTop}>
        <span>{resource.category}</span>
        <span>{String(index + 1).padStart(2, "0")}</span>
      </div>
      <h2>{resource.title}</h2>
      <p>{resource.summary}</p>
      <span className={styles.cardBottom}>
        {resource.minutes} min read <span aria-hidden="true">↗</span>
      </span>
    </Link>
  );
}

export function PublicResourcesPage() {
  return (
    <>
      <SiteHeader />
      <main className={styles.page} id="main" lang="en-CA">
        <div className="shell">
          <header className={styles.hero}>
            <p className={styles.eyebrow}>Resources</p>
            <h1>
              A little guidance.
              <br />
              <span>A more useful conversation.</span>
            </h1>
            <p>
              Practical guides for the people who lead the room and the people who join it. Start a
              Round, plan a recheck or make sense of the results.
            </p>
          </header>
          <section className={styles.grid} aria-label="Public guides">
            {publicResources.map((resource, index) => (
              <ResourceCard key={resource.slug} resource={resource} index={index} />
            ))}
          </section>
          <aside className={styles.bottom}>
            <div>
              <p className={styles.eyebrow}>Start with an example</p>
              <h2>See the questions before you create.</h2>
              <p>
                Browse original polls, decks, Surveys and board starters with read-only previews.
              </p>
            </div>
            <Link className={styles.primary} href="/examples">
              Explore examples <span aria-hidden="true">→</span>
            </Link>
          </aside>
          <nav className={styles.notices} aria-label="Service and policy information">
            <Link href="/privacy">Privacy notice</Link>
            <Link href="/terms">Terms</Link>
            <Link href="/status">Current status page</Link>
          </nav>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

export function PublicResourcePage({ resource }: { resource: PublicResource }) {
  return (
    <>
      <SiteHeader />
      <main className={styles.page} id="main" lang="en-CA">
        <div className="shell">
          <Link className={styles.back} href="/resources">
            ← All resources
          </Link>
          <header className={`${styles.hero} ${styles.articleHero}`}>
            <p className={styles.eyebrow}>
              {resource.category} · {resource.minutes} min read
            </p>
            <h1>{resource.title}</h1>
            <p>{resource.introduction}</p>
          </header>
          <div className={styles.articleLayout}>
            <article className={styles.article} aria-label={resource.title}>
              {resource.sections.map((section, index) => (
                <section key={section.title} id={`guide-section-${index + 1}`}>
                  <p className={styles.sectionNumber}>{String(index + 1).padStart(2, "0")}</p>
                  <h2>{section.title}</h2>
                  {section.paragraphs.map((paragraph) => (
                    <p key={paragraph}>{paragraph}</p>
                  ))}
                  {section.steps ? (
                    <ol>
                      {section.steps.map((step) => (
                        <li key={step}>{step}</li>
                      ))}
                    </ol>
                  ) : null}
                </section>
              ))}
            </article>
            <aside className={styles.sidebar} aria-label="Guide overview">
              <div className={styles.takeaway}>
                <p className={styles.eyebrow}>Keep in mind</p>
                <p>{resource.takeaway}</p>
              </div>
              <nav className={styles.contents} aria-label="In this guide">
                <h2>In this guide</h2>
                {resource.sections.map((section, index) => (
                  <a href={`#guide-section-${index + 1}`} key={section.title}>
                    {section.title}
                  </a>
                ))}
              </nav>
              <nav className={styles.related} aria-label="Continue exploring">
                <h2>Continue exploring</h2>
                {resource.links.map((link) => (
                  <PublicCreatorLink key={link.href} href={link.href}>
                    {link.label} <span aria-hidden="true">↗</span>
                  </PublicCreatorLink>
                ))}
              </nav>
            </aside>
          </div>
          <aside className={styles.bottom}>
            <div>
              <p className={styles.eyebrow}>Put it into practice</p>
              <h2>Start with something you can make your own.</h2>
              <p>
                Explore the original examples, including their questions and facilitator guidance.
              </p>
            </div>
            <Link className={styles.primary} href="/examples">
              Browse examples <span aria-hidden="true">→</span>
            </Link>
          </aside>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
