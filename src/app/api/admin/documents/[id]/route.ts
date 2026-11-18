import { getContext } from "@/core/auth/context";
import { throttleResponse } from "@/core/ops/throttle";
import { adminAccess } from "@/modules/admin/home";
import { downloadAdminDocument } from "@/modules/admin/crm";

/** Authorised download of an admin-portal document (private storage; never a public URL). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getContext();
  if (!ctx || (ctx.user.mfaEnabled && !ctx.session.mfaVerifiedAt)) return new Response("Unauthorized", { status: 401 });
  const a = await adminAccess(ctx.user.id).catch(() => null);
  if (!a) return new Response("Not found", { status: 404 });
  const limited = await throttleResponse("download", ctx.user.id, a.home.organizationId);
  if (limited) return limited;
  try {
    const { doc, bytes } = await downloadAdminDocument(a, id);
    return new Response(Buffer.from(bytes), { headers: { "Content-Type": doc.mimeType, "Content-Disposition": `attachment; filename="${doc.fileName.replace(/[^\w.-]/g, "_")}"`, "Content-Security-Policy": "sandbox", "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" } });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
