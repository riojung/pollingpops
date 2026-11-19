"use client";

import Link from "next/link";
import { useState } from "react";
import {
  filterPublicExamples,
  findPublicExample,
  publicExampleContinueHref,
  publicExampleKinds,
  publicExampleUseCases,
  type PublicExample,
  type PublicExampleKind,
  type PublicExampleUseCase,
} from "../lib/public-examples";
import { LollipopMark } from "./lollipop-mark";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";
import { PublicCreatorLink } from "./public-creator-link";
import styles from "./public-examples-page.module.css";

const blockLabels = {
  poll: "Poll",
  rating: "Rating",
  quiz: "Knowledge check",
  slide: "Content slide",
  board: "Canvas section",
};

export function PublicExamplePreview({ example }: { example: PublicExample }) {
  return (
    <article className={styles.preview} id="public-example-preview" aria-labelledby="example-title">
      <div className={styles.previewIntro}>
        <p className={styles.eyebrow}>{publicExampleKinds[example.kind]} preview · English</p>
        <h2 id="example-title">{example.title}</h2>
        <p>{example.summary}</p>
        <div className={styles.meta}>
          <span>
            {example.preview.length}{" "}
            {example.kind === "presentation"
              ? "blocks"
              : example.kind === "board"
                ? "sections"
                : "questions"}
          </span>
          <span>About {example.guide.minutes} minutes</span>
          <span>Read-only preview</span>
        </div>
        <PublicCreatorLink className={styles.primary} href={publicExampleContinueHref(example)}>
          {example.kind === "board" ? "Open board starters" : "Open in Templates"}
          <span aria-hidden="true">↗</span>
        </PublicCreatorLink>
        <p className={styles.caption}>
          {example.kind === "board"
            ? `Open board starters, signing in if needed. In New board, choose ${example.title} and review its setup before creating.`
            : "Open this original in Templates, signing in if needed. Choose Use there to create your own editable draft. Availability depends on your workspace."}
        </p>
      </div>
      <div className={styles.blocks} aria-label="Example content">
        {example.preview.map((block, index) => (
          <section className={styles.block} key={`${index}-${block.title}`}>
            <p className={styles.blockLabel}>
              <span>{String(index + 1).padStart(2, "0")}</span> {blockLabels[block.kind]}
            </p>
            <h3>{block.title}</h3>
            {block.body ? <p>{block.body}</p> : null}
            {block.options ? (
              <ul className={styles.options}>
                {block.options.map((option) => (
                  <li key={option}>{option}</li>
                ))}
              </ul>
            ) : null}
            {block.note ? <p className={styles.blockNote}>{block.note}</p> : null}
          </section>
        ))}
      </div>
      <section className={styles.guide} aria-labelledby="example-guide-title">
        <p className={styles.eyebrow}>Make it your own</p>
        <h3 id="example-guide-title">A little preparation goes a long way.</h3>
        <p>{example.guide.audience} Durations are planning estimates.</p>
        <dl>
          <div>
            <dt>Prepare</dt>
            <dd>{example.guide.preparation}</dd>
          </div>
          <div>
            <dt>Facilitate</dt>
            <dd>{example.guide.facilitation}</dd>
          </div>
          <div>
            <dt>Interpret</dt>
            <dd>{example.guide.interpretation}</dd>
          </div>
          <div>
            <dt>Follow up</dt>
            <dd>{example.guide.followUp}</dd>
          </div>
        </dl>
      </section>
    </article>
  );
}

export function PublicExamplesPage({
  initialExampleId,
  initialKind = "all",
  initialUseCase = "all",
}: {
  initialExampleId?: string;
  initialKind?: PublicExampleKind | "all";
  initialUseCase?: PublicExampleUseCase | "all";
} = {}) {
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<PublicExampleKind | "all">(initialKind);
  const [useCase, setUseCase] = useState<PublicExampleUseCase | "all">(initialUseCase);
  const [selectedId, setSelectedId] = useState(
    findPublicExample(initialExampleId)?.id ?? "meeting-priorities",
  );
  const examples = filterPublicExamples({ search, kind, useCase });
  const selected = examples.find((example) => example.id === selectedId) ?? examples[0];

  return (
    <>
      <SiteHeader />
      <main className={styles.page} id="main" lang="en-CA">
        <div className="shell">
          <header className={styles.hero}>
            <div>
              <p className={styles.eyebrow}>Original examples</p>
              <h1>
                A good starting point.
                <br />
                <span>Your next great Round.</span>
              </h1>
              <p className={styles.lead}>
                Explore real starter content for meetings, learning and shared ideas. Read the
                questions, see the structure and choose what fits your group.
              </p>
            </div>
            <div className={styles.heroMark} aria-hidden="true">
              <LollipopMark />
            </div>
          </header>
          <section className={styles.catalog} aria-label="Browse examples">
            <div className={styles.filters}>
              <label className={styles.search}>
                Search examples
                <input
                  type="search"
                  placeholder="Try decisions, feedback or learning"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
              <label>
                Format
                <select
                  value={kind}
                  onChange={(event) => setKind(event.target.value as PublicExampleKind | "all")}
                >
                  <option value="all">All formats</option>
                  {Object.entries(publicExampleKinds).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Use case
                <select
                  value={useCase}
                  onChange={(event) =>
                    setUseCase(event.target.value as PublicExampleUseCase | "all")
                  }
                >
                  <option value="all">All use cases</option>
                  {Object.entries(publicExampleUseCases).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className={styles.resultCount} role="status">
              {examples.length} {examples.length === 1 ? "example" : "examples"} · English originals
              · Previewing creates no content
            </p>
            {examples.length ? (
              <div className={styles.browser}>
                <label className={styles.mobilePicker}>
                  Choose an example
                  <select
                    value={selected?.id ?? ""}
                    aria-controls="public-example-preview"
                    onChange={(event) => setSelectedId(event.target.value)}
                  >
                    {examples.map((example) => (
                      <option key={example.id} value={example.id}>
                        {publicExampleKinds[example.kind]} · {example.title}
                      </option>
                    ))}
                  </select>
                </label>
                <div className={styles.cards} aria-label="Choose an example">
                  {examples.map((example) => (
                    <button
                      className={styles.card}
                      key={example.id}
                      type="button"
                      aria-pressed={selected?.id === example.id}
                      aria-controls="public-example-preview"
                      onClick={() => setSelectedId(example.id)}
                    >
                      <span className={styles.kind} data-kind={example.kind}>
                        {publicExampleKinds[example.kind]}
                      </span>
                      <strong>{example.title}</strong>
                      <span>{example.summary}</span>
                      <span className={styles.cardMeta}>
                        About {example.guide.minutes} min <span aria-hidden="true">↗</span>
                      </span>
                    </button>
                  ))}
                </div>
                {selected ? <PublicExamplePreview example={selected} /> : null}
              </div>
            ) : (
              <div className={styles.empty}>
                <h2>No examples match those filters.</h2>
                <p>Try another phrase or show the full collection.</p>
                <button
                  className={styles.primary}
                  type="button"
                  onClick={() => {
                    setSearch("");
                    setKind("all");
                    setUseCase("all");
                  }}
                >
                  Clear filters
                </button>
              </div>
            )}
          </section>
          <aside className={styles.next}>
            <div>
              <p className={styles.eyebrow}>Find your way</p>
              <h2>Ready for the room?</h2>
              <p>Get a practical walkthrough of creating, joining and understanding the results.</p>
            </div>
            <Link href="/resources">
              Explore the guides <span aria-hidden="true">→</span>
            </Link>
          </aside>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
