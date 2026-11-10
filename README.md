# ARA Accounting

Cloud accounting, financial management and reporting for SMEs and accounting firms built for the **Surinamese market**: SRD, CBvS exchange rates, BTW, profit tax, the Wet op de Jaarrekening and Surinamese banks. Built by ARA Intelligent Solutions. The interface is Dutch by default, with English as a second language.

The project is in **Phase 1 (foundation)**. See [Project status](PROJECT_STATUS.md).

## Development

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # unit tests
npm run typecheck && npm run lint && npm run build
```

Requires Node.js 22 or later.

## Deploying to Vercel

1. In Vercel: **Add New → Project → Import** `johnlukems-cpu/ARA-accounting`. Framework, build command and region (`iad1`) come from the repository.
2. No environment variables are needed for the current foundation. `.env.example` lists what later phases will need.
3. Every push to `main` deploys to production. Branches get preview deployments.

## Documentation

- [Project status](PROJECT_STATUS.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Database schema](docs/DATABASE_SCHEMA.md)
- [Accounting rules](docs/ACCOUNTING_RULES.md)
- [Security](docs/SECURITY.md)
- [API conventions](docs/API_DOCUMENTATION.md)
- [Roadmap & risks](docs/DEVELOPMENT_ROADMAP.md)
- [Suriname market profile](docs/SURINAME_MARKET.md)
- [Prompt to finish the build with Claude](docs/CLAUDE_BUILD_PROMPT.md)
