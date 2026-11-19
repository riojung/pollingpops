"use client";

import { useId, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "./locale-provider";

interface JoinCodeFormProps {
  compact?: boolean;
  id?: string;
  codeLabel?: string;
  formLabel?: string;
  submitLabel?: string;
  className?: string;
}

export function JoinCodeForm({
  compact = false,
  id,
  codeLabel,
  formLabel,
  submitLabel,
  className,
}: JoinCodeFormProps) {
  const { t } = useLocale();
  const generatedId = useId();
  const inputId = id ?? `${compact ? "home-code" : "join-code"}-${generatedId}`;
  const [code, setCode] = useState("");
  const router = useRouter();

  function submit(event: FormEvent) {
    event.preventDefault();
    if (/^\d{7}$/.test(code)) router.push(`/join?code=${code}`);
  }

  return (
    <form
      className={className}
      onSubmit={submit}
      aria-label={formLabel ?? t("delivery.join.formLabel")}
    >
      <div className="field">
        <label htmlFor={inputId}>{codeLabel ?? t("delivery.join.codeLabel")}</label>
        <input
          autoComplete="one-time-code"
          className="input code-input"
          id={inputId}
          inputMode="numeric"
          onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 7))}
          placeholder="0000000"
          required
          value={code}
        />
      </div>
      <button className="button full-width" disabled={code.length !== 7} type="submit">
        {submitLabel ?? t("delivery.common.continue")}
      </button>
    </form>
  );
}
