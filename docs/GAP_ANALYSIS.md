# ARA Accounting — Gap-analyse

Datum: 2026-11-10, op commit `00d2d2d`, uitgevoerd vóór de verdere bouw van fase 1.

| Onderdeel | Status | Toelichting |
| --- | --- | --- |
| Architectuur- en ontwerpdocumenten (fase 0) | **Volledig** | ARCHITECTURE, DATABASE_SCHEMA, ACCOUNTING_RULES, SECURITY, API, ROADMAP en SURINAME_MARKET |
| Next.js-basis, i18n (nl/en), designtokens, security-headers, Vercel-config | **Volledig, getest** | i18n-pariteitstest; build, lint en typecheck groen; browsercontrole desktop en mobiel |
| `src/core/money` (decimaal geld, afronding, conversie, verdeling, parsen, formatteren) | **Volledig, getest** | 26 unittests |
| `GET /api/health` | **Volledig** | Handmatig getest, nog geen geautomatiseerde test |
| Statuspagina `/` | **Volledig (informatief)** | Toont de ontwikkelstatus; de fasestatus is hardgecodeerd in `src/lib/roadmap.ts` |
| Database / Prisma / migraties | **Niet geïmplementeerd** | — |
| Authenticatie, sessies, MFA, wachtwoordherstel | **Niet geïmplementeerd** | — |
| Organisaties, bedrijven, vestigingen, administraties, boekjaren, periodes | **Niet geïmplementeerd** | — |
| Rollen en rechten, tenant-isolatie (RLS), auditlog | **Niet geïmplementeerd** | — |
| App-shell (zijbalk, selectors, zoeken, meldingen) | **Niet geïmplementeerd** | — |
| Fasen 2–12 | **Niet geïmplementeerd** | — |
| Alleen visueel geïmplementeerd | Geen | Er zijn geen knoppen zonder werking |
| Kapotte functionaliteit | Geen bekend | Het streepjesprobleem (spatiëring rond koppeltekens) is opgelost in `42b201e` |
| Technische schuld | Klein | `tsconfig.tsbuildinfo` en `next-env.d.ts` staan in de werkmap (ze worden genegeerd door `.gitignore`). De fasestatus op de statuspagina moet met elke fase mee worden bijgewerkt. |

**Conclusie:** fase 1 heeft alleen het deployable fundament. Alles met een database begint nu.
