"use client";

import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import type { PublicFeatures } from "@openround/contracts";
import { apiFetch } from "../../lib/api";
import { buildJoinUrl, isLoopbackJoinBase, selectJoinBase } from "../../lib/join-url";
import { copyTextToClipboard } from "../../lib/clipboard";
import { useLocale } from "../locale-provider";
import { presentationDeliveryCopy } from "../../lib/i18n/presentation-delivery-copy";
import styles from "./presentation-delivery.module.css";

export function PresentationDeliveryJoinAccess({ code }: { code: string }) {
  const { locale } = useLocale();
  const copy = presentationDeliveryCopy(locale);
  const [base, setBase] = useState("");
  const [status, setStatus] = useState<"copied" | "copyUnavailable" | null>(null);
  useEffect(() => {
    let active = true;
    const current = window.location.origin;
    let saved: string | null = null;
    try {
      saved = window.localStorage.getItem("openround:join-base");
    } catch {
      /* Optional local preference. */
    }
    setBase(selectJoinBase({ current, saved }));
    void apiFetch<PublicFeatures>("/v1/features", { credentials: "omit" })
      .then((features) => {
        if (active) setBase(selectJoinBase({ configured: features.publicWebUrl, current, saved }));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  const url = buildJoinUrl(base, code);
  return (
    <section className={styles.joinAccess} aria-label={copy("joinPresentation")} lang={locale}>
      {url ? <QRCodeSVG value={url} size={84} title={copy("scanJoin")} /> : null}
      <div>
        <p>
          {copy("joinCode")} <strong className={styles.joinCode}>{code}</strong>
        </p>
        {url ? (
          <p>
            <a href={url} target="_blank" rel="noopener noreferrer">
              <span lang="">{url}</span>
            </a>
          </p>
        ) : null}
        {url ? (
          <button
            className="button-quiet small-button"
            type="button"
            onClick={() =>
              void copyTextToClipboard(url).then((copied) =>
                setStatus(copied ? "copied" : "copyUnavailable"),
              )
            }
          >
            {copy("copyJoin")}
          </button>
        ) : null}
        {base && isLoopbackJoinBase(base) ? <p>{copy("loopbackAddress")}</p> : null}
        {status ? <p role="status">{copy(status)}</p> : null}
      </div>
    </section>
  );
}
