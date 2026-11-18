import { systemDb } from "@/core/db/client";
import { resolveAccess } from "@/core/auth/access";
import { adminAccess, bootstrapHome, getHome, type AdminContext } from "@/modules/admin/home";
import { newOrganization } from "./helpers";

/**
 * ARA's own organisation is a platform singleton. The first test run creates it through the real bootstrap; later runs
 * reuse it and add a fresh ARA Super Administrator (or another staff role) for isolation between tests.
 */
export async function staff(roleCode = "ARA_SUPER_ADMIN"): Promise<AdminContext> {
  let home = await getHome();
  const o = await newOrganization();
  await systemDb.user.update({ where: { id: o.userId }, data: { isPlatformAdmin: true } });
  if (!home) home = await bootstrapHome(o.userId, { organizationName: "ARA Intelligent Solutions", companyName: "ARA Intelligent Solutions", legalForm: "NV", isBtwRegistered: true, baseCurrency: "SRD", startYear: new Date().getUTCFullYear() });
  const role = await systemDb.role.findFirstOrThrow({ where: { code: roleCode, organizationId: null } });
  await systemDb.organizationMembership.upsert({
    where: { organizationId_userId: { organizationId: home.organizationId, userId: o.userId } },
    update: { roleId: role.id, status: "ACTIVE" },
    create: { organizationId: home.organizationId, userId: o.userId, roleId: role.id, status: "ACTIVE" },
  });
  return adminAccess(o.userId);
}

export async function homeAccess(userId: string) {
  const home = (await getHome())!;
  return (await resolveAccess(userId, home.organizationId))!;
}
