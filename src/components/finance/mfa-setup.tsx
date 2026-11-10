"use client";

import { useState } from "react";
import Image from "next/image";
import { startMfaSetupAction, confirmMfaAction } from "@/actions/account";
import { ActionForm, Field, Input, SubmitButton } from "@/components/ui/form";
import { buttonClass } from "@/components/ui/button-class";

/** Two-step MFA enrolment: show QR code / secret, then confirm with a code. Texts come from the server. */
export function MfaSetup({ labels }: { labels: { start: string; scan: string; secret: string; code: string; confirm: string; recovery: string; error: string } }) {
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [error, setError] = useState(false);
  if (!setup) {
    return (
      <div>
        {error && <p role="alert" className="mb-2 text-sm text-danger">{labels.error}</p>}
        <button
          type="button"
          className={buttonClass("primary")}
          onClick={async () => {
            const r = await startMfaSetupAction();
            if ("error" in r) setError(true);
            else setSetup(r);
          }}
        >
          {labels.start}
        </button>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <p className="text-sm">{labels.scan}</p>
      <Image src={setup.qr} alt="QR" width={200} height={200} unoptimized className="rounded-lg border border-border" />
      <p className="text-xs text-muted-foreground">
        {labels.secret}: <code className="break-all">{setup.secret}</code>
      </p>
      <ActionForm action={confirmMfaAction} dataLabels={{ recoveryCodes: labels.recovery }}>
        <Field label={labels.code} name="code">
          <Input name="code" inputMode="numeric" autoComplete="one-time-code" required className="max-w-40" />
        </Field>
        <SubmitButton>{labels.confirm}</SubmitButton>
      </ActionForm>
    </div>
  );
}
