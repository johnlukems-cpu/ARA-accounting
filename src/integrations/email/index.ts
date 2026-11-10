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
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

class SmtpSender implements EmailSender {
  private transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
  });

  async send(message: EmailMessage) {
    await this.transport.sendMail({ from: process.env.SMTP_FROM ?? "ARA Accounting <no-reply@localhost>", ...message });
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
