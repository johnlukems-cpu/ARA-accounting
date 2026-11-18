import { getLocale } from "next-intl/server";
import { getContext } from "@/core/auth/context";
import { can } from "@/core/auth/access";
import { withTenant } from "@/core/tenancy/tenant";
import { throttleResponse } from "@/core/ops/throttle";
import { adminAccess } from "@/modules/admin/home";
import { quotePdf } from "@/modules/admin/quotes";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getContext();
  if (!ctx || (ctx.user.mfaEnabled && !ctx.session.mfaVerifiedAt)) return new Response("Unauthorized", { status: 401 });
  const a = await adminAccess(ctx.user.id).catch(() => null);
  if (!a || !can(a.access, "quotes.view", a.home.companyId)) return new Response("Not found", { status: 404 });
  const limited = await throttleResponse("export", ctx.user.id, a.home.organizationId);
  if (limited) return limited;
  try {
    const { bytes, number } = await withTenant(a.access, async (tx) => ({ bytes: await quotePdf(tx, a, id, await getLocale()), number: (await tx.quotation.findUniqueOrThrow({ where: { id } })).number }));
    return new Response(Buffer.from(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${number}.pdf"`, "Cache-Control": "no-store" } });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
