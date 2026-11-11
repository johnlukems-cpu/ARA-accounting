"use client";

import { useActionState, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Camera, FileUp } from "lucide-react";
import type { ActionState } from "@/lib/action";
import { buttonClass } from "@/components/ui/button-class";

const MAX_SIDE = 2000;
const LIMIT = 4.4 * 1024 * 1024;

/** Photos are downsized to ≤ 2000 px JPEG in the browser (any format the browser can decode, e.g. HEIC on iPhone). */
async function shrink(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    return blob ? new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" }) : file;
  } catch {
    return file;
  }
}

export function ScanUpload({ administrationId, action }: { administrationId: string; action: (s: ActionState, fd: FormData) => Promise<ActionState> }) {
  const t = useTranslations();
  const [state, dispatch] = useActionState(action, null);
  const [pending, startTransition] = useTransition();
  const [files, setFiles] = useState<File[]>([]);
  const [local, setLocal] = useState<string | null>(null);

  async function choose(list: FileList | null, mobile: boolean) {
    setLocal(null);
    const picked = Array.from(list ?? []);
    const prepared = await Promise.all(picked.map(shrink));
    const next = mobile ? [...files, ...prepared] : prepared;
    if (next.reduce((s, f) => s + f.size, 0) > LIMIT) {
      setLocal(t("scan.requestTooLarge"));
      return;
    }
    setFiles(next);
  }

  function send() {
    const fd = new FormData();
    fd.set("administrationId", administrationId);
    fd.set("source", files.every((f) => f.type.startsWith("image/")) ? "MOBILE" : "WEB");
    for (const f of files) fd.append("files", f);
    startTransition(() => dispatch(fd));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <label className={buttonClass("primary")}>
          <Camera className="size-4" aria-hidden /> {t("scan.takePhoto")}
          <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => void choose(e.target.files, true)} />
        </label>
        <label className={buttonClass("secondary")}>
          <FileUp className="size-4" aria-hidden /> {t("scan.chooseFiles")}
          <input type="file" accept="application/pdf,image/jpeg,image/png" multiple className="sr-only" aria-label={t("scan.chooseFiles")} onChange={(e) => void choose(e.target.files, false)} />
        </label>
      </div>
      {files.length > 0 && (
        <div className="rounded-md border border-border p-3 text-sm">
          <p className="font-medium">{t("scan.selected", { count: files.length })}</p>
          <ul className="mt-1 list-disc pl-5 text-muted-foreground">{files.map((f, i) => <li key={i}>{f.name} · {(f.size / 1024).toFixed(0)} kB</li>)}</ul>
          {files.length > 1 && <p className="mt-1 text-xs text-muted-foreground">{t("scan.combineHint")}</p>}
          <div className="mt-3 flex gap-2">
            <button type="button" className={buttonClass("primary")} disabled={pending} onClick={send}>{pending ? t("scan.uploading") : t("scan.upload")}</button>
            <button type="button" className={buttonClass("ghost")} disabled={pending} onClick={() => setFiles([])}>{t("common.remove")}</button>
          </div>
        </div>
      )}
      {(local || (state && !state.ok)) && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{local ?? state?.message}</p>}
    </div>
  );
}
