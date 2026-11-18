import { z } from "zod";
import { audit } from "@/core/audit/audit";
import { UserError } from "@/core/errors";
import { inviteMember, updateMembership } from "@/modules/organization/service";
import { STAFF_ROLES, type RoleCode } from "@/core/auth/permissions";
import { inHome } from "./common";
import type { AdminContext } from "./home";

export const staffInviteSchema = z.object({
  email: z.string().trim().toLowerCase().email("validation.email"),
  name: z.string().trim().min(2, "validation.required").max(120),
  roleCode: z.enum(STAFF_ROLES as [RoleCode, ...RoleCode[]]),
  jobTitle: z.string().trim().max(80).optional().transform((v) => v || null),
  department: z.string().trim().max(80).optional().transform((v) => v || null),
});

/** Invites an employee with a staff role (membership of ARA's organisation) and adds them to the staff directory. */
export async function inviteStaff(ctx: AdminContext, raw: z.input<typeof staffInviteSchema>) {
  const input = staffInviteSchema.parse(raw);
  const result = await inviteMember(ctx.access, { email: input.email, name: input.name, roleCode: input.roleCode });
  await inHome(ctx, "organization.manageUsers", async (tx) => {
    const m = await tx.organizationMembership.findUniqueOrThrow({ where: { id: result.membershipId } });
    await tx.employee.create({ data: { organizationId: ctx.home.organizationId, userId: m.userId, name: input.name, email: input.email, jobTitle: input.jobTitle, department: input.department, startDate: new Date() } });
  });
  return result;
}

export async function changeStaffRole(ctx: AdminContext, membershipId: string, roleCode: RoleCode | null, status?: "ACTIVE" | "DISABLED") {
  if (roleCode && !STAFF_ROLES.includes(roleCode)) throw new UserError("errors.roleNotAllowed");
  return updateMembership(ctx.access, { membershipId, ...(roleCode ? { roleCode } : {}), ...(status ? { status } : {}) });
}

export const employeeSchema = z.object({
  id: z.string().optional().transform((v) => v || undefined),
  name: z.string().trim().min(2, "validation.required").max(120),
  email: z.string().trim().toLowerCase().email("validation.email").or(z.literal("")).optional().transform((v) => v || null),
  jobTitle: z.string().trim().max(80).optional().transform((v) => v || null),
  department: z.string().trim().max(80).optional().transform((v) => v || null),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("").transform(() => undefined)),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("").transform(() => undefined)),
});

export async function saveEmployee(ctx: AdminContext, raw: z.input<typeof employeeSchema>) {
  const e = employeeSchema.parse(raw);
  return inHome(ctx, "organization.manageUsers", async (tx) => {
    const data = { name: e.name, email: e.email, jobTitle: e.jobTitle, department: e.department, startDate: e.startDate ? new Date(`${e.startDate}T00:00:00Z`) : null, endDate: e.endDate ? new Date(`${e.endDate}T00:00:00Z`) : null, status: e.endDate ? ("ARCHIVED" as const) : ("ACTIVE" as const) };
    const row = e.id ? await tx.employee.update({ where: { id: e.id }, data }) : await tx.employee.create({ data: { ...data, organizationId: ctx.home.organizationId } });
    await audit(tx, { organizationId: ctx.home.organizationId, userId: ctx.access.userId, action: e.id ? "staff.employeeUpdated" : "staff.employeeCreated", entity: "Employee", entityId: row.id });
    return row;
  });
}
