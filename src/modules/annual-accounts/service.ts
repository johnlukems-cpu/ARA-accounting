import Decimal from "decimal.js";
import type { AnnualFramework, Prisma } from "@prisma/client";
import type { Tx } from "@/core/db/client";
import { withTenant } from "@/core/tenancy/tenant";
import { audit } from "@/core/audit/audit";
import { assertCan, type Access } from "@/core/auth/access";
import { UserError } from "@/core/errors";
import { buildReports } from "@/modules/reporting/service";

const scope = (a: Access) => ({ organizationId: a.organizationId, userId: a.userId });
const json = (v: unknown) => v as Prisma.InputJsonValue;
export const FRAMEWORKS: AnnualFramework[] = ["NV_IFRS_SME", "NV_FULL_IFRS", "SOLE_PROPRIETOR", "FOUNDATION"];

/** Fixed-asset movement schedule per category for the year: cost and accumulated depreciation, opening → closing. */
export async function assetMovements(tx: Tx, administrationId: string, from: Date, to: Date) {
  const assets = await tx.asset.findMany({ where: { administrationId, acquisitionDate: { lte: to } }, include: { category: true, depreciation: true } });
  const posted = new Set((await tx.journalEntry.findMany({ where: { administrationId, sourceType: "DEPRECIATION", status: "POSTED" }, select: { id: true } })).map((e) => e.id));
  const byCat = new Map<string, { category: string; costOpening: Decimal; additions: Decimal; disposals: Decimal; depOpening: Decimal; depreciation: Decimal; depDisposals: Decimal }>();
  for (const a of assets) {
    const row = byCat.get(a.category.code) ?? { category: a.category.name, costOpening: new Decimal(0), additions: new Decimal(0), disposals: new Decimal(0), depOpening: new Decimal(0), depreciation: new Decimal(0), depDisposals: new Decimal(0) };
    const cost = new Decimal(a.acquisitionCost.toString());
    if (a.acquisitionDate < from) row.costOpening = row.costOpening.plus(cost);
    else row.additions = row.additions.plus(cost);
    const dep = (pred: (d: Date) => boolean) => a.depreciation.filter((d) => posted.has(d.entryId) && pred(new Date(Date.UTC(d.year, d.month - 1, 1)))).reduce((s, d) => s.plus(d.amount.toString()), new Decimal(0));
    const before = dep((d) => d < from);
    const during = dep((d) => d >= from && d <= to);
    if (a.acquisitionDate < from && !(a.disposedAt && a.disposedAt < from)) row.depOpening = row.depOpening.plus(before);
    if (a.disposedAt && a.disposedAt < from) row.costOpening = row.costOpening.minus(cost);
    row.depreciation = row.depreciation.plus(during);
    if (a.disposedAt && a.disposedAt >= from && a.disposedAt <= to) {
      row.disposals = row.disposals.plus(cost);
      row.depDisposals = row.depDisposals.plus(before.plus(during));
    }
    byCat.set(a.category.code, row);
  }
  return [...byCat.entries()].map(([code, r]) => {
    const costClosing = r.costOpening.plus(r.additions).minus(r.disposals);
    const depClosing = r.depOpening.plus(r.depreciation).minus(r.depDisposals);
    return { code, category: r.category, costOpening: r.costOpening.toFixed(2), additions: r.additions.toFixed(2), disposals: r.disposals.toFixed(2), costClosing: costClosing.toFixed(2), depOpening: r.depOpening.toFixed(2), depreciation: r.depreciation.toFixed(2), depDisposals: r.depDisposals.toFixed(2), depClosing: depClosing.toFixed(2), bookValue: costClosing.minus(depClosing).toFixed(2) };
  }).filter((r) => r.costClosing !== "0.00" || r.additions !== "0.00" || r.disposals !== "0.00");
}

