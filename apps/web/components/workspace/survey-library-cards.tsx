"use client";
import Link from "next/link";
import type { SurveyDraft } from "@openround/contracts/surveys";
import { useLocale } from "../locale-provider";
import type { RoundLibraryView } from "../../lib/round-library-view";
import styles from "../../app/library/library.module.css";

export function SurveyLibraryCards({
  surveys,
  folders,
  view,
  canEdit,
  canCreate,
  selectedIds,
  busy,
  onSelect,
  onFavorite,
  onAction,
}: {
  surveys: Array<{
    id: string;
    title: string;
    description: string;
    draft: SurveyDraft;
    status: "draft" | "published" | "archived";
    folderId: string | null;
    updatedAt?: string;
    favorite: boolean;
  }>;
  folders: Array<{ id: string; name: string }>;
  view: RoundLibraryView;
  canEdit: boolean;
  canCreate: boolean;
  selectedIds: Set<string>;
  busy: boolean;
  onSelect: (id: string) => void;
  onFavorite: (id: string) => void;
  onAction: (action: "duplicate" | "archive", id: string) => void;
}) {
  const { locale, t } = useLocale();
  return (
    <section className={styles.collection} data-view={view}>
      {surveys.map((survey) => {
        const archived = survey.status === "archived";
        const folder = folders.find((row) => row.id === survey.folderId)?.name;
        return (
          <article
            className={`${styles.card} ${selectedIds.has(survey.id) ? styles.cardSelected : ""}`}
            key={survey.id}
          >
            {canEdit ? (
              <label className={styles.cardSelector}>
                <input
                  type="checkbox"
                  aria-label={t("pages.library.selectItem", { title: survey.title })}
                  checked={selectedIds.has(survey.id)}
                  onChange={() => onSelect(survey.id)}
                />
              </label>
            ) : null}
            <button
              type="button"
              className={styles.favoriteButton}
              disabled={busy}
              aria-pressed={survey.favorite}
              aria-label={t(
                survey.favorite ? "pages.library.removeFavorite" : "pages.library.addFavorite",
                { title: survey.title },
              )}
              onClick={() => onFavorite(survey.id)}
            >
              <span aria-hidden="true">{survey.favorite ? "★" : "☆"}</span>
            </button>
            <div className={`${styles.artwork} ${styles.surveyArtwork}`} aria-hidden="true">
              <span>S</span>
              <div />
              <div />
            </div>
            <div className={styles.cardBody}>
              <div className={styles.cardMeta}>
                <span className={styles.status} data-status={survey.status}>
                  {t(`pages.common.status.${survey.status}`)}
                </span>
                {survey.updatedAt ? (
                  <span>
                    {t("pages.common.updated", {
                      date: new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
                        new Date(survey.updatedAt),
                      ),
                    })}
                  </span>
                ) : null}
              </div>
              <div className={styles.cardMain}>
                <h2 lang="">{survey.title}</h2>
                {survey.description ? (
                  <p className={styles.description} lang="">
                    {survey.description}
                  </p>
                ) : null}
                <p className={styles.facts}>
                  {t("pages.library.surveyQuestions", { count: survey.draft.items.length })}
                </p>
                <p className={styles.folderLabel}>
                  {folder ? <span lang="">{folder}</span> : t("pages.library.unfiled")}
                </p>
              </div>
              <div className={styles.cardActions}>
                <Link className="button-quiet small-button" href={`/surveys/${survey.id}`}>
                  {t(canEdit && !archived ? "pages.library.edit" : "pages.library.view")}
                </Link>
                {survey.status === "published" && canEdit && canCreate ? (
                  <Link className="button small-button" href={`/surveys/${survey.id}`}>
                    {t("pages.library.shareSurvey")}
                  </Link>
                ) : null}
                {canEdit ? (
                  <details className={styles.moreMenu}>
                    <summary>{t("pages.library.more")}</summary>
                    <div className={styles.moreMenuPanel}>
                      {canCreate ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => onAction("duplicate", survey.id)}
                        >
                          {t("pages.library.duplicate")}
                        </button>
                      ) : null}
                      {!archived ? (
                        <button
                          className={styles.dangerAction}
                          type="button"
                          disabled={busy}
                          onClick={() => onAction("archive", survey.id)}
                        >
                          {t("pages.library.archive")}
                        </button>
                      ) : null}
                    </div>
                  </details>
                ) : null}
              </div>
            </div>
          </article>
        );
      })}
    </section>
  );
}
