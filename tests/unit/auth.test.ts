import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, hotp, totp, verifyTotp } from "@/core/auth/totp";
import { decrypt, encrypt, hashPassword, verifyPassword } from "@/core/auth/crypto";
import { ALL_PERMISSIONS, ROLE_CODES, SYSTEM_ROLES, isOrgScoped, rolesForKind } from "@/core/auth/permissions";

const RFC_SECRET = Buffer.from("12345678901234567890");

describe("TOTP (RFC 4226 / RFC 6238)", () => {
  it("matches the RFC 4226 HOTP test values", () => {
    const expected = ["755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489"];
    expected.forEach((code, counter) => expect(hotp(RFC_SECRET, counter)).toBe(code));
  });

  it("matches the RFC 6238 SHA-1 test values (8 digits)", () => {
    const secret = base32Encode(RFC_SECRET);
    expect(totp(secret, 59_000, 8)).toBe("94287082");
    expect(totp(secret, 1_111_111_109_000, 8)).toBe("07081804");
    expect(totp(secret, 2_000_000_000_000, 8)).toBe("69279037");
  });

  it("round-trips base32", () => {
    expect(base32Decode(base32Encode(RFC_SECRET)).equals(RFC_SECRET)).toBe(true);
  });

  it("accepts ±1 step of drift and rejects others", () => {
    const secret = base32Encode(RFC_SECRET);
    const now = 1_700_000_000_000;
    expect(verifyTotp(secret, totp(secret, now), now)).toBe(true);
    expect(verifyTotp(secret, totp(secret, now - 30_000), now)).toBe(true);
    expect(verifyTotp(secret, totp(secret, now - 90_000), now)).toBe(false);
    expect(verifyTotp(secret, "12345", now)).toBe(false);
  });
});

describe("passwords and encryption", () => {
  it("hashes with scrypt and verifies", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("correct horse battery", hash)).toBe(true);
    expect(await verifyPassword("wrong password!!", hash)).toBe(false);
    expect(await verifyPassword("x", "!invited")).toBe(false);
  });

  it("encrypts with AES-256-GCM and detects tampering", () => {
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    const enc = encrypt("JBSWY3DPEHPK3PXP");
    expect(decrypt(enc)).toBe("JBSWY3DPEHPK3PXP");
    const [iv, tag, data] = enc.split(".");
    const tampered = [iv, tag, Buffer.from("x" + data).toString("base64url")].join(".");
    expect(() => decrypt(tampered)).toThrow();
  });
});

describe("permission matrix", () => {
  it("has the ten required roles (nine tenant roles + platform administrator flag)", () => {
    expect(ROLE_CODES).toHaveLength(9);
  });

  it("only uses known permissions", () => {
    const all = new Set(ALL_PERMISSIONS);
    for (const code of ROLE_CODES) for (const p of SYSTEM_ROLES[code].permissions) expect(all.has(p), `${code}: ${p}`).toBe(true);
  });

  it("separates duties: bookkeepers cannot approve, reverse or close periods", () => {
    const p = new Set(SYSTEM_ROLES.BOOKKEEPER.permissions);
    for (const forbidden of ["ledger.approve", "ledger.reverse", "periods.close", "organization.manageUsers"]) expect(p.has(forbidden as never)).toBe(false);
  });

  it("read-only users have only view permissions", () => {
    expect(SYSTEM_ROLES.READ_ONLY.permissions.every((p) => p.endsWith(".view"))).toBe(true);
  });

  it("approval managers can approve but not post", () => {
    const p = SYSTEM_ROLES.APPROVAL_MANAGER.permissions;
    expect(p).toContain("purchase.approve");
    expect(p.some((x) => x.endsWith(".post"))).toBe(false);
  });

  it("organisation-scoped permissions are recognised", () => {
    expect(isOrgScoped("organization.manageUsers")).toBe(true);
    expect(isOrgScoped("ledger.post")).toBe(false);
  });

  it("offers the right roles per organisation kind", () => {
    expect(rolesForKind("BUSINESS")).toContain("ORGANIZATION_OWNER");
    expect(rolesForKind("BUSINESS")).not.toContain("FIRM_ADMIN");
    expect(rolesForKind("ACCOUNTING_FIRM")).toContain("CLIENT_ADMIN");
  });
});
