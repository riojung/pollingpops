"use client";

import Link from "next/link";
import { useState } from "react";
import { useWorkspace } from "../../components/workspace/workspace-provider";
import {
  filterHelpGuides,
  helpGuideAvailable,
  helpGuideTopics,
  type HelpGuideTopic,
} from "../../lib/help-feature-guides";
import { GuideCover } from "./guide-cover";
import styles from "./feature-guides.module.css";

export function FeatureGuideCatalog() {
  const { productFeatures } = useWorkspace();
  const [query, setQuery] = useState("");
  const [topic, setTopic] = useState<HelpGuideTopic | "all">("all");
  const guides = filterHelpGuides(query, topic);

  return (
    <section
      className={styles.catalog}
      id="feature-guides"
      lang="en-CA"
      aria-labelledby="feature-guides-title"
    >
      <header className={styles.sectionHeading}>
        <p className="eyebrow">Learn one feature at a time</p>
        <h2 id="feature-guides-title">Written feature guides</h2>
        <p>
          Choose a task, follow the steps, and try it in your workspace. Each guide includes
          prerequisites, a success check, and troubleshooting.
        </p>
        <p className={styles.languageNote}>
          These guides are currently written in English. Optional features are labelled; reading a
          guide does not enable a feature or change your permissions.
        </p>
      </header>
      <div className={styles.filters}>
        <div className={styles.field}>
          <label htmlFor="help-guide-search">Search guides</label>
          <input
            id="help-guide-search"
            type="search"
            placeholder="Try QR, confidence, chat, or practice"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className={styles.field}>
          <label htmlFor="help-guide-topic">Topic</label>
          <select
            id="help-guide-topic"
            value={topic}
            onChange={(event) => setTopic(event.target.value as HelpGuideTopic | "all")}
          >
            <option value="all">All topics</option>
            {Object.entries(helpGuideTopics).map(([key, name]) => (
              <option value={key} key={key}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <button
          className="button-quiet"
          type="button"
          onClick={() => {
            setQuery("");
            setTopic("all");
          }}
        >
          Clear filters
        </button>
      </div>
      <p className={styles.resultCount} role="status" aria-atomic="true">
        Guides found: {guides.length}
      </p>
      {guides.length ? (
        <div className={styles.grid}>
          {guides.map((guide) => (
            <Link
              className={styles.card}
              href={`/help/${guide.id}`}
              key={guide.id}
              prefetch={false}
            >
              <GuideCover guide={guide} />
              <div className={styles.cardBody}>
                <span className={styles.topic}>{helpGuideTopics[guide.topic]}</span>
                <h3 id={`guide-${guide.id}-title`}>{guide.title}</h3>
                <p>{guide.summary}</p>
                <div className={styles.cardMeta}>
                  <span>{guide.steps.length} steps</span>
                  {guide.requiredFeatures?.length ? (
                    <span
                      className={styles.badge}
                      data-unavailable={!helpGuideAvailable(guide, productFeatures) || undefined}
                    >
                      {helpGuideAvailable(guide, productFeatures)
                        ? "Optional feature enabled"
                        : "Not enabled here"}
                    </span>
                  ) : null}
                </div>
                <span className={styles.readLink}>
                  Read guide <span aria-hidden="true">→</span>
                </span>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className={styles.empty}>
          <h3>No guides match those filters</h3>
          <p>Try a feature name or clear the filters to browse every guide.</p>
        </div>
      )}
    </section>
  );
}
