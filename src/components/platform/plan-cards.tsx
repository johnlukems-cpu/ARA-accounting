import type { Plan } from "@prisma/client";
import { getLocale, getTranslations } from "next-intl/server";
import { Check } from "lucide-react";
import { LIMIT_KEYS, OPTIONAL_MODULES, type Limits } from "@/modules/saas/service";
import { formatAmount } from "@/lib/format";

/**
 * Customer-facing presentation of plans (preview in Platformbeheer, comparison on the subscription page).
 * A missing price shows "on request" — prices are never invented.
 */
export async function PlanCards({ plans, currentPlanId }: { plans: Plan[]; currentPlanId?: string | null }) {
  const t = await getTranslations();
  const locale = await getLocale();
  const price = (v: Plan["priceMonthlySrd"], cur: string) => (v ? formatAmount(v.toString(), cur, locale) : null);
  if (plans.length === 0) return <p className="text-sm text-muted-foreground">{t("plans.noneActive")}</p>;
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {plans.map((p) => {
        const limits = p.limits as Limits;
        const modules = Array.isArray(p.modules) ? (p.modules as string[]) : null;
        const monthly = [price(p.priceMonthlySrd, "SRD"), price(p.priceMonthlyUsd, "USD")].filter(Boolean);
        const annual = [price(p.priceAnnualSrd, "SRD"), price(p.priceAnnualUsd, "USD")].filter(Boolean);
        return (
          <article key={p.id} className={`flex flex-col rounded-xl border bg-surface p-5 ${p.id === currentPlanId ? "border-accent ring-1 ring-accent" : "border-border"}`}>
            <h3 className="text-lg font-semibold">{p.name}</h3>
            {p.id === currentPlanId && <p className="text-xs font-medium text-accent">{t("plans.current")}</p>}
            {p.description && <p className="mt-1 text-sm text-muted-foreground">{p.description}</p>}
            <div className="mt-4">
              {monthly.length ? <p className="text-xl font-semibold">{monthly.join(" · ")}<span className="text-sm font-normal text-muted-foreground"> {t("plans.perMonth")}</span></p> : <p className="text-lg font-medium text-muted-foreground">{t("plans.priceOnRequest")}</p>}
              {annual.length > 0 && <p className="text-sm text-muted-foreground">{annual.join(" · ")} {t("plans.perYear")}</p>}
            </div>
            <ul className="mt-4 space-y-1 text-sm">
              {LIMIT_KEYS.map((k) => (
                <li key={k} className="flex justify-between gap-2"><span>{t(`saas.limits.${k}`)}</span><span className="font-medium">{limits[k] ?? t("saas.unlimited")}</span></li>
              ))}
            </ul>
            <ul className="mt-4 space-y-1 border-t border-border pt-3 text-sm">
              <li className="flex items-center gap-2"><Check aria-hidden className="size-4 text-accent" />{t("plans.coreModules")}</li>
              {modules === null ? <li className="flex items-center gap-2"><Check aria-hidden className="size-4 text-accent" />{t("plans.allModules")}</li>
                : OPTIONAL_MODULES.filter((m) => modules.includes(m)).map((m) => <li key={m} className="flex items-center gap-2"><Check aria-hidden className="size-4 text-accent" />{t(`plans.modules.${m}`)}</li>)}
            </ul>
          </article>
        );
      })}
    </div>
  );
}
