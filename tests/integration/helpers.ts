import { randomBytes } from "node:crypto";
import { resolveAccess, type Access } from "@/core/auth/access";
import { registerOrganization } from "@/modules/organization/service";

export function uid(prefix = "t") {
  return `${prefix}${randomBytes(5).toString("hex")}`;
}

export async function newOrganization(kind: "BUSINESS" | "ACCOUNTING_FIRM" = "BUSINESS") {
  const email = `${uid("owner")}@example.test`;
  const { userId, organizationId } = await registerOrganization({
    kind,
    organizationName: `Org ${uid()}`,
    name: "Test Owner",
    email,
    password: "a-long-test-password",
  });
  return { userId, organizationId, email, access: (await resolveAccess(userId, organizationId))! };
}

/** Re-resolves access (needed after creating companies or assignments). */
export async function refresh(access: Access): Promise<Access> {
  return (await resolveAccess(access.userId, access.organizationId))!;
}

export const companyInput = (name = `Bedrijf ${uid()}`) => ({
  name,
  legalForm: "NV" as const,
  isBtwRegistered: true,
  district: "PARAMARIBO" as const,
});
