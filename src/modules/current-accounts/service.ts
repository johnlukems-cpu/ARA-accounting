import Decimal from "decimal.js";
import { z } from "zod";
import type { Tx } from "@/core/db/client";
import { withTenant } from "@/core/tenancy/tenant";
import { audit } from "@/core/audit/audit";
import { assertCan, type Access } from "@/core/auth/access";
import { UserError } from "@/core/errors";
import * as engine from "@/core/ledger/engine";

/**
 * Current accounts (rekening-courant). Each has its own control account (type CURRENT_ACCOUNT); every movement is a
 * journal entry through the engine (ACCOUNTING_RULES S5). Positive balance = the counterparty owes the company.
 */
const scope = (a: Access) => ({ organizationId: a.organizationId, userId: a.userId });
const amountStr = z.string().trim().transform((v) => v.replace(",", ".")).pipe(z.string().regex(/^\d+(\.\d+)?$/, "validation.amount"));

export const currentAccountSchema = z.object({
  administrationId: z.string().min(1),
  kind: z.enum(["DIRECTOR", "SHAREHOLDER", "RELATED_PARTY", "INTERCOMPANY"]),
  counterpartyName: z.string().trim().min(2, "validation.required").max(160),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "validation.currency").default("SRD"),
  interestRatePct: z.string().trim().transform((v) => v.replace(",", ".")).pipe(z.string().regex(/^(\d+(\.\d+)?)?$/, "validation.amount")).optional().transform((v) => v || undefined),
  agreement: z.string().trim().max(1000).optional(),
});

export const movementSchema = z.object({
  currentAccountId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "validation.date"),
  /** INCREASE: the counterparty owes more (company paid for/lent to them). DECREASE: they repaid or paid on the company's behalf. */
  direction: z.enum(["INCREASE", "DECREASE"]),
  amount: amountStr,
  counterAccountId: z.string().min(1, "validation.required"),
  description: z.string().trim().min(2, "validation.required").max(300),
  exchangeRate: z.string().optional().transform((v) => (v ? v.replace(",", ".") : undefined)),
});

async function adminFor(tx: Tx, id: string) {
  const admin = await tx.administration.findUnique({ where: { id } });
  if (!admin) throw new UserError("errors.notFound");
  return admin;
}

export async function createCurrentAccount(access: Access, input: z.infer<typeof currentAccountSchema>) {
  return withTenant(scope(access), async (tx) => {
    const admin = await adminFor(tx, input.administrationId);
    assertCan(access, "currentAccounts.create", admin.companyId);
    // Shareholder accounts sit under short-term liabilities (1600), the others under receivables (1300).
    const liability = input.kind === "SHAREHOLDER";
    const header = await tx.account.findFirst({ where: { administrationId: admin.id, number: liability ? "1600" : "1300", type: "HEADER" } });
    const used = new Set((await tx.account.findMany({ where: { administrationId: admin.id }, select: { number: true } })).map((a) => a.number));
    let n = liability ? 1651 : 1351;
    while (used.has(String(n))) n++;
    const account = await tx.account.create({
      data: {
        organizationId: access.organizationId, administrationId: admin.id, number: String(n), name: `R/C ${input.counterpartyName}`.slice(0, 120), category: liability ? "LIABILITY" : "ASSET",
        type: "DETAIL", parentId: header?.id ?? null, normalBalance: liability ? "CREDIT" : "DEBIT", controlType: "CURRENT_ACCOUNT", currency: input.currency === admin.baseCurrency ? null : input.currency,
      },
    });
    const ca = await tx.currentAccount.create({
      data: { organizationId: access.organizationId, administrationId: admin.id, kind: input.kind, counterpartyName: input.counterpartyName, ledgerAccountId: account.id, currency: input.currency, interestRatePct: input.interestRatePct ?? null, agreement: input.agreement || null },
    });
    await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "currentAccount.created", entity: "CurrentAccount", entityId: ca.id, details: { kind: input.kind, name: input.counterpartyName, ledger: account.number } });
    return ca;
  });
}

