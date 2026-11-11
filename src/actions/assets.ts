"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActionContext } from "@/core/auth/context";
import * as assets from "@/modules/assets/service";
import * as ca from "@/modules/current-accounts/service";
import { formObject, okState, toActionState, type ActionState } from "@/lib/action";

const amount = z.string().trim().transform((v) => v.replace(",", ".")).pipe(z.string().regex(/^-?\d+(\.\d+)?$/, "validation.amount"));
const optAmount = z.string().trim().transform((v) => v.replace(",", ".")).pipe(z.string().regex(/^(\d+(\.\d+)?)?$/, "validation.amount")).optional().transform((v) => v || undefined);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "validation.date");

export async function registerAssetAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const c = await requireActionContext();
    const input = assets.assetSchema.parse(formObject(fd));
    await assets.registerAsset(c.access, input);
    revalidatePath("/app/assets");
    return okState("assets.registered");
  } catch (err) {
    return toActionState(err);
  }
}

export async function proposeDepreciationAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const c = await requireActionContext();
    const raw = z.object({ administrationId: z.string().min(1), period: z.string().regex(/^\d{4}-\d{2}$/, "validation.date") }).parse(formObject(fd));
    const [year, month] = raw.period.split("-").map(Number) as [number, number];
    await assets.proposeDepreciation(c.access, { administrationId: raw.administrationId, year, month });
    revalidatePath("/app/assets");
    return okState("assets.proposed");
  } catch (err) {
    return toActionState(err);
  }
}

export async function cancelDepreciationAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const c = await requireActionContext();
    await assets.cancelDepreciation(c.access, z.string().min(1).parse(fd.get("entryId")));
    revalidatePath("/app/assets");
    return okState("assets.cancelled");
  } catch (err) {
    return toActionState(err);
  }
}

export async function disposeAssetAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const c = await requireActionContext();
    const raw = z.object({ assetId: z.string().min(1), date, proceeds: optAmount, counterAccountId: z.string().optional().transform((v) => v || undefined) }).parse(formObject(fd));
    const r = await assets.disposeAsset(c.access, { ...raw, proceeds: raw.proceeds ?? "0" });
    revalidatePath(`/app/assets/${raw.assetId}`);
    return okState(r.result.startsWith("-") ? "assets.disposedLoss" : "assets.disposed");
  } catch (err) {
    return toActionState(err);
  }
}

export async function transferAssetAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const c = await requireActionContext();
    const raw = z.object({ assetId: z.string().min(1), date, location: z.string().trim().max(120).optional(), costCenterId: z.string().optional() }).parse(formObject(fd));
    await assets.transferAsset(c.access, { ...raw, costCenterId: raw.costCenterId === undefined ? undefined : raw.costCenterId || null });
    revalidatePath(`/app/assets/${raw.assetId}`);
    return okState("common.saved");
  } catch (err) {
    return toActionState(err);
  }
}

export async function createCurrentAccountAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const c = await requireActionContext();
    await ca.createCurrentAccount(c.access, ca.currentAccountSchema.parse(formObject(fd)));
    revalidatePath("/app/current-accounts");
    return okState("currentAccounts.created");
  } catch (err) {
    return toActionState(err);
  }
}

export async function currentAccountMovementAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const c = await requireActionContext();
    const input = ca.movementSchema.parse(formObject(fd));
    await ca.recordMovement(c.access, input);
    revalidatePath(`/app/current-accounts/${input.currentAccountId}`);
    return okState("currentAccounts.booked");
  } catch (err) {
    return toActionState(err);
  }
}

export async function confirmCurrentAccountAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const c = await requireActionContext();
    const raw = z.object({ currentAccountId: z.string().min(1), date, confirmedBalance: amount, notes: z.string().trim().max(500).optional() }).parse(formObject(fd));
    await ca.confirmBalance(c.access, raw);
    revalidatePath(`/app/current-accounts/${raw.currentAccountId}`);
    return okState("currentAccounts.confirmedOk");
  } catch (err) {
    return toActionState(err);
  }
}
