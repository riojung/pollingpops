import { useLocale } from "./locale-provider";
import type { TextQuestionType } from "../lib/text-response";

export function TextResultsView({
  type,
  respondents,
  items = [],
  terms = [],
}: {
  type: TextQuestionType;
  respondents: number;
  items?: Array<{ answerId: string; body: string }>;
  terms?: Array<{ value: string; label: string; count: number }>;
}) {
  const { locale, t } = useLocale();
  const largest = Math.max(1, ...terms.map((term) => term.count));
  return (
    <div lang={locale}>
      <p>{t("live.text.approvedRespondents", { count: respondents })}</p>
      {type === "open_text" ? (
        <ul className="text-response-list">
          {items.map((item) => (
            <li key={item.answerId}>
              <p lang="">{item.body}</p>
            </li>
          ))}
        </ul>
      ) : (
        <>
          <div className="word-cloud" aria-hidden="true">
            {terms.map((term) => (
              <span
                key={term.value}
                lang=""
                style={{ fontSize: `${18 + 22 * Math.sqrt(term.count / largest)}px` }}
              >
                {term.label}
              </span>
            ))}
          </div>
          <div
            role="region"
            aria-label={t("live.text.wordCounts")}
            style={{ overflowX: "auto" }}
            tabIndex={0}
          >
            <table className="report-table">
              <caption>{t("live.text.wordCounts")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("live.text.term")}</th>
                  <th scope="col">{t("live.text.count")}</th>
                </tr>
              </thead>
              <tbody>
                {terms.map((term) => (
                  <tr key={term.value}>
                    <th scope="row" lang="">
                      {term.label}
                    </th>
                    <td>{term.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
