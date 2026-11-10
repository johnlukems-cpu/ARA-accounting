import type { z } from "zod";
import { Prisma } from "@prisma/client";
import type { Tx } from "@/core/db/client";
import { withTenant } from "@/core/tenancy/tenant";
import { audit } from "@/core/audit/audit";
import { assertCan, type Access } from "@/core/auth/access";
import { UserError } from "@/core/errors";
import * as engine from "@/core/ledger/engine";
import { defaultNormalBalance, STANDARD_CHART, STANDARD_JOURNALS } from "./standard-chart";
import type { accountSchema, accountUpdateSchema, dimensionSchema, entrySchema, journalSchema, reverseSchema } from "./schemas";

const scope = (a: Access) => ({ organizationId: a.organizationId, userId: a.userId });

async function adminFor(tx: Tx, administrationId: string) {
  const admin = await tx.administration.findUnique({ where: { id: administrationId } });
  if (!admin) throw new UserError("errors.notFound");
  return admin;
}

function unique(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw new UserError("errors.codeTaken");
  throw err;
}

// ───────────── Set-up of a new administration ─────────────

/** Creates the standard chart of accounts and journals (inside the administration-creation transaction). */
export async function installStandardChart(tx: Tx, organizationId: string, administrationId: string) {
  const ids = new Map<string, string>();
  for (const a of STANDARD_CHART) {
    const row = await tx.account.create({
      data: {
        organizationId, administrationId, number: a.number, name: a.name, nameEn: a.nameEn, category: a.category,
        type: a.header ? "HEADER" : "DETAIL", parentId: a.parent ? ids.get(a.parent) : null,
        normalBalance: a.normal ?? defaultNormalBalance(a.category), controlType: a.control ?? "NONE",
        currency: a.currency ?? null, templateAccountRef: `ARA-STD:${a.number}`,
      },
    });
    ids.set(a.number, row.id);
  }
  await tx.journal.createMany({ data: STANDARD_JOURNALS.map((j) => ({ organizationId, administrationId, code: j.code, name: j.name, type: j.type, requiresApproval: j.requiresApproval ?? false })) });
}

// ───────────── Accounts ─────────────

export async function createAccount(access: Access, input: z.infer<typeof accountSchema>) {
  return withTenant(scope(access), async (tx) => {
    const admin = await adminFor(tx, input.administrationId);
    assertCan(access, "administrations.edit", admin.companyId);
    if (input.parentId) {
      const parent = await tx.account.findUnique({ where: { id: input.parentId } });
      if (!parent || parent.administrationId !== admin.id || parent.type !== "HEADER") throw new UserError("ledger.invalidParent");
    }
    try {
      const account = await tx.account.create({
        data: {
          organizationId: access.organizationId, administrationId: admin.id, number: input.number, name: input.name, nameEn: input.nameEn,
          description: input.description, category: input.category, type: input.type, parentId: input.parentId ?? null,
          normalBalance: input.normalBalance ?? defaultNormalBalance(input.category), controlType: input.controlType, currency: input.currency ?? null,
        },
      });
      await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "account.created", entity: "Account", entityId: account.id, details: { number: account.number, name: account.name } });
      return account;
    } catch (err) {
      unique(err);
    }
  });
}

