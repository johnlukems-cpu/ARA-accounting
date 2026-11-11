import { getContext } from "@/core/auth/context";
import { can } from "@/core/auth/access";
import { withTenant } from "@/core/tenancy/tenant";
import { throttleResponse } from "@/core/ops/throttle";

/** Serves a stored document (inline). The sandbox CSP keeps any active content in a PDF from running in our origin. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getContext();
  if (!ctx?.access || !ctx.mfaSatisfied) return new Response("Unauthorized", { status: 401 });
  const limited = await throttleResponse("download", ctx.user.id, ctx.access.organizationId);
  if (limited) return limited;
  const r = await withTenant(ctx.access, async (tx) => {
    const doc = await tx.document.findUnique({ where: { id } });
    if (!doc) return null;
    const admin = await tx.administration.findUniqueOrThrow({ where: { id: doc.administrationId } });
    if (!can(ctx.access!, "scan.view", admin.companyId)) return "forbidden" as const;
    const file = await tx.documentFile.findUnique({ where: { documentId: id } });
    return file ? { doc, data: file.data } : null;
  });
  if (!r) return new Response("Not found", { status: 404 });
  if (r === "forbidden") return new Response("Forbidden", { status: 403 });
  return new Response(new Uint8Array(r.data), {
    headers: {
      "Content-Type": r.doc.mimeType,
      "Content-Disposition": `inline; filename="${r.doc.fileName.replace(/[^\w.-]/g, "_")}"`,
      "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
