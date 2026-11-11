"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireActionContext } from "@/core/auth/context";
import { withTenant } from "@/core/tenancy/tenant";
import { UserError } from "@/core/errors";
import * as industry from "@/modules/industry/service";
import { templateAccountSchema } from "@/modules/industry/content";
import { bool, formObject, okState, toActionState, type ActionState } from "@/lib/action";

const done = (templateId: string) => revalidatePath(`/app/templates/${templateId}`);

export async function createCustomTemplateAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let id: string;
  try {
    const c = await requireActionContext("industry.create");
    const { template } = await industry.createCustomTemplate(c.access, industry.customTemplateSchema.parse(formObject(fd)));
    id = template.id;
  } catch (err) {
    return toActionState(err);
  }
  redirect(`/app/templates/${id}`);
}

export async function importTemplateAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let id: string;
  try {
    const c = await requireActionContext("industry.create");
    const file = fd.get("file");
    let json = String(fd.get("json") ?? "");
    if (file instanceof File && file.size > 0) {
      if (file.size > 512 * 1024) throw new UserError("industry.fileTooLarge");
      json = await file.text();
    }
    if (!json.trim()) throw new UserError("industry.invalidJson");
    const { template } = await industry.importTemplate(c.access, json);
    id = template.id;
  } catch (err) {
    return toActionState(err);
  }
  redirect(`/app/templates/${id}`);
}

/** Loads the draft, applies a change to its content and saves it (the service re-validates). */
async function changeDraft(versionId: string, change: (content: industry.TemplateContentT) => industry.TemplateContentT) {
  const c = await requireActionContext("industry.edit");
  const v = await withTenant(c.access, (tx) => tx.industryTemplateVersion.findUnique({ where: { id: versionId } }));
  if (!v) throw new UserError("errors.notFound");
  const issues = await industry.saveDraftContent(c.access, versionId, change(industry.parseContent(v.content)));
  done(v.templateId);
  return issues;
}

export async function addTemplateAccountAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const raw = formObject(fd);
    const account = templateAccountSchema.parse({
      ref: raw.ref?.trim() || `a${raw.number}`, number: raw.number, name: raw.name, nameEn: raw.nameEn?.trim() || raw.name, category: raw.category, parent: raw.parent,
      header: bool(fd, "header") || undefined, control: raw.control === "FIXED_ASSET" ? "FIXED_ASSET" : undefined, normal: raw.normal === "DEBIT" || raw.normal === "CREDIT" ? raw.normal : undefined,
    });
    const issues = await changeDraft(z.string().min(1).parse(raw.versionId), (c) => ({ ...c, accounts: [...c.accounts, account] }));
    return issues.length ? okState("industry.savedWithIssues") : okState("common.saved");
  } catch (err) {
    return toActionState(err);
  }
}

export async function removeTemplateAccountAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ref = z.string().min(1).parse(fd.get("ref"));
    await changeDraft(z.string().min(1).parse(fd.get("versionId")), (c) => ({ ...c, accounts: c.accounts.filter((a) => a.ref !== ref) }));
    return okState("common.saved");
  } catch (err) {
    return toActionState(err);
  }
}

export async function saveTemplateJsonAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    let content: unknown;
    try {
      content = JSON.parse(String(fd.get("content") ?? ""));
    } catch {
      throw new UserError("industry.invalidJson");
    }
    const issues = await changeDraft(z.string().min(1).parse(fd.get("versionId")), () => content as industry.TemplateContentT);
    return issues.length ? okState("industry.savedWithIssues") : okState("common.saved");
  } catch (err) {
    return toActionState(err);
  }
}

export async function publishTemplateAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const c = await requireActionContext("industry.manageSettings");
    const v = await industry.publishVersion(c.access, z.string().min(1).parse(fd.get("versionId")), String(fd.get("changelog") ?? ""));
    done(v.templateId);
    return okState("industry.published");
  } catch (err) {
    return toActionState(err);
  }
}

export async function newDraftAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const c = await requireActionContext("industry.edit");
    const templateId = z.string().min(1).parse(fd.get("templateId"));
    await industry.newDraftVersion(c.access, templateId);
    done(templateId);
    return okState("industry.draftCreated");
  } catch (err) {
    return toActionState(err);
  }
}

export async function templateStatusAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const c = await requireActionContext("industry.manageSettings");
    const templateId = z.string().min(1).parse(fd.get("templateId"));
    await industry.setTemplateStatus(c.access, templateId, z.enum(["ACTIVE", "ARCHIVED"]).parse(fd.get("status")));
    done(templateId);
    return okState("common.saved");
  } catch (err) {
    return toActionState(err);
  }
}

export async function applyUpgradeAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const c = await requireActionContext();
    const input = industry.upgradeSchema.parse({
      administrationId: fd.get("administrationId"), targetVersionId: fd.get("targetVersionId"),
      accounts: fd.getAll("accounts").map(String), journals: fd.getAll("journals").map(String), assetCategories: fd.getAll("assetCategories").map(String), dimensions: fd.getAll("dimensions").map(String),
    });
    const r = await industry.applyUpgrade(c.access, input);
    revalidatePath(`/app/administrations/${input.administrationId}`);
    return okState("industry.upgraded", { added: String(r.added.length) });
  } catch (err) {
    return toActionState(err);
  }
}
