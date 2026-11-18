import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { BadgeDollarSign, ChartColumn, ClipboardList, Contact, FileText, Kanban, Landmark, LayoutDashboard, LifeBuoy, LogOut, Package, Receipt, Settings, ShoppingCart, Users, Wallet, Scale, PiggyBank, ArrowLeft } from "lucide-react";
import { getContext } from "@/core/auth/context";
import { getHome } from "@/modules/admin/home";
import { adminAccess } from "@/modules/admin/home";
import { can } from "@/core/auth/access";
import { logoutAction } from "@/actions/auth";
import { ADMIN_NAV } from "@/components/admin/nav";

const ICONS: Record<string, typeof LayoutDashboard> = { dashboard: LayoutDashboard, pipeline: Kanban, customers: Contact, products: Package, quotes: ClipboardList, invoices: Receipt, subscriptions: BadgeDollarSign, payments: Wallet, receivables: Scale, purchases: ShoppingCart, expenses: PiggyBank, banking: Landmark, finance: FileText, reports: ChartColumn, employees: Users, support: LifeBuoy, settings: Settings };

/**
 * ARA Admin Portal shell. Authorisation happens per page (requireAdmin); the layout only shows the navigation the
 * user's role allows, resolved for ARA's own organisation.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations();
  const ctx = await getContext();
  const home = await getHome();
  const admin = ctx && home ? await adminAccess(ctx.user.id).catch(() => null) : null;
  const nav = admin ? ADMIN_NAV.filter((i) => !i.permission || can(admin.access, i.permission, admin.home.companyId)) : [];

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[15.5rem_1fr]">
      <aside className="hidden bg-navy-950 text-white lg:flex lg:min-h-screen lg:flex-col">
        <Link href="/admin" className="block px-5 pb-3 pt-5">
          <span className="block text-[11px] font-semibold uppercase tracking-[0.18em] text-white/50">ARA</span>
          <span className="block text-sm font-semibold uppercase tracking-[0.12em]">Intelligent Solutions</span>
          <span className="mt-1 block text-xs text-white/50">{t("admin.portal")}</span>
        </Link>
        <nav aria-label={t("admin.navLabel")} className="flex-1 space-y-0.5 px-3 pb-6">
          {nav.map((item, i) => {
            const Icon = ICONS[item.icon] ?? LayoutDashboard;
            const heading = item.section && item.section !== nav[i - 1]?.section;
            return (
              <div key={item.key}>
                {heading && <p className="mb-1 mt-5 px-3 text-[11px] font-semibold uppercase tracking-wider text-white/40">{t(`admin.sections.${item.section}`)}</p>}
                <Link href={item.href} className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-white/80 hover:bg-white/10 hover:text-white">
                  <Icon aria-hidden className="size-4" />
                  {t(`admin.nav.${item.key}`)}
                </Link>
              </div>
            );
          })}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-10 bg-navy-900 text-white">
          <div className="flex items-center gap-3 px-4 py-2.5">
            <span className="text-sm font-semibold uppercase tracking-[0.1em] lg:hidden">ARA Intelligent Solutions</span>
            <Link href="/app" className="ml-auto flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-white/80 hover:bg-white/10"><ArrowLeft aria-hidden className="size-4" />{t("admin.toApp")}</Link>
            {ctx && <span className="hidden text-sm text-white/70 md:inline">{ctx.user.name}</span>}
            {ctx && (
              <form action={logoutAction}>
                <button className="rounded-lg p-2 hover:bg-white/10" aria-label={t("auth.logout")} title={t("auth.logout")}><LogOut aria-hidden className="size-5" /></button>
              </form>
            )}
          </div>
          {nav.length > 0 && (
            <nav aria-label={t("admin.navLabel")} className="flex gap-1 overflow-x-auto border-t border-white/10 px-3 py-1.5 lg:hidden">
              {nav.map((item) => <Link key={item.key} href={item.href} className="whitespace-nowrap rounded-md px-2.5 py-1 text-xs text-white/80 hover:bg-white/10">{t(`admin.nav.${item.key}`)}</Link>)}
            </nav>
          )}
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">{children}</main>
      </div>
    </div>
  );
}
