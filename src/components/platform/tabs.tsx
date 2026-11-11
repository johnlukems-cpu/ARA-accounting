import Link from "next/link";
import { getTranslations } from "next-intl/server";

const TABS = [
  { key: "organisations", href: "/app/platform" },
  { key: "plans", href: "/app/platform/plans" },
  { key: "compliance", href: "/app/platform/compliance" },
  { key: "bankFormats", href: "/app/platform/bank-formats" },
  { key: "readiness", href: "/app/platform/readiness" },
] as const;

/** Sub-navigation of Platformbeheer (platform administrators only). */
export async function PlatformTabs({ active }: { active: (typeof TABS)[number]["key"] }) {
  const t = await getTranslations("platform.tabs");
  return (
    <nav aria-label={t("label")} className="mb-6 flex flex-wrap gap-1 border-b border-border">
      {TABS.map((tab) => (
        <Link key={tab.key} href={tab.href} aria-current={tab.key === active ? "page" : undefined}
          className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab.key === active ? "border-accent font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
          {t(tab.key)}
        </Link>
      ))}
    </nav>
  );
}