/** Draft note texts per framework. They are starting points for the accountant; nothing here is a final legal text. */
function defaultNotes(framework: AnnualFramework, c: { name: string; legalForm: string; kkfNumber: string | null; address: string | null; district: string | null }, year: string) {
  const general = `${c.name} (${c.legalForm}${c.kkfNumber ? `, KKF ${c.kkfNumber}` : ""}) is gevestigd te ${[c.address, c.district].filter(Boolean).join(", ") || "Suriname"}. Deze jaarrekening betreft het boekjaar ${year}. Bedragen luiden in Surinaamse dollars (SRD), tenzij anders vermeld.`;
  const basis: Record<AnnualFramework, string> = {
    NV_IFRS_SME: "De jaarrekening is opgesteld met toepassing van de Wet op de Jaarrekening (S.B. 2017 no. 84), op basis van IFRS for SMEs. [CONCEPT: grondslagen te bevestigen door de accountant.]",
    NV_FULL_IFRS: "De jaarrekening is opgesteld met toepassing van de Wet op de Jaarrekening (S.B. 2017 no. 84), op basis van de volledige IFRS. [CONCEPT: grondslagen te bevestigen door de accountant.]",
    SOLE_PROPRIETOR: "Deze jaarstukken zijn opgesteld ten behoeve van de aangifte inkomstenbelasting en kredietverstrekkers. [CONCEPT: grondslagen te bevestigen door de accountant.]",
    FOUNDATION: "Deze jaarrekening bevat de staat van baten en lasten en het verloop van de bestemmingsfondsen. [CONCEPT: grondslagen te bevestigen door de accountant.]",
  };
  return [
    { code: "GENERAL", title: "Algemeen", body: general, auto: true },
    { code: "BASIS", title: "Grondslagen voor de opstelling", body: basis[framework], auto: true },
    { code: "VALUATION", title: "Grondslagen voor waardering en resultaatbepaling", body: "Activa en passiva worden gewaardeerd tegen nominale waarde, tenzij anders vermeld. Materiële vaste activa worden gewaardeerd tegen aanschafwaarde minus cumulatieve afschrijvingen; afschrijving vindt lineair of degressief plaats op basis van de geschatte gebruiksduur. Vorderingen in vreemde valuta worden omgerekend tegen de koers per balansdatum. [CONCEPT]", auto: true },
    { code: "FIXED_ASSETS", title: "Materiële vaste activa", body: "Het verloop is weergegeven in het overzicht van de materiële vaste activa.", auto: true },
    { code: "EQUITY", title: "Eigen vermogen", body: "Het verloop van het eigen vermogen is weergegeven in het vermogensverloop.", auto: true },
    { code: "SUBSEQUENT_EVENTS", title: "Gebeurtenissen na balansdatum", body: "Er hebben zich na balansdatum geen gebeurtenissen voorgedaan die van invloed zijn op het beeld van deze jaarrekening. [In te vullen of te bevestigen]", auto: false },
    ...(framework === "SOLE_PROPRIETOR" ? [{ code: "COMPILATION", title: "Samenstellingsverklaring", body: "[CONCEPT — de samenstellingsverklaring wordt afgegeven door de accountant en niet door ARA Accounting.]", auto: false }] : []),
  ];
}

async function snapshot(tx: Tx, administrationId: string, fiscalYearId: string) {
  const fy = await tx.fiscalYear.findUniqueOrThrow({ where: { id: fiscalYearId } });
  const r = await buildReports(tx, { administrationId, fiscalYearId, fromPeriod: 0, toPeriod: 13 });
  const assets = await assetMovements(tx, administrationId, fy.startDate, fy.endDate);
  return { data: { fiscalYear: r.fiscalYear, priorYear: r.priorYear, pl: r.pl, priorPl: r.priorPl, bs: r.bs, priorBs: r.priorBs, cashflow: r.cashflow, equity: r.equity, kpis: r.kpis, assets }, fingerprint: r.fingerprint, entryCount: r.entryCount };
}

export async function generateAnnualAccount(access: Access, input: { administrationId: string; fiscalYearId: string; framework: AnnualFramework }) {
  return withTenant(scope(access), async (tx) => {
    const admin = await tx.administration.findUnique({ where: { id: input.administrationId }, include: { company: true } });
    if (!admin) throw new UserError("errors.notFound");
    assertCan(access, "annualAccounts.edit", admin.companyId);
    const fy = await tx.fiscalYear.findUnique({ where: { id: input.fiscalYearId } });
    if (!fy || fy.administrationId !== admin.id) throw new UserError("errors.notFound");
    if (!FRAMEWORKS.includes(input.framework)) throw new UserError("validation.invalid");
    const snap = await snapshot(tx, admin.id, fy.id);
    const existing = await tx.annualAccount.findUnique({ where: { fiscalYearId: fy.id } });
    if (existing && existing.status !== "DRAFT") throw new UserError("annual.notDraft");
    const aa = existing
      ? await tx.annualAccount.update({ where: { id: existing.id }, data: { framework: input.framework, snapshot: json(snap.data), fingerprint: snap.fingerprint, entryCount: snap.entryCount } })
      : await tx.annualAccount.create({ data: { organizationId: access.organizationId, administrationId: admin.id, fiscalYearId: fy.id, framework: input.framework, snapshot: json(snap.data), fingerprint: snap.fingerprint, entryCount: snap.entryCount, createdById: access.userId } });
    // Notes: automatic ones are (re)written; manual ones are kept once edited.
    const notes = defaultNotes(input.framework, { name: admin.company.legalName || admin.company.name, legalForm: admin.company.legalForm, kkfNumber: admin.company.kkfNumber, address: admin.company.address, district: admin.company.district }, fy.code);
    for (const [i, n] of notes.entries()) {
      const cur = await tx.financialDisclosure.findUnique({ where: { annualAccountId_code: { annualAccountId: aa.id, code: n.code } } });
      if (!cur) await tx.financialDisclosure.create({ data: { organizationId: access.organizationId, annualAccountId: aa.id, code: n.code, title: n.title, body: n.body, sortOrder: (i + 1) * 10, auto: n.auto } });
      else if (cur.auto) await tx.financialDisclosure.update({ where: { id: cur.id }, data: { body: n.body, title: n.title } });
    }
    await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: existing ? "annual.regenerated" : "annual.generated", entity: "AnnualAccount", entityId: aa.id, details: { framework: input.framework, fingerprint: snap.fingerprint } });
    return aa;
  });
}