/** Name, description, parent and status can change; number, category and type are fixed once created. */
export async function updateAccount(access: Access, input: z.infer<typeof accountUpdateSchema>) {
  return withTenant(scope(access), async (tx) => {
    const account = await tx.account.findUnique({ where: { id: input.id } });
    if (!account) throw new UserError("errors.notFound");
    const admin = await adminFor(tx, account.administrationId);
    assertCan(access, "administrations.edit", admin.companyId);
    if (input.parentId && input.parentId !== account.parentId) {
      const parent = await tx.account.findUnique({ where: { id: input.parentId } });
      if (!parent || parent.administrationId !== admin.id || parent.type !== "HEADER" || parent.id === account.id) throw new UserError("ledger.invalidParent");
    }
    if (input.status === "ARCHIVED" && account.status === "ACTIVE") {
      const children = await tx.account.count({ where: { parentId: account.id, status: "ACTIVE" } });
      if (children > 0) throw new UserError("ledger.archiveHasChildren");
      const [bal] = await tx.$queryRaw<{ d: Prisma.Decimal | null; c: Prisma.Decimal | null; open: bigint }[]>`
        SELECT SUM(l."debitBase") d, SUM(l."creditBase") c,
               COUNT(*) FILTER (WHERE e.status <> 'POSTED') open
          FROM "JournalLine" l JOIN "JournalEntry" e ON e.id = l."entryId" WHERE l."accountId" = ${account.id}`;
      if ((bal?.open ?? BigInt(0)) > BigInt(0)) throw new UserError("ledger.archiveHasDrafts");
      if (bal && bal.d && bal.c && !new Prisma.Decimal(bal.d).equals(bal.c)) throw new UserError("ledger.archiveHasBalance");
    }
    const updated = await tx.account.update({
      where: { id: account.id },
      data: { name: input.name, nameEn: input.nameEn ?? null, description: input.description ?? null, parentId: input.parentId ?? account.parentId, status: input.status },
    });
    await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "account.updated", entity: "Account", entityId: account.id, details: { from: { name: account.name, status: account.status }, to: { name: input.name, status: input.status } } });
    return updated;
  });
}

// ───────────── Journals and dimensions ─────────────

export async function saveJournal(access: Access, input: z.infer<typeof journalSchema> & { id?: string }) {
  return withTenant(scope(access), async (tx) => {
    const admin = await adminFor(tx, input.administrationId);
    assertCan(access, "administrations.edit", admin.companyId);
    try {
      if (input.id) {
        const j = await tx.journal.findUnique({ where: { id: input.id } });
        if (!j || j.administrationId !== admin.id) throw new UserError("errors.notFound");
        const used = await tx.journalEntry.count({ where: { journalId: j.id } });
        if (used > 0 && j.type !== input.type) throw new UserError("ledger.journalTypeLocked");
        const updated = await tx.journal.update({ where: { id: j.id }, data: { name: input.name, type: input.type, requiresApproval: input.requiresApproval } });
        await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "journal.updated", entity: "Journal", entityId: j.id, details: input });
        return updated;
      }
      const j = await tx.journal.create({ data: { organizationId: access.organizationId, administrationId: admin.id, code: input.code.toUpperCase(), name: input.name, type: input.type, requiresApproval: input.requiresApproval } });
      await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "journal.created", entity: "Journal", entityId: j.id, details: input });
      return j;
    } catch (err) {
      if (err instanceof UserError) throw err;
      unique(err);
    }
  });
}

export async function createDimension(access: Access, input: z.infer<typeof dimensionSchema>) {
  return withTenant(scope(access), async (tx) => {
    const admin = await adminFor(tx, input.administrationId);
    assertCan(access, "administrations.edit", admin.companyId);
    try {
      const d = await tx.dimensionValue.create({ data: { organizationId: access.organizationId, ...input, code: input.code.toUpperCase() } });
      await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "dimension.created", entity: "DimensionValue", entityId: d.id, details: input });
      return d;
    } catch (err) {
      unique(err);
    }
  });
}

// ───────────── Entries (thin wrappers around the engine) ─────────────

type EntryForm = z.infer<typeof entrySchema>;

export const saveDraft = (access: Access, input: EntryForm, entryId?: string) =>
  withTenant(scope(access), (tx) => (entryId ? engine.updateDraft(tx, access, entryId, input) : engine.createEntry(tx, access, input)));

export const submit = (access: Access, entryId: string) => withTenant(scope(access), (tx) => engine.submitEntry(tx, access, entryId));
export const approve = (access: Access, entryId: string) => withTenant(scope(access), (tx) => engine.approveEntry(tx, access, entryId));
export const post = (access: Access, entryId: string) => withTenant(scope(access), (tx) => engine.postEntry(tx, access, entryId));
export const removeDraft = (access: Access, entryId: string) => withTenant(scope(access), (tx) => engine.deleteDraft(tx, access, entryId));

export const reverse = (access: Access, input: z.infer<typeof reverseSchema>) =>
  withTenant(scope(access), (tx) =>
    input.mode === "correct"
      ? engine.correctEntry(tx, access, input.entryId, input).then((r) => r.draft)
      : engine.reverseEntry(tx, access, input.entryId, input),
  );
