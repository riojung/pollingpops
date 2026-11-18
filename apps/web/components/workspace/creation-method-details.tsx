"use client";

import { creationMethodCopy, type CreationMethodKey } from "../../lib/i18n/creation-method-copy";
import { useLocale } from "../locale-provider";
import styles from "./creation-method-details.module.css";

export function CreationMethodDetails({ method }: { method: CreationMethodKey }) {
  const { locale } = useLocale();
  const copy = creationMethodCopy(locale);
  const explanation = copy.methods[method];
  return (
    <div className={styles.explanation} lang={locale} data-creation-method={method}>
      <dl className={styles.details}>
        <div>
          <dt>{copy.labels.input}</dt>
          <dd>{explanation.input}</dd>
        </div>
        <div>
          <dt>{copy.labels.assistance}</dt>
          <dd>{explanation.assistance}</dd>
        </div>
        <div>
          <dt>{copy.labels.nextStep}</dt>
          <dd>{explanation.nextStep}</dd>
        </div>
      </dl>
      {explanation.note ? <p className={styles.note}>{explanation.note}</p> : null}
    </div>
  );
}
