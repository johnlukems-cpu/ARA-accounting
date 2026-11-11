/**
 * Writes docs/PRODUCTION_READINESS.md from the readiness register (src/modules/readiness/register.ts).
 * Static statuses only: the live dashboard (Platformbeheer → Productiegereedheid) also checks configuration, plans,
 * reviews and bank formats in the running environment.
 */
import { writeFileSync } from "node:fs";
import { READINESS_ITEMS, type ReadinessItem } from "../src/modules/readiness/register";

const LABEL: Record<string, string> = { COMPLETED: "✅ Completed", IN_PROGRESS: "🔄 In progress", WAITING_OWNER: "⏳ Waiting for owner input", WAITING_SPECIALIST: "⏳ Waiting for external specialist", BLOCKED: "⛔ Blocked", NOT_STARTED: "◻️ Not started" };
const WHO: Record<string, string> = { DEVELOPMENT: "Development", OWNER: "Owner (ARA)", TAX_ADVISER: "Tax adviser", SUVA_ACCOUNTANT: "SUVA accountant", LEGAL: "Lawyer", SECURITY_TESTER: "Security tester" };
const GATE: Record<string, string> = { PILOT: "Pilot", GA: "General availability", LATER: "Later" };
const row = (i: ReadinessItem) => `| ${i.id} | ${i.title.en} | ${LABEL[i.status]} | ${WHO[i.responsible]} | ${i.priority} · ${GATE[i.gate]} | ${i.dependsOn.join(", ") || "—"} | ${i.acceptance.en}${i.evidence ? `<br>*Evidence:* ${i.evidence}` : ""} |`;
const head = "| ID | Requirement | Status | Responsible | Priority · gate | Depends on | Acceptance criterion |\n| --- | --- | --- | --- | --- | --- | --- |";
const count = (s: string) => READINESS_ITEMS.filter((i) => i.status === s).length;
const pilotOpen = READINESS_ITEMS.filter((i) => i.gate === "PILOT" && i.priority === "P1" && i.status !== "COMPLETED");
const gaOpen = READINESS_ITEMS.filter((i) => i.gate !== "LATER" && i.priority === "P1" && i.status !== "COMPLETED");

const md = `# ARA Accounting — Production Readiness

Generated from \`src/modules/readiness/register.ts\` by \`npm run readiness:report\`. The **live** dashboard is in the
application: **Platformbeheer → Productiegereedheid** (platform administrators). It re-checks configuration, plans,
compliance reviews, bank formats and recorded evidence in the running environment, so it can show items as completed
that are still open here.

## Gates

| Gate | Verdict | Open P1 items |
| --- | --- | --- |
| Controlled pilot | ${pilotOpen.length ? "**NOT READY**" : "Ready"} | ${pilotOpen.map((i) => i.id).join(", ") || "—"} |
| General availability | ${gaOpen.length ? "**NOT READY**" : "Ready"} | ${gaOpen.map((i) => i.id).join(", ") || "—"} |

Status counts: ${Object.keys(LABEL).map((s) => `${LABEL[s]} ${count(s)}`).join(" · ")}

## Owner and external specialists

${head}
${READINESS_ITEMS.filter((i) => i.responsible !== "DEVELOPMENT").map(row).join("\n")}

## Independent technical work (development)

${head}
${READINESS_ITEMS.filter((i) => i.responsible === "DEVELOPMENT").map(row).join("\n")}

Details per owner item: [OWNER_ACTION_REGISTER.md](OWNER_ACTION_REGISTER.md).
`;
writeFileSync("docs/PRODUCTION_READINESS.md", md);
console.log("docs/PRODUCTION_READINESS.md written");
