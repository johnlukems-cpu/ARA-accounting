import Image from "next/image";
import { getLocale, getTranslations } from "next-intl/server";
import { Banknote, Building2, CheckCircle2, CircleDot, Circle, Landmark, Scale } from "lucide-react";
import { setLocale } from "./actions";
import { LOCALES } from "@/i18n/config";
import { PHASES, type PhaseState } from "@/lib/roadmap";

const stateStyle: Record<PhaseState, string> = {
  done: "bg-accent-soft text-accent",
  active: "bg-primary text-primary-foreground",
  planned: "bg-muted text-muted-foreground",
};

function StateIcon({ state }: { state: PhaseState }) {
  if (state === "done") return <CheckCircle2 aria-hidden className="size-5 text-accent" />;
  if (state === "active") return <CircleDot aria-hidden className="size-5 text-primary" />;
  return <Circle aria-hidden className="size-5 text-muted-foreground" />;
}

export default async function StatusPage() {
  const t = await getTranslations();
  const locale = await getLocale();
  const highlights = [
    { key: "currency", Icon: Banknote },
    { key: "tax", Icon: Scale },
    { key: "law", Icon: Building2 },
    { key: "banks", Icon: Landmark },
  ] as const;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="bg-navy-950 text-primary-foreground">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="rounded-md bg-white px-2 py-1">
              <Image src="/brand/ara-accounting-logo.png" alt={t("brand.product")} width={96} height={42} priority />
            </span>
            <span className="hidden text-sm text-white/70 sm:inline">{t("brand.company")}</span>
          </div>
          <form action={setLocale} className="flex items-center gap-1 text-sm" aria-label={t("language.label")}>
            {LOCALES.map((l) => (
              <button
                key={l}
                name="locale"
                value={l}
                aria-pressed={l === locale}
                className={`rounded px-2 py-1 transition ${l === locale ? "bg-white/15 font-semibold" : "text-white/70 hover:text-white"}`}
              >
                {t(`language.${l}`)}
              </button>
            ))}
          </form>
        </div>
        <div className="mx-auto max-w-5xl px-4 pb-14 pt-8 sm:px-6">
          <span className="inline-flex items-center rounded-full bg-accent px-3 py-1 text-xs font-semibold uppercase tracking-wide">
            {t("status.badge")}
          </span>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">{t("brand.tagline")}</h1>
          <p className="mt-4 max-w-3xl text-white/80">{t("status.intro")}</p>
          <p className="mt-3 max-w-3xl text-sm text-white/60">{t("status.notYetAvailable")}</p>
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-5xl flex-1 gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[1fr_20rem]">
        <section aria-labelledby="roadmap" className="rounded-xl border border-border bg-surface p-5 sm:p-6">
          <h2 id="roadmap" className="text-lg font-semibold">{t("status.roadmapTitle")}</h2>
          <ol className="mt-4 divide-y divide-border">
            {PHASES.map((p) => (
              <li key={p.number} className="flex items-start gap-3 py-3">
                <StateIcon state={p.state} />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-muted-foreground">{t("status.phase", { number: p.number })}</p>
                  <p className="text-sm">{t(`status.phases.p${p.number}`)}</p>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${stateStyle[p.state]}`}>
                  {t(`status.state.${p.state}`)}
                </span>
              </li>
            ))}
          </ol>
        </section>

        <aside className="space-y-4">
          <section aria-labelledby="highlights" className="rounded-xl border border-border bg-surface p-5">
            <h2 id="highlights" className="text-lg font-semibold">{t("status.highlightsTitle")}</h2>
            <ul className="mt-4 space-y-3">
              {highlights.map(({ key, Icon }) => (
                <li key={key} className="flex gap-3 text-sm">
                  <Icon aria-hidden className="mt-0.5 size-5 shrink-0 text-accent" />
                  <span>{t(`status.highlights.${key}`)}</span>
                </li>
              ))}
            </ul>
          </section>
          <p className="rounded-xl border border-warning/30 bg-warning/5 p-4 text-sm text-foreground/80">
            {t("status.verification")}
          </p>
        </aside>
      </main>

      <footer className="border-t border-border py-6 text-center text-sm text-muted-foreground">
        {t("footer", { year: new Date().getFullYear() })}
      </footer>
    </div>
  );
}
