"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Entitlements, WorkspaceProductFeatures } from "@openround/contracts";
import { apiFetch } from "../lib/api";

interface FundingStatus {
  enabled: boolean;
  coveredBySubscription: boolean;
  availableCredits: number;
  eventEntitlements?: Entitlements;
  eventProductFeatures?: WorkspaceProductFeatures;
}

export function EventCreditChoice({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange(
    checked: boolean,
    entitlements: Entitlements,
    productFeatures?: WorkspaceProductFeatures,
  ): void;
}) {
  const [status, setStatus] = useState<FundingStatus | null>(null);
  useEffect(() => {
    let active = true;
    void apiFetch<FundingStatus>("/v1/workspaces/current/room-funding")
      .then((value) => {
        if (active) setStatus(value);
      })
      .catch(() => {
        if (active) setStatus(null);
      });
    return () => {
      active = false;
    };
  }, []);
  if (!status?.enabled || status.coveredBySubscription || !status.eventEntitlements) return null;
  const entitlements = status.eventEntitlements;
  return (
    <section aria-label="Event credits" className="panel" lang="en-CA">
      <h2>Event credits</h2>
      <p>{status.availableCredits} available in your organization.</p>
      <label className="checkbox-field">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled || status.availableCredits < 1}
          onChange={(event) =>
            onChange(event.target.checked, entitlements, status.eventProductFeatures)
          }
        />
        Use one credit for this room, with up to {entitlements.maxParticipants} participants and Pro
        live and report features.
      </label>
      <p className="muted">
        The credit is reserved when you create the room and used when the first audience member
        joins. An empty room returns its reservation when it closes or expires.
      </p>
      <Link href="/organization">Manage event credits</Link>
    </section>
  );
}
