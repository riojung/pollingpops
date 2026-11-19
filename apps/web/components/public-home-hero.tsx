"use client";

import { useState } from "react";
import { HomeCreatorActions } from "./home-creator-actions";
import { useLocale } from "./locale-provider";
import { PublicProductDemo, type PublicProductDemoKind } from "./public-product-demo";
import styles from "./public-home.module.css";

const examples: { kind: PublicProductDemoKind; title: string; href: string }[] = [
  { kind: "poll", title: "Live poll", href: "/product/live-polls" },
  { kind: "word-cloud", title: "Word cloud", href: "/product/word-clouds" },
  { kind: "quiz", title: "Quiz", href: "/product/quizzes" },
];

export function PublicHomeHero() {
  const { t } = useLocale();
  const [active, setActive] = useState(0);
  const example = examples[active] ?? examples[0]!;
  return (
    <section className={styles.hero}>
      <div className={styles.heroCopy}>
        <p className={styles.eyebrow}>{t("delivery.landing.eyebrow")}</p>
        <h1>{t("delivery.landing.title")}</h1>
        <p className={styles.lead}>{t("delivery.landing.description")}</p>
        <HomeCreatorActions />
        <ul className={styles.benefits} aria-label={t("delivery.landing.featuresLabel")}>
          <li>{t("delivery.landing.polls")}</li>
          <li>{t("delivery.landing.presentations")}</li>
          <li>{t("delivery.landing.learning")}</li>
        </ul>
      </div>
      <div className={styles.heroExample} lang="en-CA" dir="ltr">
        <div className={styles.exampleTabs} role="group" aria-label="Choose a product example">
          {examples.map((item, index) => (
            <button
              type="button"
              key={item.kind}
              aria-pressed={active === index}
              onClick={() => setActive(index)}
            >
              {item.title}
            </button>
          ))}
        </div>
        <PublicProductDemo
          key={example.kind}
          kind={example.kind}
          label={`${example.title} example`}
        />
        <a className={styles.exampleLink} href={example.href}>
          Explore {example.title.toLowerCase()}s <span aria-hidden="true">→</span>
        </a>
      </div>
    </section>
  );
}
