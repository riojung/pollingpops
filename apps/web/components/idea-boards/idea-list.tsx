"use client";

import type { IdeaBoardView } from "@openround/contracts";
import { useLocale } from "../locale-provider";
import { IdeaContent } from "./idea-content";
import styles from "./boards.module.css";

/** Receives only the server's sanitized projection; vote totals are never calculated here. */
export function IdeaBoardIdeas({
  board,
  selected,
  onSelect,
  disabled = false,
  guestToken,
}: {
  board: IdeaBoardView;
  selected?: string[];
  onSelect?: (id: string, checked: boolean) => void;
  disabled?: boolean;
  guestToken?: string;
}) {
  const { t } = useLocale();
  const ideas = board.ideas.filter((idea) => idea.status === "approved");
  if (!ideas.length) return <p>{t("boards.noIdeas")}</p>;
  const groups = [{ id: null, name: t("boards.ungrouped") }, ...board.groups];
  return (
    <div>
      {groups.map((group) => {
        const rows = ideas.filter((idea) => idea.groupId === group.id);
        if (!rows.length) return null;
        return (
          <section className={styles.group} key={group.id ?? "ungrouped"}>
            <h3 lang={group.id ? "" : undefined}>{group.name}</h3>
            <ul className={`${styles.list} ${styles.ideaGrid}`}>
              {rows.map((idea) => (
                <li className={styles.idea} key={idea.id}>
                  {onSelect && selected ? (
                    <label className={styles.check}>
                      <input
                        type="checkbox"
                        checked={selected.includes(idea.id)}
                        disabled={
                          disabled ||
                          (!selected.includes(idea.id) && selected.length >= board.voteBudget)
                        }
                        onChange={(event) => onSelect(idea.id, event.target.checked)}
                      />
                      <span className={styles.body} dir="auto" lang="">
                        {idea.body}
                      </span>
                    </label>
                  ) : null}
                  <IdeaContent
                    boardId={board.id}
                    idea={idea}
                    guestToken={guestToken}
                    showBody={!onSelect || !selected}
                  />
                  {idea.alias ? (
                    <p className={styles.muted} dir="auto" lang="">
                      {idea.alias}
                    </p>
                  ) : null}
                  {board.status === "closed" && board.countsVisible && idea.voteCount !== null ? (
                    <p className={styles.status}>
                      {t("boards.voteCount", { count: idea.voteCount })}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
