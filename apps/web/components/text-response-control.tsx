import { useId } from "react";
import { textResponseCharacterLimit } from "@openround/contracts";
import { useLocale } from "./locale-provider";
import type { TextQuestionType } from "../lib/text-response";

export function TextResponseControl({
  type,
  value = "",
  disabled = false,
  onChange,
}: {
  type: TextQuestionType;
  value?: string;
  disabled?: boolean;
  onChange?: (value: string) => void;
}) {
  const { locale, t } = useLocale();
  const id = useId();
  const limit = textResponseCharacterLimit(type);
  const count = value.normalize("NFC").trim().length;
  return (
    <div lang={locale} className="field">
      <label htmlFor={id}>
        {t(type === "open_text" ? "live.text.responseLabel" : "live.text.phraseLabel")}
      </label>
      {type === "open_text" ? (
        <textarea
          className="textarea"
          id={id}
          aria-describedby={`${id}-limit ${id}-privacy`}
          disabled={disabled}
          autoComplete="off"
          lang=""
          value={value}
          onChange={(event) => onChange?.(event.target.value)}
        />
      ) : (
        <input
          className="input"
          id={id}
          aria-describedby={`${id}-limit ${id}-privacy`}
          disabled={disabled}
          autoComplete="off"
          lang=""
          value={value}
          onChange={(event) => onChange?.(event.target.value)}
        />
      )}
      <small id={`${id}-limit`}>{t("live.text.characterLimit", { count, limit })}</small>
      <small id={`${id}-privacy`}>{t("live.text.reviewPrivacy")}</small>
    </div>
  );
}
