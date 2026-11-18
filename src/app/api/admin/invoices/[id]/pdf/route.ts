import { getLocale } from "next-intl/server";
import { getContext } from "@/core/auth/context";
import { can } from "@/core/auth/access";
import { withTenant } from "@/core/tenancy/tenant";
import { throttleResponse } from "@/core/ops/throttle";
import { adminAccess } from "@/modules/admin/home";
import { invoicePdfData } from "@/modules/invoicing/pdf-data";
import { renderInvoicePdf } from "@/modules/invoicing/pdf";

/** PDF of an invoice of ARA's own administration (independent of the organisation open in the accounting app). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getContext();
  if (!ctx || (ctx.user.mfaEnabled && !ctx.session.mfaVerifiedAt)) return new Response("Unauthorized", { status: 401 });
  const a = await adminAccess(ctx.user.id).catch(() => null);
  if (!a || !can(a.access, "sales.view", a.home.companyId)) return new Response("Not found", { status: 404 });
  const limited = await throttleResponse("export", ctx.user.id, a.home.organizationId);
  if (limited) return limited;
  const locale = await getLocale();
  const d = await withTenant(a.access, async (tx) => {
    const inv = await tx.invoice.findUnique({ where: { id }, select: { administrationId: true } });
    return inv?.administrationId === a.home.administrationId ? invoicePdfData(tx, id, locale) : null;
  });
  if (!d) return new Response("Not found", { status: 404 });
  const bytes = await renderInvoicePdf(d.data);
  return new Response(Buffer.from(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${d.data.invoice.number}.pdf"`, "Cache-Control": "no-store" } });
}
