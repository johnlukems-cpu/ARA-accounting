import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireApp } from "@/core/auth/context";
import { withTenant } from "@/core/tenancy/tenant";
import { markNotificationsReadAction } from "@/actions/organization";
import { buttonClass } from "@/components/ui/button-class";
import { Card, EmptyState, PageHeader } from "@/components/ui/misc";

export default async function NotificationsPage() {
  const t = await getTranslations();
  const format = await getFormatter();
  const ctx = await requireApp();
  const items = await withTenant(ctx.access, (tx) => tx.notification.findMany({ where: { userId: ctx.user.id }, orderBy: { createdAt: "desc" }, take: 100 }));

  return (
    <>
      <PageHeader
        title={t("notifications.title")}
        actions={items.some((n) => !n.readAt) && (
          <form action={markNotificationsReadAction}><button className={buttonClass("secondary", "sm")}>{t("notifications.markRead")}</button></form>
        )}
      />
      <Card>
        {items.length === 0 ? (
          <EmptyState title={t("notifications.none")} />
        ) : (
          <ul className="divide-y divide-border">
            {items.map((n) => {
              const params = n.params as Record<string, string>;
              const text = t(`notifications.types.${n.type}`, { ...params, role: params.role ? t(`roles.${params.role}`) : "" });
              return (
                <li key={n.id} className="flex items-start justify-between gap-4 py-3 text-sm">
                  <div>
                    <p className={n.readAt ? "text-muted-foreground" : "font-medium"}>{n.link ? <Link href={n.link} className="hover:underline">{text}</Link> : text}</p>
                    <p className="text-xs text-muted-foreground">{format.dateTime(n.createdAt, { dateStyle: "medium", timeStyle: "short" })}</p>
                  </div>
                  {!n.readAt && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-accent" aria-label={t("notifications.unread")} />}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
