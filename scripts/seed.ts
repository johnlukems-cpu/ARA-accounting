/**
 * Idempotent reference-data seed. Runs on every deployment (after `prisma migrate deploy`).
 * Phase 1: system roles and their permissions, synced from src/core/auth/permissions.ts.
 * Contains no demo or financial data.
 */
import { PrismaClient } from "@prisma/client";
import { ROLE_CODES, SYSTEM_ROLES } from "../src/core/auth/permissions";

export async function seedReferenceData(db: PrismaClient) {
  for (const code of ROLE_CODES) {
    const def = SYSTEM_ROLES[code];
    // organizationId is null for system roles; Prisma cannot upsert on a compound key containing null.
    const existing = await db.role.findFirst({ where: { organizationId: null, code } });
    const role = existing
      ? await db.role.update({ where: { id: existing.id }, data: { name: def.name, nameEn: def.nameEn, orgWide: def.orgWide, isSystem: true } })
      : await db.role.create({ data: { code, name: def.name, nameEn: def.nameEn, orgWide: def.orgWide, isSystem: true } });
    await db.$transaction([
      db.rolePermission.deleteMany({ where: { roleId: role.id, permission: { notIn: def.permissions } } }),
      db.rolePermission.createMany({ data: def.permissions.map((permission) => ({ roleId: role.id, permission })), skipDuplicates: true }),
    ]);
  }
}

if (process.argv[1]?.endsWith("seed.ts")) {
  const db = new PrismaClient();
  seedReferenceData(db)
    .then(() => console.log("Reference data seeded."))
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => db.$disconnect());
}
