import { getContext } from "@/core/auth/context";
import { can } from "@/core/auth/access";
import { withTenant } from "@/core/tenancy/tenant";
import { audit } from "@/core/audit/audit";
import { exportVersion } from "@/modules/industry/service";
import { throttleResponse } from "@/core/ops/throttle";

/** Downloads a template version as JSON (format "ara-industry-template" v1), importable with the template builder. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getContext();
  if (!ctx?.access || !ctx.mfaSatisfied) return new Response("Unauthorized", { status: 401 });
  const limited = await throttleResponse("export", ctx.user.id, ctx.access.organizationId);
  if (limited) return limited;
  if (!can(ctx.access, "industry.view")) return new Response("Forbidden", { status: 403 });
  const doc = await withTenant(ctx.access, async (tx) => {
    const d = await exportVersion(tx, id);
    if (d) await audit(tx, { organizationId: ctx.access!.organizationId, userId: ctx.user.id, action: "industry.exported", entity: "IndustryTemplateVersion", entityId: id, details: { code: d.code, version: d.version } });
    return d;
  });
  if (!doc) return new Response("Not found", { status: 404 });
  return new Response(JSON.stringify(doc, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${doc.code.replace(/[^\w-]/g, "_")}-v${doc.version}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
