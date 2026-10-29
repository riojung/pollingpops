import Link from "next/link";
import type { FederatedIdentity, OidcStatus } from "@openround/contracts";
import { useLocale } from "../../components/locale-provider";
import { formatDate } from "../../lib/i18n/format";

export function PersonalInstitutionIdentities({
  status,
  identities,
  workspaceId,
  busy,
  onLink,
  onUnlink,
}: {
  status: OidcStatus | null;
  identities: FederatedIdentity[];
  workspaceId?: string;
  busy: boolean;
  onLink: () => void;
  onUnlink: (identityId: string) => void;
}) {
  const { locale, t } = useLocale();
  if (!status?.enabled && identities.length === 0) return null;
  return (
    <section className="panel">
      <p className="eyebrow">{t("customer.data.personal")}</p>
      <h2>{t("account.capability.oidc")}</h2>
      <p className="notice">{t("account.institution.linkGuidance")}</p>
      <div className="stack-sm">
        {identities.map((identity) => (
          <div className="identity-row" key={identity.id}>
            <span>
              <strong>{status?.providerName || identity.issuer}</strong>
              <small>
                {identity.emailHint ?? identity.issuer} ·{" "}
                {t("account.institution.linked", { date: formatDate(locale, identity.linkedAt) })}
              </small>
            </span>
            <button
              className="button-danger small-button"
              disabled={busy}
              onClick={() => onUnlink(identity.id)}
              type="button"
            >
              {t("account.institution.unlink")}
            </button>
          </div>
        ))}
        {status?.enabled && identities.length === 0 ? (
          <button className="button-quiet" disabled={busy} onClick={onLink} type="button">
            {busy
              ? t("account.institution.openingSignIn")
              : t("account.institution.linkProvider", { provider: status.providerName ?? "" })}
          </button>
        ) : null}
        {status?.enabled && identities.length > 0 && workspaceId ? (
          <Link href={`/signin?workspaceId=${encodeURIComponent(workspaceId)}`}>
            {t("account.institution.signInUrl")}
          </Link>
        ) : null}
      </div>
    </section>
  );
}
