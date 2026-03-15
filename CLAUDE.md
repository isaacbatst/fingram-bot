# fingram-bot

Backend NestJS application with Drizzle ORM, Telegraf bot, and REST API.

## Quick Reference

- **Port:** `process.env.PORT ?? 3002`
- **Auth:** Cookie `vault_access_token` → matches `vault.token` column in DB
- **DB schema sync (dev):** `npm run db:push` (preferred over `db:migrate` in dev)
- **DB migrations (prod):** `npm run db:migrate` — uses `drizzle/` folder with SQL files + journal

## Running

```bash
npm run start:dev      # Dev server with watch
npm run test           # Unit tests (vitest)
npm run test:integration  # Integration tests (testcontainers + real PostgreSQL)
```

## Architecture

### Module System

`AppModule.register({ persistence: 'in-memory' | 'sqlite' | 'drizzle' })` — swappable persistence backends via `RepositoriesModule.forRoot()`.

### Database

- **ORM:** Drizzle with PostgreSQL (node-postgres for local/test, Neon for prod)
- **Schema:** `src/shared/persistence/drizzle/schema.ts` — source of truth
- **Migrations:** `drizzle/` folder — SQL files + `meta/_journal.json`. Snapshots (`meta/NNNN_snapshot.json`) are used by `drizzle-kit generate` for diffing but NOT required by `migrate()` at runtime.
- **Dev sync:** `db:push` applies schema.ts directly to DB (bypasses migration journal). Use this in dev to avoid journal desync. Migrations are for prod deployment.

### Plan Domain

- **Types:** `src/plan/domain/plan.ts` — Box, MonthData, Plan interfaces
- **Engine:** `src/plan/domain/run-projection.ts` — pure function `runProjection(plan, months)`
- **Box model:** Unified with `holdsFunds`, `target`, `monthlyAmount` (change points), `scheduledPayments`, optional `yieldRate`
- **Spec:** `../docs/product/spec-plan.md` (modelo conceitual) e `../docs/product/spec-integration.md` (binding, projeção híbrida)

## Testing

### Unit Tests

- Vitest with SWC plugin
- Domain logic tested via pure functions (no DI needed)
- Service tests use in-memory repositories

### Integration Tests

- **Location:** `test/integration/`
- **Config:** `vitest.integration.config.ts` (60s timeout)
- **Strategy:** Testcontainers — spins up ephemeral PostgreSQL container per test suite
- **Setup:** `test/integration/setup.ts` — container lifecycle, migration, vault creation, truncation helpers
- **DB setup:** Uses `migrate()` from drizzle-orm to apply real migrations against the test container

## Verification Commands

```bash
npm run test && npm run test:integration
```
