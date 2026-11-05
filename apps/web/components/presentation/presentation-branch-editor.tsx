"use client";

import { questionTypeDefinition, type InteractiveQuestionBlockDraft } from "@openround/contracts";
import { clientUuid } from "../../lib/uuid";
import styles from "./native-scene.module.css";

type Branch = NonNullable<InteractiveQuestionBlockDraft["branches"]>[number];

export function PresentationBranchEditor({
  block,
  targets,
  onChange,
}: {
  block: InteractiveQuestionBlockDraft;
  targets: readonly { id: string; title: string }[];
  onChange: (branches: Branch[], historyField?: string) => void;
}) {
  const branches = block.branches ?? [];
  const question = block.question;
  const supported = (question.delivery ?? "main") === "main" && !question.linkedRecheckQuestionId;
  const choiceQuestion = "choices" in question && question.type !== "ranking" ? question : null;
  const correct = questionTypeDefinition(question.type).scored;
  function update(id: string, updater: (branch: Branch) => Branch, field?: string) {
    onChange(
      branches.map((branch) => (branch.id === id ? updater(branch) : branch)),
      field ? `branch:${id}:${field}` : undefined,
    );
  }
  function add() {
    if (!supported || (!correct && !choiceQuestion?.choices.length) || branches.length >= 10)
      return;
    const condition: Branch["condition"] = correct
      ? { kind: "correct_share", minPercent: 50, minResponses: 1 }
      : {
          kind: "choice_share",
          choiceId: choiceQuestion!.choices[0]!.id,
          minPercent: 50,
          minResponses: 1,
        };
    onChange([...branches, { id: clientUuid(), label: "", targetBlockId: null, condition }]);
  }
  return (
    <fieldset className={styles.designControls} lang="en-CA">
      <legend>Answer branches</legend>
      <p className={styles.help}>
        After revealing this activity, the facilitator can choose an eligible branch. Next block
        keeps the numbered path. Branches never submit answers or change scores.
      </p>
      {!supported ? (
        <p>
          Branches require an unlinked main activity. Remove branches before linking a recheck or
          changing the delivery role.
        </p>
      ) : null}
      {branches.map((branch, index) => (
        <fieldset key={branch.id} className={styles.designControls}>
          <legend>Branch {index + 1}</legend>
          <label>
            Branch label
            <input
              aria-label={`Branch ${index + 1} label`}
              maxLength={120}
              value={branch.label}
              onChange={(event) =>
                update(branch.id, (current) => ({ ...current, label: event.target.value }), "label")
              }
            />
          </label>
          <label>
            Condition
            <select
              aria-label={`Branch ${index + 1} condition`}
              value={branch.condition.kind}
              onChange={(event) =>
                update(branch.id, (current) => ({
                  ...current,
                  condition:
                    event.target.value === "correct_share"
                      ? {
                          kind: "correct_share",
                          minPercent: current.condition.minPercent,
                          minResponses: current.condition.minResponses,
                        }
                      : {
                          kind: "choice_share",
                          choiceId: choiceQuestion?.choices[0]?.id ?? "",
                          minPercent: current.condition.minPercent,
                          minResponses: current.condition.minResponses,
                        },
                }))
              }
            >
              {correct ? <option value="correct_share">Correct responses</option> : null}
              {choiceQuestion ? <option value="choice_share">Selected answer choice</option> : null}
            </select>
          </label>
          {branch.condition.kind === "choice_share" ? (
            <label>
              Answer choice
              <select
                aria-label={`Branch ${index + 1} answer choice`}
                value={
                  choiceQuestion?.choices.find(
                    (choice) =>
                      choice.id.toLowerCase() ===
                      (branch.condition.kind === "choice_share"
                        ? branch.condition.choiceId.toLowerCase()
                        : ""),
                  )?.id ?? branch.condition.choiceId
                }
                onChange={(event) =>
                  update(branch.id, (current) =>
                    current.condition.kind === "choice_share"
                      ? {
                          ...current,
                          condition: { ...current.condition, choiceId: event.target.value },
                        }
                      : current,
                  )
                }
              >
                {!choiceQuestion?.choices.some(
                  (choice) =>
                    choice.id.toLowerCase() ===
                    (branch.condition.kind === "choice_share"
                      ? branch.condition.choiceId.toLowerCase()
                      : ""),
                ) ? (
                  <option value={branch.condition.choiceId}>
                    Unavailable choice — select another
                  </option>
                ) : null}
                {choiceQuestion?.choices.map((choice, choiceIndex) => (
                  <option key={choice.id} value={choice.id}>
                    {choice.label || `Choice ${choiceIndex + 1}`}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label>
            Minimum percent
            <input
              aria-label={`Branch ${index + 1} minimum percent`}
              type="number"
              min={0}
              max={100}
              value={branch.condition.minPercent}
              onChange={(event) => {
                const value = event.target.valueAsNumber;
                if (Number.isFinite(value))
                  update(
                    branch.id,
                    (current) => ({
                      ...current,
                      condition: {
                        ...current.condition,
                        minPercent: Math.max(0, Math.min(100, value)),
                      },
                    }),
                    "minPercent",
                  );
              }}
            />
          </label>
          <label>
            Minimum responses
            <input
              aria-label={`Branch ${index + 1} minimum responses`}
              type="number"
              min={1}
              max={10000}
              step={1}
              value={branch.condition.minResponses}
              onChange={(event) => {
                const value = event.target.valueAsNumber;
                if (Number.isFinite(value))
                  update(
                    branch.id,
                    (current) => ({
                      ...current,
                      condition: {
                        ...current.condition,
                        minResponses: Math.max(1, Math.min(10000, Math.trunc(value))),
                      },
                    }),
                    "minResponses",
                  );
              }}
            />
          </label>
          <label>
            Forward target
            <select
              aria-label={`Branch ${index + 1} target`}
              value={
                targets.find(
                  (target) => target.id.toLowerCase() === branch.targetBlockId?.toLowerCase(),
                )?.id ??
                branch.targetBlockId ??
                ""
              }
              onChange={(event) =>
                update(branch.id, (current) => ({
                  ...current,
                  targetBlockId: event.target.value || null,
                }))
              }
            >
              <option value="">Choose target</option>
              {branch.targetBlockId &&
              !targets.some(
                (target) => target.id.toLowerCase() === branch.targetBlockId?.toLowerCase(),
              ) ? (
                <option value={branch.targetBlockId}>Unavailable target — select another</option>
              ) : null}
              {targets.map((target) => (
                <option key={target.id} value={target.id}>
                  {target.title}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => onChange(branches.filter((current) => current.id !== branch.id))}
          >
            Remove branch {index + 1}
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        disabled={
          !supported || (!correct && !choiceQuestion?.choices.length) || branches.length >= 10
        }
        onClick={add}
      >
        Add answer branch
      </button>
    </fieldset>
  );
}
