"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLocale } from "../../components/locale-provider";
import { groupsMessages } from "../../lib/i18n/groups-messages";
import {
  groupPurposes,
  type GroupDetail,
  type GroupPurpose,
  type GroupScope,
  type GroupsContext,
} from "./groups-model";
import styles from "./groups.module.css";

export interface GroupFormValues {
  name: string;
  description: string;
  purpose: GroupPurpose;
  scope: GroupScope;
}
export function GroupDialog({
  group,
  context,
  busy,
  error,
  onClose,
  onSave,
}: {
  group?: GroupDetail;
  context: GroupsContext;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSave: (values: GroupFormValues) => Promise<void>;
}) {
  const { locale, t } = useLocale();
  const copy = groupsMessages(locale);
  const dialog = useRef<HTMLDialogElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const title = group ? copy.settings : t("pages.groups.create");
  const [name, setName] = useState(group?.name ?? "");
  const [description, setDescription] = useState(group?.description ?? "");
  const [purpose, setPurpose] = useState<GroupPurpose>(group?.purpose ?? "team");
  const [scope, setScope] = useState<GroupScope>(
    group?.scope ?? (context.canCreateWorkspaceGroup ? "workspace" : "organization"),
  );
  useEffect(() => {
    const previous = document.activeElement;
    const element = dialog.current;
    element?.showModal();
    nameInput.current?.focus({ preventScroll: true });
    return () => {
      element?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!busy && name.trim())
      void onSave({ name: name.trim(), description: description.trim(), purpose, scope });
  }
  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-label={title}
      aria-modal="true"
      lang={locale}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <form onSubmit={submit}>
        <div className={styles.dialogHeading}>
          <div>
            <p className={styles.eyebrow}>{group ? copy.manageHelp : copy.eyebrow}</p>
            <h2>{title}</h2>
          </div>
          <button
            type="button"
            className="button-quiet small-button"
            disabled={busy}
            onClick={onClose}
          >
            {t("pages.common.close")}
          </button>
        </div>
        {!group ? (
          <>
            <p className={styles.helpText}>{copy.creationHelp}</p>
            <label className={styles.field}>
              <span>{copy.scopes}</span>
              <select
                value={scope}
                disabled={busy}
                onChange={(event) => setScope(event.target.value as GroupScope)}
              >
                {context.canCreateWorkspaceGroup ? (
                  <option value="workspace">{copy.workspace}</option>
                ) : null}
                {context.canCreateOrganizationGroup ? (
                  <option value="organization">
                    {copy.organization}
                    {context.organizationName ? ` · ${context.organizationName}` : ""}
                  </option>
                ) : null}
              </select>
            </label>
            <p className={styles.helpText}>{copy.scopeHelp}</p>
          </>
        ) : null}
        <label className={styles.field}>
          <span>{t("pages.groups.name")}</span>
          <input
            ref={nameInput}
            autoFocus
            required
            maxLength={120}
            value={name}
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("pages.groups.namePlaceholder")}
            lang={name ? "" : locale}
            dir="auto"
          />
        </label>
        <label className={styles.field}>
          <span>{copy.purpose}</span>
          <select
            value={purpose}
            disabled={busy}
            onChange={(event) => setPurpose(event.target.value as GroupPurpose)}
          >
            {groupPurposes.map((value) => (
              <option value={value} key={value}>
                {copy[value]}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span>{t("pages.common.description")}</span>
          <textarea
            rows={3}
            maxLength={1000}
            value={description}
            disabled={busy}
            onChange={(event) => setDescription(event.target.value)}
            lang={description ? "" : locale}
            dir="auto"
          />
        </label>
        {error ? (
          <p className="error" role="alert" lang="en-CA">
            {error}
          </p>
        ) : null}
        <div className={styles.dialogActions}>
          <button className="button" type="submit" disabled={busy || !name.trim()}>
            {busy ? copy.saving : group ? copy.save : t("pages.groups.create")}
          </button>
        </div>
      </form>
    </dialog>
  );
}
