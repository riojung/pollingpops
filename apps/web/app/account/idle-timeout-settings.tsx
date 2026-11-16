"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { WorkspaceAccountContext } from "../../components/workspace/workspace-provider";
import { useLocale } from "../../components/locale-provider";
import { apiFetch } from "../../lib/api";
import { idleSessionCopy } from "../../lib/i18n/idle-session-messages";
import { SESSION_POLICY_UPDATED_EVENT } from "../../lib/idle-session";

export function IdleTimeoutSettings({
  workspace,
  canManage,
  onSaved,
}: {
  workspace: WorkspaceAccountContext | null;
  canManage: boolean;
  onSaved: (workspace: WorkspaceAccountContext) => void;
}) {
  const { locale } = useLocale();
  const copy = idleSessionCopy(locale);
  const minutes = workspace?.sessionPolicy?.idleTimeoutMinutes ?? 5;
  const [value, setValue] = useState(String(minutes));
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<"" | "saved" | "error">("");
  useEffect(() => {
    setValue(String(minutes));
  }, [workspace?.id, minutes]);
  useEffect(() => {
    setStatus("");
  }, [workspace?.id]);
  const valid = /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 240;
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage || !workspace || busy || !valid) return;
    setBusy(true);
    setStatus("");
    try {
      const result = await apiFetch<{ workspace: WorkspaceAccountContext }>(
        "/v1/workspace/settings",
        {
          method: "PATCH",
          body: JSON.stringify({
            sessionPolicy: { idleTimeoutMinutes: Number(value), warningDurationSeconds: 60 },
          }),
        },
      );
      onSaved(result.workspace);
      window.dispatchEvent(new Event(SESSION_POLICY_UPDATED_EVENT));
      setStatus("saved");
    } catch {
      setStatus("error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel" lang={locale}>
      <h2 style={{ fontSize: "1.8rem" }}>{copy.settingsTitle}</h2>
      <p className="muted">{copy.settingsDescription}</p>
      <form onSubmit={(event) => void save(event)}>
        <label className="field" htmlFor="workspace-idle-timeout">
          {copy.minutesLabel}
          <input
            aria-describedby="workspace-idle-timeout-help"
            className="input"
            disabled={!canManage || !workspace || busy}
            id="workspace-idle-timeout"
            inputMode="numeric"
            list="workspace-idle-timeout-presets"
            max={240}
            min={1}
            onChange={(event) => {
              setValue(event.target.value);
              setStatus("");
            }}
            required
            step={1}
            type="number"
            value={value}
          />
        </label>
        <datalist id="workspace-idle-timeout-presets">
          {[5, 15, 30, 60, 120, 240].map((preset) => (
            <option key={preset} value={preset} />
          ))}
        </datalist>
        <p className="muted" id="workspace-idle-timeout-help">
          {copy.rangeHelp}
        </p>
        {!canManage ? (
          <p className="notice">{copy.readOnly}</p>
        ) : (
          <button className="button-quiet" disabled={!workspace || busy || !valid} type="submit">
            {busy ? copy.saving : copy.save}
          </button>
        )}
        {status === "saved" ? (
          <p className="notice" role="status">
            {copy.saved}
          </p>
        ) : null}
        {status === "error" ? (
          <p className="error" role="alert">
            {copy.saveError}
          </p>
        ) : null}
      </form>
    </section>
  );
}
