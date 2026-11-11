import Decimal from "decimal.js";
import type { Tx } from "@/core/db/client";
import { agingBucket, daysBetween, DEFAULT_AGING_BUCKETS } from "./domain";

/**
 * Aging analysis per party as of a date, per currency (amounts are never added across currencies).
 * Buckets: current (not due), then the given boundaries in days overdue (default 30/60/90).
 */
export async function aging(tx: Tx, args: { administrationId: string; side: "RECEIVABLE" | "PAYABLE"; asOf: Date; boundaries?: number[] }) {
  const boundaries = args.boundaries ?? DEFAULT_AGING_BUCKETS;
  const items = await tx.openItem.findMany({
    where: { administrationId: args.administrationId, side: args.side, status: "OPEN", date: { lte: args.asOf } },
    include: { party: { select: { id: true, code: true, name: true } } },
    orderBy: [{ dueDate: "asc" }],
  });
  const rows = new Map<string, { partyId: string; code: string; name: string; currency: string; buckets: Decimal[]; total: Decimal; items: typeof items }>();
  for (const it of items) {
    const key = `${it.partyId}|${it.currency}`;
    const row = rows.get(key) ?? { partyId: it.party?.id ?? "", code: it.party?.code ?? "", name: it.party?.name ?? "—", currency: it.currency, buckets: Array.from({ length: boundaries.length + 1 }, () => new Decimal(0)), total: new Decimal(0), items: [] };
    const b = agingBucket(daysBetween(it.dueDate, args.asOf), boundaries);
    row.buckets[b] = row.buckets[b]!.plus(it.remainingAmount.toString());
    row.total = row.total.plus(it.remainingAmount.toString());
    row.items.push(it);
    rows.set(key, row);
  }
  const list = [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
  const totals = new Map<string, Decimal[]>();
  for (const r of list) {
    const t = totals.get(r.currency) ?? Array.from({ length: boundaries.length + 2 }, () => new Decimal(0));
    r.buckets.forEach((v, i) => (t[i] = t[i]!.plus(v)));
    t[boundaries.length + 1] = t[boundaries.length + 1]!.plus(r.total);
    totals.set(r.currency, t);
  }
  return { boundaries, rows: list, totals };
}

/** Party statement: open items at the end date plus all invoices, payments and offsets in the period. */
export async function partyStatement(tx: Tx, args: { partyId: string; from: Date; to: Date }) {
  const items = await tx.openItem.findMany({
    where: { partyId: args.partyId, date: { lte: args.to } },
    include: { allocations: { include: { payment: { select: { date: true, reference: true } } } } },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
  });
  const movements: { date: Date; document: string; description: string; currency: string; amount: Decimal }[] = [];
  for (const it of items) {
    if (it.date >= args.from) movements.push({ date: it.date, document: it.documentNumber, description: it.description ?? "", currency: it.currency, amount: new Decimal(it.originalAmount.toString()) });
    for (const a of it.allocations) {
      const d = a.payment?.date ?? a.createdAt;
      if (d >= args.from && d <= args.to) {
        const sign = new Decimal(it.originalAmount.toString()).lt(0) ? 1 : -1;
        movements.push({ date: d, document: a.payment?.reference ?? it.documentNumber, description: a.paymentId ? "Betaling" : "Verrekening", currency: it.currency, amount: new Decimal(a.amount.toString()).times(sign) });
      }
    }
  }
  movements.sort((a, b) => a.date.getTime() - b.date.getTime());
  const open = items.filter((i) => i.status === "OPEN");
  const balances = new Map<string, Decimal>();
  for (const i of open) balances.set(i.currency, (balances.get(i.currency) ?? new Decimal(0)).plus(i.remainingAmount.toString()));
  return { movements, open, balances };
}

/**
 * Sub-ledger reconciliation (ACCOUNTING_RULES S2): Σ open items at their original rate = control account balance (base).
 * Returns the difference per control account; a non-zero difference is a quality issue. Period-end revaluations
 * (C5, source FX_REVALUATION) are valuation adjustments outside the sub-ledger and are excluded from the comparison.
 */
export async function controlAccountCheck(tx: Tx, administrationId: string) {
  const rows = await tx.$queryRaw<{ accountId: string; number: string; name: string; ledger: string; subledger: string }[]>`
    SELECT a.id AS "accountId", a.number, a.name,
           COALESCE((SELECT SUM(l."debitBase" - l."creditBase") FROM "JournalLine" l JOIN "JournalEntry" e ON e.id = l."entryId"
                     WHERE l."accountId" = a.id AND e.status = 'POSTED' AND e."sourceType" <> 'FX_REVALUATION'), 0)::text AS ledger,
           COALESCE((SELECT SUM(ROUND(o."remainingAmount" * o."originalRate", 2) * CASE WHEN o.side = 'PAYABLE' THEN -1 ELSE 1 END)
                     FROM "OpenItem" o WHERE o."ledgerAccountId" = a.id AND o.status = 'OPEN'), 0)::text AS subledger
      FROM "Account" a
     WHERE a."administrationId" = ${administrationId} AND a."controlType" IN ('RECEIVABLE', 'PAYABLE') AND a.type = 'DETAIL'
     ORDER BY a.number`;
  return rows.map((r) => ({ ...r, difference: new Decimal(r.ledger).minus(r.subledger).toFixed(2) }));
}
