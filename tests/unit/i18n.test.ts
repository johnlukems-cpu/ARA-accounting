import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import nl from "../../messages/nl.json";
import en from "../../messages/en.json";

function keys(obj: object, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === "object" ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}
function placeholders(s: string) {
  return [...s.matchAll(/\{(\w+)/g)].map((m) => m[1]).sort();
}
function get(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], obj);
}

describe("message catalogues", () => {
  it("nl and en have exactly the same keys", () => {
    expect(keys(en).sort()).toEqual(keys(nl).sort());
  });

  it("placeholders match between languages", () => {
    for (const k of keys(nl)) {
      expect(placeholders(String(get(en, k))), k).toEqual(placeholders(String(get(nl, k))));
    }
  });

  it("every phase on the roadmap has a label", async () => {
    const { PHASES } = await import("@/lib/roadmap");
    for (const p of PHASES) expect(get(nl, `status.phases.p${p.number}`)).toBeTypeOf("string");
  });

  it("static t(\"…\") keys used in src exist", () => {
    const files: string[] = [];
    const walk = (dir: string) =>
      readdirSync(dir).forEach((f) => {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(p)) files.push(p);
      });
    walk("src");
    const all = new Set(keys(nl));
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      const ns = src.match(/(?:getTranslations|useTranslations)\("([\w.]+)"\)/)?.[1];
      for (const m of src.matchAll(/\bt\("([\w.]+)"/g)) {
        const key = ns ? `${ns}.${m[1]}` : m[1]!;
        expect(all.has(key), `${f}: ${key}`).toBe(true);
      }
    }
  });
});
