import { getLocale } from "next-intl/server";
import { getContext } from "@/core/auth/context";
import { can } from "@/core/auth/access";
import { withTenant } from "@/core/tenancy/tenant";
import { audit } from "@/core/audit/audit";
import { invoicePdfData } from "@/modules/invoicing/pdf-data";
import { renderInvoicePdf } from "@/modules/invoicing/pdf";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getContext();
  if (!ctx?.access || !ctx.mfaSatisfied) return new Response("Unauthorized", { status: 401 });
  const locale = await getLocale();
  const result = await withTenant(ctx.access, async (tx) => {
    const r = await invoicePdfData(tx, id, locale);
    if (!r) return null;
    if (!can(ctx.access!, r.type === "SALES" ? "sales.view" : "purchase.view", r.companyId)) return "forbidden" as const;
    await audit(tx, { organizationId: ctx.access!.organizationId, userId: ctx.user.id, action: "invoice.pdfDownloaded", entity: "Invoice", entityId: id });
    return r;
  });
  if (!result) return new Response("Not found", { status: 404 });
  if (result === "forbidden") return new Response("Forbidden", { status: 403 });
  const bytes = await renderInvoicePdf(result.data);
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${(result.data.invoice.number || "factuur").replace(/[^\w.-]/g, "_")}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
