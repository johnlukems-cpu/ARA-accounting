import { getLocale } from "next-intl/server";
import { getContext } from "@/core/auth/context";
import { throttleResponse } from "@/core/ops/throttle";
import { portalQuotePdf } from "@/modules/admin/portal";

/** Customer portal: PDF of one of the customer's own quotations; opening it records "viewed". */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getContext();
  if (!ctx?.access || !ctx.mfaSatisfied) return new Response("Unauthorized", { status: 401 });
  const limited = await throttleResponse("download", ctx.user.id, ctx.access.organizationId);
  if (limited) return limited;
  try {
    const r = await portalQuotePdf(ctx.access, id, await getLocale());
    return new Response(Buffer.from(r.bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${r.number}.pdf"`, "Cache-Control": "no-store" } });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
