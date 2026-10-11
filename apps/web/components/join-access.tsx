"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { QRCodeSVG } from "qrcode.react";
import type { PublicFeatures } from "@openround/contracts";
import { apiFetch } from "../lib/api";
import {
  buildJoinUrl,
  isLoopbackJoinBase,
  normalizeJoinBase,
  selectJoinBase,
} from "../lib/join-url";
import { useLocale } from "./locale-provider";

const storageKey = "openround:join-base";

export function JoinAccess({
  code,
  editable = false,
  size = 190,
  activityName,
}: {
  code: string;
  editable?: boolean;
  size?: number;
  activityName?: string;
}) {
  const { t } = useLocale();
  const [base, setBase] = useState("");
  const [automaticBase, setAutomaticBase] = useState("");
  const [candidate, setCandidate] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const [addressError, setAddressError] = useState("");
  const qrFrame = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    const current = window.location.origin;
    const saved = window.localStorage.getItem(storageKey);
    const initial = selectJoinBase({ current, saved });
    setBase(initial);
    setAutomaticBase(selectJoinBase({ current }));
    setCandidate(initial);

    apiFetch<PublicFeatures>("/v1/features")
      .then((features) => {
        if (!active) return;
        const automatic = selectJoinBase({ configured: features.publicWebUrl, current });
        setAutomaticBase(automatic);
        const selected = selectJoinBase({
          configured: features.publicWebUrl,
          current,
          saved,
        });
        setBase(selected);
        setCandidate(selected);
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, []);

  const joinUrl = buildJoinUrl(base, code);
  const deviceLocal = !joinUrl || isLoopbackJoinBase(base);

  async function copyJoinLink() {
    if (!joinUrl) return;
    try {
      await navigator.clipboard.writeText(joinUrl);
      setCopyStatus(t("live.joinAccess.linkCopied"));
    } catch {
      setCopyStatus(t("live.joinAccess.copyBlocked"));
    }
  }

  function serializedQr() {
    const source = qrFrame.current?.querySelector("svg");
    if (!source) return null;
    const svg = source.cloneNode(true) as SVGSVGElement;
    svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    return new XMLSerializer().serializeToString(svg);
  }

  function triggerDownload(url: string, extension: "svg" | "png") {
    const link = document.createElement("a");
    link.href = url;
    link.download = `polling-pops-${code}-qr.${extension}`;
    document.body.append(link);
    link.click();
    link.remove();
  }

  function downloadSvg() {
    const svg = serializedQr();
    if (!svg) return;
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
    triggerDownload(url, "svg");
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    setCopyStatus(t("live.joinAccess.svgDownloaded"));
  }

  function downloadPng() {
    const svg = serializedQr();
    if (!svg) return;
    const sourceUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 1024;
      canvas.height = 1024;
      const context = canvas.getContext("2d");
      if (!context) {
        URL.revokeObjectURL(sourceUrl);
        setCopyStatus(t("live.joinAccess.pngUnsupported"));
        return;
      }
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        URL.revokeObjectURL(sourceUrl);
        if (!blob) {
          setCopyStatus(t("live.joinAccess.pngFailed"));
          return;
        }
        const pngUrl = URL.createObjectURL(blob);
        triggerDownload(pngUrl, "png");
        window.setTimeout(() => URL.revokeObjectURL(pngUrl), 0);
        setCopyStatus(t("live.joinAccess.pngDownloaded"));
      }, "image/png");
    };
    image.onerror = () => {
      URL.revokeObjectURL(sourceUrl);
      setCopyStatus(t("live.joinAccess.pngFailed"));
    };
    image.src = sourceUrl;
  }

  function updateAddress(event: FormEvent) {
    event.preventDefault();
    const normalized = normalizeJoinBase(candidate);
    if (!normalized) {
      setAddressError(t("live.joinAccess.invalidAddress"));
      return;
    }
    window.localStorage.setItem(storageKey, normalized);
    setBase(normalized);
    setCandidate(normalized);
    setAddressError("");
    setCopyStatus(t("live.joinAccess.qrUpdated"));
  }

  function resetAddress() {
    window.localStorage.removeItem(storageKey);
    setBase(automaticBase);
    setCandidate(automaticBase);
    setAddressError("");
    setCopyStatus(t("live.joinAccess.configuredAddress"));
  }

  return (
    <section
      className="join-access"
      aria-label={
        activityName
          ? `Join this ${activityName} using a QR code or direct link`
          : t("live.joinAccess.sectionAria")
      }
    >
      <p className="eyebrow">{t("live.joinAccess.scanToJoin")}</p>
      {joinUrl ? (
        <>
          <div className="join-qr-frame" ref={qrFrame}>
            <QRCodeSVG
              aria-label={
                activityName
                  ? `${activityName} QR code: ${code.split("").join(" ")}`
                  : t("live.joinAccess.qrAria", { code: code.split("").join(" ") })
              }
              bgColor="#ffffff"
              fgColor="#0b2239"
              size={size}
              value={joinUrl}
            />
          </div>
          <a
            aria-label={t("live.joinAccess.openLinkAria")}
            className="join-url"
            data-testid="join-url"
            href={joinUrl}
            rel="noreferrer"
            target="_blank"
          >
            {joinUrl}
          </a>
          {editable ? (
            <div className="button-row join-asset-actions">
              <button
                className="button-quiet small-button"
                onClick={() => void copyJoinLink()}
                type="button"
              >
                {t("live.joinAccess.copyLink")}
              </button>
              <button className="button-quiet small-button" onClick={downloadSvg} type="button">
                {t("live.joinAccess.downloadSvg")}
              </button>
              <button className="button-quiet small-button" onClick={downloadPng} type="button">
                {t("live.joinAccess.downloadPng")}
              </button>
            </div>
          ) : null}
        </>
      ) : (
        <p className="muted">{t("live.joinAccess.preparing")}</p>
      )}
      {deviceLocal ? (
        <p className="notice join-address-notice">{t("live.joinAccess.localhostWarning")}</p>
      ) : (
        <p className="muted join-address-note">{t("live.joinAccess.scanOrOpen")}</p>
      )}
      {editable ? (
        <details className="join-address-settings" open={deviceLocal}>
          <summary>{t("live.joinAccess.changeAddress")}</summary>
          <form className="join-address-form" onSubmit={updateAddress}>
            <label className="field" htmlFor="join-base-address">
              <span>{t("live.joinAccess.addressLabel")}</span>
              <input
                className="input"
                id="join-base-address"
                inputMode="url"
                onChange={(event) => setCandidate(event.target.value)}
                placeholder="http://192.168.1.20:8080"
                type="url"
                value={candidate}
              />
            </label>
            {addressError ? (
              <p className="error" role="alert">
                {addressError}
              </p>
            ) : null}
            <div className="button-row">
              <button className="button small-button" type="submit">
                {t("live.joinAccess.updateQr")}
              </button>
              <button className="button-quiet small-button" onClick={resetAddress} type="button">
                {t("live.joinAccess.resetAddress")}
              </button>
            </div>
          </form>
        </details>
      ) : null}
      {copyStatus ? (
        <p className="muted join-copy-status" role="status">
          {copyStatus}
        </p>
      ) : null}
    </section>
  );
}