async function load(tx: Tx, id: string) {
  const aa = await tx.annualAccount.findUnique({ where: { id } });
  if (!aa) throw new UserError("errors.notFound");
  const admin = await tx.administration.findUniqueOrThrow({ where: { id: aa.administrationId } });
  return { aa, admin };
}

/** Editing a note makes it manual (it is no longer overwritten on regeneration). */
export async function saveDisclosure(access: Access, input: { annualAccountId: string; code: string; title: string; body: string }) {
  return withTenant(scope(access), async (tx) => {
    const { aa, admin } = await load(tx, input.annualAccountId);
    assertCan(access, "annualAccounts.edit", admin.companyId);
    if (aa.status !== "DRAFT") throw new UserError("annual.notDraft");
    const code = input.code.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_").slice(0, 40) || "NOTE";
    const cur = await tx.financialDisclosure.findUnique({ where: { annualAccountId_code: { annualAccountId: aa.id, code } } });
    const data = { title: input.title.trim().slice(0, 120), body: input.body.trim().slice(0, 20_000), auto: false };
    if (cur) await tx.financialDisclosure.update({ where: { id: cur.id }, data });
    else await tx.financialDisclosure.create({ data: { organizationId: access.organizationId, annualAccountId: aa.id, code, sortOrder: 900, ...data } });
    await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "annual.noteSaved", entity: "AnnualAccount", entityId: aa.id, details: { code } });
  });
}

export async function annualStep(access: Access, id: string, step: "submit" | "approve" | "return" | "finalize") {
  return withTenant(scope(access), async (tx) => {
    const { aa, admin } = await load(tx, id);
    if (step === "submit") {
      assertCan(access, "annualAccounts.edit", admin.companyId);
      if (aa.status !== "DRAFT") throw new UserError("annual.notDraft");
      await tx.annualAccount.update({ where: { id }, data: { status: "REVIEW", submittedById: access.userId } });
    } else if (step === "approve" || step === "return") {
      assertCan(access, "annualAccounts.approve", admin.companyId);
      // Returning is possible from review, and from approved (e.g. when the ledger changed before finalising).
      if (!(aa.status === "REVIEW" || (step === "return" && aa.status === "APPROVED"))) throw new UserError("ledger.wrongStatus");
      if (step === "return") await tx.annualAccount.update({ where: { id }, data: { status: "DRAFT", submittedById: null, approvedById: null, approvedAt: null } });
      else {
        if (aa.submittedById === access.userId) throw new UserError("ledger.segregation");
        await tx.annualAccount.update({ where: { id }, data: { status: "APPROVED", approvedById: access.userId, approvedAt: new Date() } });
      }
    } else {
      assertCan(access, "annualAccounts.approve", admin.companyId);
      if (aa.status !== "APPROVED") throw new UserError("ledger.wrongStatus");
      const fy = await tx.fiscalYear.findUniqueOrThrow({ where: { id: aa.fiscalYearId } });
      if (fy.status !== "CLOSED") throw new UserError("annual.yearNotClosed");
      // The ledger must be exactly what the accounts were generated from.
      const now = await snapshot(tx, aa.administrationId, aa.fiscalYearId);
      if (now.fingerprint !== aa.fingerprint) throw new UserError("annual.ledgerChanged");
      await tx.annualAccount.update({ where: { id }, data: { status: "FINAL", finalizedById: access.userId, finalizedAt: new Date() } });
    }
    await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: `annual.${step}`, entity: "AnnualAccount", entityId: id });
  });
}
