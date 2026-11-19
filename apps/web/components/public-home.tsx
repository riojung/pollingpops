import { PublicHomeHero } from "./public-home-hero";
import { PublicProductDemo } from "./public-product-demo";
import { PublicCreatorLink } from "./public-creator-link";
import { PUBLIC_PRODUCT_CTA_HREF } from "../lib/public-product-content";
import styles from "./public-home.module.css";

const products = [
  {
    title: "Live polls",
    href: "/product/live-polls",
    mark: "01",
    copy: "Get a quick read on the room with choices, ratings, rankings, and open responses.",
    tag: "Hear every perspective",
  },
  {
    title: "Quizzes & learning Rounds",
    href: "/product/quizzes",
    mark: "02",
    copy: "Bring energy with scored questions and standings. Use explanations and linked rechecks to revisit a concept.",
    tag: "Make understanding visible",
  },
  {
    title: "Live Q&A",
    href: "/product/live-qa",
    mark: "03",
    copy: "Collect questions, let the audience vote, and give your facilitator tools to moderate and reply.",
    tag: "Make room for questions",
  },
  {
    title: "Interactive presentations",
    href: "/product/presentations",
    mark: "04",
    copy: "Build an editable deck, keep presenter notes private, and add audience checkpoints to the story.",
    tag: "Turn slides into conversations",
  },
  {
    title: "Surveys",
    href: "/product/surveys",
    mark: "05",
    copy: "Give people time to reflect with self-paced questions, saved progress, and aggregate feedback.",
    tag: "Listen beyond the live session",
  },
  {
    title: "Idea boards",
    href: "/product/idea-boards",
    mark: "06",
    copy: "Collect ideas on a shared canvas or guide the room through grouping and priority voting.",
    tag: "Find the next step together",
  },
];

const workflows = [
  [
    "01",
    "Start with a good question.",
    "Create a Round, build a presentation, or choose an original starter. Structured imports can help you bring existing questions.",
  ],
  [
    "02",
    "Invite the room in.",
    "Share a code, link, or QR code. Participants join in their browser without creating an account.",
  ],
  [
    "03",
    "Respond to what you hear.",
    "Reveal responses, explain a tricky idea, or choose an action together. Review the session evidence afterward.",
  ],
];

const solutions = [
  {
    title: "Team meetings",
    copy: "Check in, surface questions, and turn priorities into a shared conversation.",
    href: "/solutions/meetings",
    tag: "Make meetings count",
  },
  {
    title: "Teaching & education",
    copy: "Find the misconception, explain it, and use a linked recheck to see what changed.",
    href: "/solutions/education",
    tag: "See what clicks",
  },
  {
    title: "Training & onboarding",
    copy: "Connect guided presentations, knowledge checks, and follow-up practice.",
    href: "/solutions/training",
    tag: "Build a useful learning moment",
  },
  {
    title: "Events & all-hands",
    copy: "Invite questions, collect perspectives, and bring more voices into a large room.",
    href: "/solutions/events",
    tag: "Open up the conversation",
  },
];

