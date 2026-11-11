import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { requireApp } from "@/core/auth/context";
import { EVIDENCE_ITEMS, evaluate, type EvaluatedItem } from "@/modules/readiness/service";
import type { ReadinessStatus } from "@/modules/readiness/register";
import { evidenceAction, testEmailAction, testErrorAction } from "@/actions/platform";
import { ActionForm, Checkbox, Field, Input, Select, SubmitButton } from "@/components/ui/form";
import { Badge, Card, PageHeader, Table, Td } from "@/components/ui/misc";
import { PlatformTabs } from "@/components/platform/tabs";

const TONE: Record<ReadinessStatus, "success" | "info" | "warning" | "danger" | "neutral"> = {
  COMPLETED: "success", IN_PROGRESS: "info", WAITING_OWNER: "warning", WAITING_SPECIALIST: "warning", BLOCKED: "danger", NOT_STARTED: "neutral",
};
const ORDER: ReadinessStatus[] = ["BLOCKED", "WAITING_OWNER", "WAITING_SPECIALIST", "IN_PROGRESS", "NOT_STARTED", "COMPLETED"];

/** Production readiness dashboard: every outstanding requirement, live where the software can check it. */
export default async function ReadinessPage() {
  const t = await getTranslations();
  const locale = (await getLocale()) as "nl" | "en";
  const ctx = await requireApp();
  if (!ctx.user.isPlatformAdmin) notFound();
  const r = await evaluate();
  const sorted = [...r.items].sort((a, b) => a.priority.localeCompare(b.priority) || ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || a.id.localeCompare(b.id, undefined, { numeric: true }));
  const row = (it: EvaluatedItem) => (
    <tr key={it.id}>
      <Td className="font-mono text-xs">{it.id}</Td>
      <Td>{it.title[locale]}<span className="block text-xs text-muted-foreground">{t(`readiness.areas.${it.area}`)}{it.evidence ? ` · ${it.evidence}` : ""}</span></Td>
      <Td><Badge tone={TONE[it.status]}>{t(`readiness.statuses.${it.status}`)}</Badge>{it.live && <span className="block text-[11px] text-muted-foreground">{t("readiness.liveCheck")}{it.detail ? ` · ${it.detail}` : ""}</span>}</Td>
      <Td className="text-xs">{t(`readiness.responsible.${it.responsible}`)}</Td>
      <Td className="text-xs">{it.priority} · {t(`readiness.gates.${it.gate}`)}</Td>
      <Td className="text-xs">{it.dependsOn.join(", ") || "—"}</Td>
      <Td className="text-xs">{it.acceptance[locale]}</Td>
    </tr>
  );
  const head = [t("readiness.id"), t("readiness.requirement"), t("common.status"), t("readiness.responsibleLabel"), t("readiness.priority"), t("readiness.dependsOn"), t("readiness.acceptance")];

  return (
    <>
      <PageHeader title={t("platform.title")} description={t("readiness.intro")} />
      <PlatformTabs active="readiness" />
      <div className="grid gap-4 sm:grid-cols-2">
        {[["pilot", r.pilotReady], ["ga", r.gaReady]].map(([gate, ok]) => (
          <div key={String(gate)} role="status" className={`rounded-xl border p-5 ${ok ? "border-accent bg-accent-soft" : "border-danger/40 bg-danger/5"}`}>
            <p className="text-sm font-medium">{t(`readiness.gate.${gate}`)}</p>
            <p className="mt-1 text-xl font-semibold">{ok ? t("readiness.ready") : t("readiness.notReady")}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t(`readiness.gateRule.${gate}`)}</p>
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {ORDER.map((s) => <Badge key={s} tone={TONE[s]}>{t(`readiness.statuses.${s}`)}: {r.counts[s] ?? 0}</Badge>)}
      </div>

      <Card title={t("readiness.ownerTitle")} description={t("readiness.ownerIntro")} className="mt-6">
        <Table head={head}>{sorted.filter((it) => it.responsible !== "DEVELOPMENT").map(row)}</Table>
      </Card>
      <Card title={t("readiness.techTitle")} description={t("readiness.techIntro")} className="mt-6">
        <Table head={head}>{sorted.filter((it) => it.responsible === "DEVELOPMENT").map(row)}</Table>
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title={t("readiness.envTitle")} description={t("readiness.envIntro")}>
          <Table head={[t("readiness.variable"), t("common.status"), t("readiness.hint")]}>
            {r.env.map((c, n) => (
              <tr key={`${c.key}-${n}`}><Td className="font-mono text-xs">{c.key}</Td><Td><Badge tone={c.level === "ok" ? "success" : c.level === "error" ? "danger" : c.level === "warning" ? "warning" : "neutral"}>{t(`readiness.levels.${c.level}`)}</Badge></Td><Td className="text-xs">{c.code}{c.hint ? ` — ${c.hint}` : ""}</Td></tr>
            ))}
          </Table>
        </Card>
        <Card title={t("readiness.testsTitle")} description={t("readiness.testsIntro")}>
          <div className="flex flex-wrap gap-2">
            <ActionForm action={testEmailAction} className="space-y-0"><SubmitButton variant="secondary">{t("readiness.sendTestEmail")}</SubmitButton></ActionForm>
            <ActionForm action={testErrorAction} className="space-y-0"><SubmitButton variant="secondary">{t("readiness.sendTestError")}</SubmitButton></ActionForm>
          </div>
          <h3 className="mt-6 text-sm font-semibold">{t("readiness.evidenceTitle")}</h3>
          <p className="text-xs text-muted-foreground">{t("readiness.evidenceIntro")}</p>
          <ActionForm action={evidenceAction} resetOnSuccess>
            <Field label={t("readiness.requirement")} name="item"><Select name="item" defaultValue={EVIDENCE_ITEMS[0]}>{EVIDENCE_ITEMS.map((id) => <option key={id} value={id}>{id} · {r.items.find((i) => i.id === id)!.title[locale]}</option>)}</Select></Field>
            <Field label={t("readiness.reference")} name="reference" hint={t("readiness.referenceHint")}><Input name="reference" required /></Field>
            <Field label={t("common.notes")} name="note"><Input name="note" /></Field>
            <Checkbox name="confirm" label={t("readiness.confirmEvidence")} />
            <SubmitButton>{t("readiness.recordEvidence")}</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
