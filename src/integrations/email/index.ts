import nodemailer from "nodemailer";

/**
 * E-mail delivery interface. The SMTP adapter is used when SMTP_HOST is configured.
 * Without configuration `getEmailSender()` returns null and callers must tell the user that no e-mail
 * was sent (never pretend delivery happened).
 */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  attachments?: { filename: string; content: Buffer | Uint8Array; contentType: string }[];
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
  /** Opens a connection and authenticates without sending (EHLO + AUTH). */
  verify?(): Promise<void>;
}

class SmtpSender implements EmailSender {
  private transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
  });

  async verify() {
    await this.transport.verify();
  }

  async send(message: EmailMessage) {
    await this.transport.sendMail({
      from: process.env.SMTP_FROM ?? "ARA Accounting <no-reply@localhost>",
      ...message,
      attachments: message.attachments?.map((a) => ({ ...a, content: Buffer.from(a.content) })),
    });
  }
}

let sender: EmailSender | null | undefined;

export function getEmailSender(): EmailSender | null {
  if (sender === undefined) sender = process.env.SMTP_HOST ? new SmtpSender() : null;
  return sender;
}

export function appUrl(path: string): string {
  const base = process.env.APP_URL ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000");
  return new URL(path, base).toString();
}

/**
 * SMTP readiness test: verifies the connection and credentials, then sends one test message to `to`.
 * Returns a result code only; error details stay in the (redacted) server log.
 */
export async function testEmailDelivery(to: string): Promise<{ ok: true } | { ok: false; code: "notConfigured" | "connectionFailed" | "sendFailed" }> {
  const s = getEmailSender();
  if (!s) return { ok: false, code: "notConfigured" };
  const { log } = await import("@/core/ops/log");
  try {
    await s.verify?.();
  } catch (err) {
    log.error("smtp.verifyFailed", { error: err });
    return { ok: false, code: "connectionFailed" };
  }
  try {
    await s.send({ to, subject: "ARA Accounting — testbericht / test message", text: "Dit is een testbericht van ARA Accounting. De e-mailinstellingen werken.\n\nThis is a test message from ARA Accounting. E-mail delivery works." });
    return { ok: true };
  } catch (err) {
    log.error("smtp.sendFailed", { error: err });
    return { ok: false, code: "sendFailed" };
  }
}
