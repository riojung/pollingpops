"use client";

import Link from "next/link";
import { useId } from "react";
import { useLocale } from "./locale-provider";

export function RoomPasswordOption({
  available,
  enabled,
  password,
  disabled,
  onEnabledChange,
  onPasswordChange,
}: {
  available: boolean;
  enabled: boolean;
  password: string;
  disabled?: boolean;
  onEnabledChange(enabled: boolean): void;
  onPasswordChange(password: string): void;
}) {
  const { locale, t } = useLocale();
  const id = useId();
  return (
    <fieldset className="panel" disabled={disabled} lang={locale}>
      <legend>{t("live.protection.title")}</legend>
      {available || enabled ? (
        <>
          <label className="checkbox-field" htmlFor={id}>
            <input
              id={id}
              type="checkbox"
              checked={enabled}
              onChange={(event) => {
                onEnabledChange(event.target.checked);
                if (!event.target.checked) onPasswordChange("");
              }}
            />
            {t("live.protection.toggle")}
          </label>
          {available ? <p className="muted">{t("live.protection.help")}</p> : null}
          {enabled && available ? (
            <RoomPasswordInput creation value={password} onChange={onPasswordChange} />
          ) : null}
        </>
      ) : null}
      {!available ? (
        <p className="muted">
          {t("live.protection.upgrade")}{" "}
          <Link href="/account">{t("live.protection.upgradeLink")}</Link>
        </p>
      ) : null}
    </fieldset>
  );
}

export function RoomPasswordInput({
  value,
  onChange,
  disabled,
  creation = false,
}: {
  value: string;
  onChange(value: string): void;
  disabled?: boolean;
  creation?: boolean;
}) {
  const { locale, t } = useLocale();
  const id = useId();
  return (
    <div className="field" lang={locale}>
      <label htmlFor={id}>{t("live.protection.label")}</label>
      <input
        autoComplete={creation ? "new-password" : "current-password"}
        autoCapitalize="none"
        spellCheck={false}
        className="input"
        id={id}
        type="password"
        required
        minLength={creation ? 8 : undefined}
        maxLength={128}
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-describedby={`${id}-help`}
      />
      <small className="muted" id={`${id}-help`}>
        {t(creation ? "live.protection.validation" : "live.protection.required")}
      </small>
    </div>
  );
}
