import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { READINESS_ITEMS } from "@/modules/readiness/register";

/** Static guards over the source tree (production readiness T9, T12, T13). */
function files(dir: string, ext = /\.(ts|tsx)$/): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p, ext) : ext.test(f) ? [p] : [];
  });
}
const src = files("src");

describe("frontend never sees secrets", () => {
  it("client components do not read process.env (only NEXT_PUBLIC_ would be inlined)", () => {
    const offenders = src.filter((f) => /^["']use client["']/m.test(readFileSync(f, "utf8")) && /process\.env\.(?!NEXT_PUBLIC_|NODE_ENV)/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
  it("no NEXT_PUBLIC_ variable is used anywhere", () => {
    expect(src.filter((f) => /NEXT_PUBLIC_/.test(readFileSync(f, "utf8")) && !f.endsWith("env.ts"))).toEqual([]);
  });
});

describe("logging goes through the redacting logger", () => {
  it("no console.* outside src/core/ops/log.ts", () => {
    expect(src.filter((f) => !f.endsWith(join("ops", "log.ts")) && /\bconsole\.(log|info|warn|error|debug)\(/.test(readFileSync(f, "utf8")))).toEqual([]);
  });
});

describe("every server action and route handler authenticates", () => {
  // Public by design: sign-in, registration, password reset, invitation, e-mail verification, language, logout.
  // The token-based ones (reset, invitation, verification) are protected by single-use hashed tokens instead.
  const PUBLIC_ACTIONS = new Set(["registerAction", "loginAction", "verifyMfaAction", "requestPasswordResetAction", "resetPasswordAction", "acceptInvitationAction", "verifyEmail", "logoutAction", "setLocaleAction", "setLocale"]);
  const AUTH = /requireActionContext\(|platformUser\(|getContext\(|requireApp\(|readSession\(|requireUser\(/;
  it("server actions", () => {
    const missing: string[] = [];
    for (const f of [...files("src/actions"), "src/app/actions.ts"]) {
      const s = readFileSync(f, "utf8");
      // Local helpers that authenticate (e.g. ctx(), currentSession()) count as authentication too.
      const helpers = [...s.matchAll(/^(?:async )?function (\w+)\s*\([^)]*\)[^{]*\{([\s\S]*?)\n\}/gm)].filter((h) => AUTH.test(h[2]!)).map((h) => h[1]!);
      const auth = new RegExp(`${AUTH.source}${helpers.length ? `|\\b(?:${helpers.join("|")})\\(` : ""}`);
      for (const m of s.matchAll(/export async function (\w+)\s*\([^)]*\)[^{]*\{([\s\S]*?)\n\}/g)) {
        if (!PUBLIC_ACTIONS.has(m[1]!) && !auth.test(m[2]!)) missing.push(`${f}:${m[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });
  it("route handlers (except the health check) require a session or the cron secret", () => {
    const routes = files("src/app/api").filter((f) => f.endsWith("route.ts") && !f.includes(join("api", "health")));
    expect(routes.filter((f) => !/getContext\(|isAuthorizedCron\(/.test(readFileSync(f, "utf8")))).toEqual([]);
  });
});

describe("readiness register", () => {
  it("ids are unique, dependencies exist, and every item has an acceptance criterion in both languages", () => {
    const ids = READINESS_ITEMS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const it of READINESS_ITEMS) {
      for (const d of it.dependsOn) expect(ids).toContain(d);
      expect(it.acceptance.nl.length).toBeGreaterThan(10);
      expect(it.acceptance.en.length).toBeGreaterThan(10);
    }
  });
  it("owner and specialist items are never marked completed statically (only live checks or recorded evidence complete them)", () => {
    expect(READINESS_ITEMS.filter((i) => i.responsible !== "DEVELOPMENT" && i.status === "COMPLETED")).toEqual([]);
  });
});