export function PublicHome() {
  return (
    <div className={styles.home}>
      <div className={styles.container}>
        <PublicHomeHero />
      </div>
      <div lang="en-CA" dir="ltr">
        <section className={`${styles.section} ${styles.introBand}`}>
          <div className={styles.container}>
            <p>One workspace. More ways to bring people in.</p>
            <div className={styles.formatLinks}>
              <a href="/product/live-polls">Poll</a>
              <a href="/product/live-qa">Ask</a>
              <a href="/product/word-clouds">Reflect</a>
              <a href="/product/quizzes">Learn</a>
              <a href="/product/idea-boards">Create together</a>
            </div>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="product-heading">
          <div className={styles.container}>
            <div className={styles.headingRow}>
              <div>
                <p className={styles.eyebrow}>Built around participation</p>
                <h2 id="product-heading">
                  The right interaction.
                  <br />
                  At the right moment.
                </h2>
              </div>
              <a className={styles.textLink} href="/product">
                Explore the product <span aria-hidden="true">→</span>
              </a>
            </div>
            <div className={styles.productGrid}>
              {products.map((product) => (
                <a className={styles.productCard} href={product.href} key={product.href}>
                  <span className={styles.cardNumber}>{product.mark}</span>
                  <span className={styles.cardTag}>{product.tag}</span>
                  <h3>{product.title}</h3>
                  <p>{product.copy}</p>
                  <span className={styles.cardLink}>
                    Explore feature <span aria-hidden="true">↗</span>
                  </span>
                </a>
              ))}
            </div>
            <p className={styles.availability}>
              Features and limits depend on your plan and what your workspace has enabled. Each
              feature page explains its scope.
            </p>
          </div>
        </section>

        <section
          className={`${styles.section} ${styles.softSection}`}
          id="how-it-works"
          aria-labelledby="workflow-heading"
        >
          <div className={styles.container}>
            <div className={styles.centerHeading}>
              <p className={styles.eyebrow}>From first question to next step</p>
              <h2 id="workflow-heading">Less setup. More conversation.</h2>
            </div>
            <div className={styles.steps}>
              {workflows.map(([number, title, copy]) => (
                <article key={number}>
                  <span>{number}</span>
                  <h3>{title}</h3>
                  <p>{copy}</p>
                </article>
              ))}
            </div>
            <div className={styles.centerAction}>
              <a className={styles.primary} href="/examples">
                Find a starting point <span aria-hidden="true">→</span>
              </a>
              <a className={styles.textLink} href="/resources/getting-started">
                Read the getting started guide
              </a>
            </div>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="cloud-heading">
          <div className={`${styles.container} ${styles.split}`}>
            <div>
              <p className={styles.eyebrow}>A shared picture, taking shape</p>
              <h2 id="cloud-heading">
                Small contributions.
                <br />A bigger conversation.
              </h2>
              <p className={styles.bodyLead}>
                A word cloud brings the room’s short phrases together. Common phrases grow as more
                people contribute, so the shared themes become easier to spot.
              </p>
              <ul className={styles.checklist}>
                <li>Keep short phrases together.</li>
                <li>Choose live collection or review before display.</li>
                <li>Watch the cloud grow as responses arrive.</li>
              </ul>
              <a className={styles.textLink} href="/product/word-clouds">
                See how word clouds work <span aria-hidden="true">→</span>
              </a>
            </div>
            <PublicProductDemo kind="word-cloud" label="Growing word cloud example" />
          </div>
        </section>

        <section
          className={`${styles.section} ${styles.evidenceSection}`}
          aria-labelledby="evidence-heading"
        >
          <div className={`${styles.container} ${styles.split}`}>
            <PublicProductDemo kind="report" label="Linked recheck report example" />
            <div>
              <p className={styles.eyebrow}>Go beyond the first answer</p>
              <h2 id="evidence-heading">
                Notice confusion.
                <br />
                Help. Check again.
              </h2>
              <p className={styles.bodyLead}>
                A learning Round can link an initial question to a recheck. Explain the idea, try a
                different approach, then review the paired responses in your report.
              </p>
              <p className={styles.bodyLead}>
                See participation, question results, and recorded interventions with the context
                needed to interpret them.
              </p>
              <p className={styles.evidenceNote}>
                Session evidence shows what happened in that session. It does not prove lasting
                learning or that an intervention caused a change.
              </p>
              <a className={styles.textLink} href="/product/reports">
                Explore reports & rechecks <span aria-hidden="true">→</span>
              </a>
            </div>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="solutions-heading">
          <div className={styles.container}>
            <div className={styles.headingRow}>
              <div>
                <p className={styles.eyebrow}>Built for the room you’re in</p>
                <h2 id="solutions-heading">A better way to involve everyone.</h2>
              </div>
              <a className={styles.textLink} href="/solutions">
                All use cases <span aria-hidden="true">→</span>
              </a>
            </div>
            <div className={styles.solutions}>
              {solutions.map((solution) => (
                <a href={solution.href} className={styles.solution} key={solution.href}>
                  <span>{solution.tag}</span>
                  <h3>{solution.title}</h3>
                  <p>{solution.copy}</p>
                  <b aria-hidden="true">↗</b>
                </a>
              ))}
            </div>
          </div>
        </section>

        <section
          className={`${styles.section} ${styles.softSection}`}
          aria-labelledby="continuity-heading"
        >
          <div className={styles.container}>
            <div className={styles.centerHeading}>
              <p className={styles.eyebrow}>Before, during, and after</p>
              <h2 id="continuity-heading">Keep the useful work going.</h2>
            </div>
            <div className={styles.continuityGrid}>
              <article>
                <span className={styles.smallMark} aria-hidden="true">
                  ↗
                </span>
                <h3>A starting point worth sharing.</h3>
                <p>
                  Browse original examples before signing in. Shared library publications give
                  groups a stable starting point and creators an independent draft.
                </p>
                <a className={styles.textLink} href="/product/collaboration">
                  Explore shared content →
                </a>
              </article>
              <article>
                <span className={styles.smallMark} aria-hidden="true">
                  ✓
                </span>
                <h3>A next step people can practise.</h3>
                <p>
                  Create a practice assignment from a published Round. Share private or generic
                  links for account-free practice at the learner’s own pace.
                </p>
                <a className={styles.textLink} href="/product/assignments">
                  Explore practice assignments →
                </a>
              </article>
              <article>
                <span className={styles.smallMark} aria-hidden="true">
                  ◇
                </span>
                <h3>Clear choices about your data.</h3>
                <p>
                  Understand participant identity, moderation, report access, and retention before
                  you run a session. Read the current plan limits and deployment guidance.
                </p>
                <a className={styles.textLink} href="/resources/data-and-access-controls">
                  Explore data controls →
                </a>
              </article>
            </div>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="faq-heading">
          <div className={`${styles.container} ${styles.faqLayout}`}>
            <div>
              <p className={styles.eyebrow}>A few useful answers</p>
              <h2 id="faq-heading">Ready for your next conversation?</h2>
              <a className={styles.textLink} href="/resources">
                Visit resources <span aria-hidden="true">→</span>
              </a>
            </div>
            <div className={styles.faqs}>
              <details>
                <summary>Do participants need an account?</summary>
                <p>
                  No. Participants can join a live session in their browser using a code, link, or
                  QR code. The host may require an alias or other entry settings for the session.
                </p>
              </details>
              <details>
                <summary>Is Polling Pops only for quizzes?</summary>
                <p>
                  No. Use live polls, Q&A, word clouds, presentations, surveys, and idea boards for
                  discussions and feedback. Scored learning questions and standings are available
                  when a quiz fits the moment.
                </p>
              </details>
              <details>
                <summary>Can I try an example before signing up?</summary>
                <p>
                  Yes. Explore the sample interactions here or{" "}
                  <a href="/examples">browse the public examples</a>. To create and run your own
                  content, open a creator account.
                </p>
              </details>
              <details>
                <summary>What is included in my workspace?</summary>
                <p>
                  Available formats, capacity, exports, AI assistance, and other tools depend on the
                  plan and workspace settings. <a href="/pricing">View current plans and limits</a>{" "}
                  or read a feature page for its availability details.
                </p>
              </details>
            </div>
          </div>
        </section>

        <section className={styles.finalSection}>
          <div className={`${styles.container} ${styles.finalCard}`}>
            <p className={styles.eyebrow}>Make every voice pop.</p>
            <h2>
              Your next great conversation
              <br />
              starts with one question.
            </h2>
            <div className={styles.centerAction}>
              <PublicCreatorLink className={styles.primary} href={PUBLIC_PRODUCT_CTA_HREF}>
                Start creating <span aria-hidden="true">→</span>
              </PublicCreatorLink>
              <a className={styles.secondary} href="/examples">
                Explore examples
              </a>
            </div>
            <p>Create an account to build your own. No account needed to join.</p>
          </div>
        </section>
      </div>
    </div>
  );
}
