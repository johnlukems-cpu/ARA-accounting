import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/misc";

export async function PeriodBadge({ status }: { status: string }) {
  const t = await getTranslations();
  const tone = status === "OPEN" ? "success" : status === "SOFT_CLOSED" ? "warning" : "neutral";
  return <Badge tone={tone}>{t(`periods.status.${status}`)}</Badge>;
}
