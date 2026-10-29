import { useLocale } from "../../components/locale-provider";
import type { PersonalBillingState } from "./account-settings-model";

export function PersonalBillingNotice({
  status,
  onRetry,
}: {
  status: PersonalBillingState;
  onRetry: () => void;
}) {
  const { t } = useLocale();
  if (status.state === "loading") return <p role="status">{t("customer.billing.statusLoading")}</p>;
  return (
    <div>
      <p className="notice" role="alert">
        {t("customer.billing.statusUnavailable")}
      </p>
      <button className="button-quiet" type="button" onClick={onRetry}>
        {t("customer.billing.statusRetry")}
      </button>
    </div>
  );
}
