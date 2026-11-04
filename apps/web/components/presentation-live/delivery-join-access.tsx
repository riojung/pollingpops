"use client";

import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import type { PublicFeatures } from "@openround/contracts";
import { apiFetch } from "../../lib/api";
import { buildJoinUrl, isLoopbackJoinBase, selectJoinBase } from "../../lib/join-url";
import { copyTextToClipboard } from "../../lib/clipboard";
import styles from "./presentation-delivery.module.css";

export function PresentationDeliveryJoinAccess({ code }: { code: string }) {
  const [base, setBase] = useState("");
  const [status, setStatus] = useState("");
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
    <section className={styles.joinAccess} aria-label="Join this Presentation" lang="en-CA">
      {url ? <QRCodeSVG value={url} size={84} title="Scan to join this Presentation" /> : null}
      <div>
        <p>
          Join code <strong className={styles.joinCode}>{code}</strong>
        </p>
        {url ? (
          <p>
            <a href={url} target="_blank" rel="noopener noreferrer">
              {url}
            </a>
          </p>
        ) : null}
        {url ? (
          <button
            className="button-quiet small-button"
            type="button"
            onClick={() =>
              void copyTextToClipboard(url).then((copied) =>
                setStatus(
                  copied
                    ? "Join link copied."
                    : "Copy is unavailable. Use the visible join address.",
                ),
              )
            }
          >
            Copy join link
          </button>
        ) : null}
        {base && isLoopbackJoinBase(base) ? (
          <p>
            This address works on this device. Use a public or network address for other devices.
          </p>
        ) : null}
        {status ? <p role="status">{status}</p> : null}
      </div>
    </section>
  );
}