export async function recordMovement(access: Access, input: z.infer<typeof movementSchema>) {
  return withTenant(scope(access), async (tx) => {
    const ca = await tx.currentAccount.findUnique({ where: { id: input.currentAccountId } });
    if (!ca) throw new UserError("errors.notFound");
    const admin = await adminFor(tx, ca.administrationId);
    assertCan(access, "currentAccounts.post", admin.companyId);
    const counter = await tx.account.findUnique({ where: { id: input.counterAccountId } });
    if (!counter || counter.administrationId !== admin.id || counter.id === ca.ledgerAccountId || ["RECEIVABLE", "PAYABLE", "FIXED_ASSET"].includes(counter.controlType)) throw new UserError("currentAccounts.invalidCounterAccount");
    const fx = ca.currency === admin.baseCurrency ? {} : { currency: ca.currency, rate: input.exchangeRate };
    if (ca.currency !== admin.baseCurrency && !input.exchangeRate) throw new UserError("invoicing.rateRequired", { currency: ca.currency });
    const counterFx = counter.currency && counter.currency !== admin.baseCurrency ? { currency: counter.currency, rate: input.exchangeRate } : counter.currency ? {} : fx;
    const up = input.direction === "INCREASE";
    const journal = await tx.journal.findFirst({ where: { administrationId: admin.id, type: "GENERAL", status: "ACTIVE" }, orderBy: { code: "asc" } });
    if (!journal) throw new UserError("ledger.invalidJournal");
    const entry = await engine.createAndPost(tx, access, {
      administrationId: admin.id, journalId: journal.id, entryDate: input.date, description: `R/C ${ca.counterpartyName}: ${input.description}`.slice(0, 500),
      lines: [
        { accountId: ca.ledgerAccountId, description: input.description, ...(up ? { debit: input.amount } : { credit: input.amount }), ...fx },
        { accountId: counter.id, description: input.description, ...(up ? { credit: input.amount } : { debit: input.amount }), ...counterFx },
      ],
      sourceType: "CURRENT_ACCOUNT", sourceId: ca.id,
    });
    await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "currentAccount.movement", entity: "CurrentAccount", entityId: ca.id, details: { direction: input.direction, amount: input.amount, entryId: entry.id } });
    return entry;
  });
}

export async function currentAccountBalance(tx: Tx, ledgerAccountId: string, upTo: Date) {
  const [r] = await tx.$queryRaw<{ tx: string | null; base: string | null }[]>`
    SELECT SUM(l."txAmount")::text AS tx, SUM(l."debitBase" - l."creditBase")::text AS base
      FROM "JournalLine" l JOIN "JournalEntry" e ON e.id = l."entryId"
     WHERE l."accountId" = ${ledgerAccountId} AND e.status = 'POSTED' AND e."entryDate" <= ${upTo}`;
  return { tx: new Decimal(r?.tx ?? 0), base: new Decimal(r?.base ?? 0) };
}

/** Records the balance confirmed by the counterparty and the difference with the ledger (reconciliation). */
export async function confirmBalance(access: Access, input: { currentAccountId: string; date: string; confirmedBalance: string; notes?: string }) {
  return withTenant(scope(access), async (tx) => {
    const ca = await tx.currentAccount.findUnique({ where: { id: input.currentAccountId } });
    if (!ca) throw new UserError("errors.notFound");
    const admin = await adminFor(tx, ca.administrationId);
    assertCan(access, "currentAccounts.edit", admin.companyId);
    const bal = await currentAccountBalance(tx, ca.ledgerAccountId, new Date(`${input.date}T00:00:00Z`));
    const ledger = ca.currency === admin.baseCurrency ? bal.base : bal.tx;
    const confirmed = new Decimal(input.confirmedBalance);
    const c = await tx.currentAccountConfirmation.create({
      data: { organizationId: access.organizationId, currentAccountId: ca.id, date: new Date(`${input.date}T00:00:00Z`), confirmedBalance: confirmed.toFixed(2), ledgerBalance: ledger.toFixed(2), difference: confirmed.minus(ledger).toFixed(2), notes: input.notes || null, createdById: access.userId },
    });
    await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "currentAccount.confirmed", entity: "CurrentAccount", entityId: ca.id, details: { confirmed: confirmed.toFixed(2), ledger: ledger.toFixed(2) } });
    return c;
  });
}
