import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/misc";

export async function EntryStatusBadge({ status, kind, reversed }: { status: string; kind?: string; reversed?: boolean }) {
  const t = await getTranslations();
  const tone = status === "POSTED" ? "success" : status === "APPROVED" ? "info" : status === "SUBMITTED" ? "warning" : "neutral";
  return (
    <span className="inline-flex flex-wrap gap-1">
      <Badge tone={tone}>{t(`ledger.status.${status}`)}</Badge>
      {kind && kind !== "NORMAL" && <Badge>{t(`ledger.kind.${kind}`)}</Badge>}
      {reversed && <Badge tone="danger">{t("ledger.reversed")}</Badge>}
    </span>
  );
}
