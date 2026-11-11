import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { accessState } from "@/modules/saas/service";
import { ArrowLeftRight, BadgeDollarSign, Bell, BookMarked, Briefcase as BriefcaseIcon, ServerCog, Bot, ShieldAlert, CalendarCheck, FileText, ChartColumn, Coins, ScanLine, Target, BookOpen, Briefcase, Building2, Contact, Factory, Landmark, LayoutDashboard, LayoutTemplate, Library, List, LogOut, NotebookText, Percent, Receipt, Scale, Search, ShieldCheck, ShoppingCart, User, Users, Wallet } from "lucide-react";
import { requireUser } from "@/core/auth/context";
import { can } from "@/core/auth/access";
import { withTenant } from "@/core/tenancy/tenant";
import { logoutAction } from "@/actions/auth";
import { switchContextAction } from "@/actions/organization";
import { ContextSelect } from "@/components/shell/context-select";
import { NAV } from "@/components/shell/nav";

const ICONS = { dashboard: LayoutDashboard, building: Building2, briefcase: Briefcase, book: BookOpen, users: Users, shield: ShieldCheck, user: User, list: List, scale: Scale, library: Library, notebook: NotebookText, receipt: Receipt, cart: ShoppingCart, contact: Contact, wallet: Wallet, landmark: Landmark, percent: Percent, transfer: ArrowLeftRight, factory: Factory, template: LayoutTemplate, coins: Coins, target: Target, scan: ScanLine, bot: Bot, chart: ChartColumn, yearEnd: CalendarCheck, tax: FileText, annual: BookMarked, quality: ShieldAlert, practice: BriefcaseIcon, subscription: BadgeDollarSign, platform: ServerCog };

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations();
  const format = await getFormatter();
  const ctx = await requireUser();
  if (!ctx.access || !ctx.organization) redirect("/onboarding");
  const access = ctx.access;

  const subscription = accessState(ctx.organization);
  const unread = await withTenant(access, (tx) => tx.notification.count({ where: { userId: ctx.user.id, readAt: null } }));
  const nav = NAV.flatMap((item) => {
    if (item.key === "platform" && !ctx.user.isPlatformAdmin) return [];
    if (item.permission && !can(access, item.permission, ctx.company?.id)) return [];
    const href = typeof item.href === "string" ? item.href : item.href({ administrationId: ctx.administration?.id });
    return href ? [{ ...item, href }] : [];
  });

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[15rem_1fr]">
      <aside className="hidden bg-navy-950 text-white lg:flex lg:min-h-screen lg:flex-col">
        <Link href="/app" className="m-4 self-start rounded-md bg-white px-2 py-1">
          <Image src="/brand/ara-accounting-logo.png" alt={t("brand.product")} width={96} height={42} priority />
        </Link>
        <nav aria-label={t("nav.label")} className="flex-1 space-y-0.5 px-3">
          {nav.map((item, i) => {
            const Icon = ICONS[item.icon];
            const heading = item.section && item.section !== nav[i - 1]?.section;
            return (
              <div key={item.key}>
                {heading && <p className="mb-1 mt-5 px-3 text-[11px] font-semibold uppercase tracking-wider text-white/40">{t(`nav.sections.${item.section}`)}</p>}
                <Link href={item.href} className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-white/80 hover:bg-white/10 hover:text-white">
                  <Icon aria-hidden className="size-4" />
                  {t(`nav.${item.key}`)}
                </Link>
              </div>
            );
          })}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-10 bg-navy-900 text-white">
          <div className="flex flex-wrap items-center gap-2 px-4 py-2.5">
            <Link href="/app" className="mr-1 rounded bg-white px-1.5 py-0.5 lg:hidden">
              <Image src="/brand/ara-accounting-logo.png" alt={t("brand.product")} width={64} height={28} />
            </Link>
            {ctx.memberships.length > 1 && (
              <ContextSelect action={switchContextAction} field="organization" label={t("shell.organization")} value={ctx.organization.id}
                options={ctx.memberships.map((m) => ({ value: m.organizationId, label: m.organization.name }))} />
            )}
            <ContextSelect action={switchContextAction} field="company" label={t("shell.company")} value={ctx.company?.id}
              options={ctx.companies.map((c) => ({ value: c.id, label: c.name }))} />
            <ContextSelect action={switchContextAction} field="administration" label={t("shell.administration")} value={ctx.administration?.id}
              options={ctx.administrations.map((a) => ({ value: a.id, label: `${a.code} · ${a.name} (${a.baseCurrency})` }))} />
            <ContextSelect action={switchContextAction} field="fiscalYear" label={t("shell.fiscalYear")} value={ctx.fiscalYear?.id}
              options={ctx.fiscalYears.map((f) => ({ value: f.id, label: `${t("shell.fiscalYear")} ${f.code}` }))} />
            <form action="/app/search" className="ml-auto flex items-center" role="search">
              <label htmlFor="q" className="sr-only">{t("shell.search")}</label>
              <div className="relative">
                <Search aria-hidden className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-white/50" />
                <input id="q" name="q" placeholder={t("shell.searchPlaceholder")} className="h-9 w-40 rounded-lg border border-white/15 bg-white/10 pl-8 pr-2 text-sm placeholder:text-white/50 focus:outline-none focus:ring-2 focus:ring-accent sm:w-56" />
              </div>
            </form>
            <Link href="/app/notifications" className="relative rounded-lg p-2 hover:bg-white/10" aria-label={t("shell.notifications", { count: unread })}>
              <Bell aria-hidden className="size-5" />
              {unread > 0 && <span className="absolute -right-0.5 -top-0.5 rounded-full bg-accent px-1.5 text-[10px] font-semibold">{unread}</span>}
            </Link>
            <span className="hidden text-sm text-white/70 2xl:inline">{ctx.user.name}</span>
            <form action={logoutAction}>
              <button className="rounded-lg p-2 hover:bg-white/10" aria-label={t("auth.logout")} title={t("auth.logout")}>
                <LogOut aria-hidden className="size-5" />
              </button>
            </form>
          </div>
          <nav aria-label={t("nav.label")} className="flex gap-1 overflow-x-auto border-t border-white/10 px-3 py-1.5 lg:hidden">
            {nav.map((item) => (
              <Link key={item.key} href={item.href} className="whitespace-nowrap rounded-md px-2.5 py-1 text-xs text-white/80 hover:bg-white/10">
                {t(`nav.${item.key}`)}
              </Link>
            ))}
          </nav>
        </header>
        {ctx.mfaReminder && (
          <div role="alert" className="border-b border-warning/30 bg-warning/10 px-4 py-2 text-sm">
            {t("account.mfaRequiredBanner")}{" "}
            {ctx.mfaSatisfied && ctx.mfaGraceUntil && t("account.mfaGrace", { date: format.dateTime(ctx.mfaGraceUntil, { dateStyle: "medium" }) })}{" "}
            <Link href="/app/account" className="font-medium underline">{t("account.setUpMfa")}</Link>
          </div>
        )}
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">
          {subscription.readOnly && (
            <div role="alert" className="mb-6 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
              {t(`saas.banner.${subscription.reason}` as never)} <Link href="/app/subscription" className="underline">{t("saas.bannerLink")}</Link>
            </div>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
