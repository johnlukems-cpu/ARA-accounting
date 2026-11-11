"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { PDFDocument } from "pdf-lib";
import { z } from "zod";
import { requireActionContext } from "@/core/auth/context";
import { UserError } from "@/core/errors";
import { parseAmount } from "@/core/money";
import { sniffMime } from "@/modules/scan/domain";
import * as scan from "@/modules/scan/service";
import { bool, formObject, okState, toActionState, type ActionState } from "@/lib/action";

/** Upload limit per request: Vercel functions accept ≤ 4.5 MB bodies; the browser downsizes photos before sending. */
const REQUEST_LIMIT = 4.4 * 1024 * 1024;

/** Several photos of one document (multi-page) are combined into one PDF. */
async function combineImages(files: { bytes: Uint8Array; mime: string }[]) {
  const pdf = await PDFDocument.create();
  for (const f of files) {
    const img = f.mime === "image/png" ? await pdf.embedPng(f.bytes) : await pdf.embedJpg(f.bytes);
    const page = pdf.addPage([img.width, img.height]);
    page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
  }
  return pdf.save();
}

export async function uploadDocumentAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let id: string;
  try {
    const c = await requireActionContext();
    const administrationId = z.string().min(1).parse(fd.get("administrationId"));
    const files = fd.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
    if (!files.length) throw new UserError("banking.noFile");
    if (files.reduce((s, f) => s + f.size, 0) > REQUEST_LIMIT) throw new UserError("scan.requestTooLarge");
    const loaded = await Promise.all(files.map(async (f) => {
      const bytes = new Uint8Array(await f.arrayBuffer());
      return { name: f.name, bytes, mime: sniffMime(bytes) };
    }));
    if (loaded.some((f) => !f.mime)) throw new UserError("scan.unsupportedType");
    let bytes: Uint8Array;
    let fileName: string;
    if (loaded.length === 1) {
      bytes = loaded[0]!.bytes;
      fileName = loaded[0]!.name || "document";
    } else {
      if (loaded.some((f) => f.mime === "application/pdf")) throw new UserError("scan.combineOnlyImages");
      bytes = await combineImages(loaded.map((f) => ({ bytes: f.bytes, mime: f.mime! })));
      fileName = `${(loaded[0]!.name || "scan").replace(/\.[^.]+$/, "")}-${loaded.length}p.pdf`;
    }
    const r = await scan.uploadDocument(c.access, { administrationId, fileName, bytes, source: fd.get("source") === "MOBILE" ? "MOBILE" : "WEB" });
    id = r.document.id;
  } catch (err) {
    return toActionState(err);
  }
  revalidatePath("/app/scan");
  redirect(`/app/scan/${id}`);
}

export async function confirmDocumentAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let invoiceId: string;
  try {
    const c = await requireActionContext();
    const raw = formObject(fd);
    let net: string;
    try {
      net = parseAmount(raw.netAmount ?? "", raw.locale === "en" ? "en" : "nl");
    } catch {
      throw new UserError("budgets.invalidAmountIn", { value: raw.netAmount ?? "" });
    }
    const input = scan.confirmSchema.parse({ ...raw, netAmount: net, acceptDuplicate: bool(fd, "acceptDuplicate") });
    invoiceId = (await scan.confirmDocument(c.access, input)).id;
  } catch (err) {
    return toActionState(err);
  }
  redirect(`/app/purchase/${invoiceId}`);
}

export async function rejectDocumentAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const c = await requireActionContext();
    const id = z.string().min(1).parse(fd.get("documentId"));
    await scan.rejectDocument(c.access, id, z.string().trim().min(3, "validation.required").max(300).parse(fd.get("reason")));
    revalidatePath(`/app/scan/${id}`);
    return okState("scan.rejected");
  } catch (err) {
    return toActionState(err);
  }
}

export async function saveRuleAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const c = await requireActionContext();
    await scan.saveRule(c.access, formObject(fd) as z.input<typeof scan.ruleSchema>);
    revalidatePath("/app/automation");
    return okState("scan.ruleSaved");
  } catch (err) {
    return toActionState(err);
  }
}

export async function toggleRuleAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const c = await requireActionContext();
    await scan.setRuleEnabled(c.access, z.string().min(1).parse(fd.get("ruleId")), fd.get("enabled") === "true");
    revalidatePath("/app/automation");
    return okState("common.saved");
  } catch (err) {
    return toActionState(err);
  }
}

export async function setAiAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const c = await requireActionContext("organization.manageSettings");
    const enable = fd.get("enabled") === "true";
    if (enable && !bool(fd, "consent")) throw new UserError("scan.consentRequired");
    await scan.setAiEnabled(c.access, enable);
    revalidatePath("/app/automation");
    return okState(enable ? "scan.aiOn" : "scan.aiOff");
  } catch (err) {
    return toActionState(err);
  }
}
