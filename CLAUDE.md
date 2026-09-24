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

### Creating a new migration for prod (CRITICAL)

**Prod deploy auto-runs migrations** via `node dist/migrate.js && node dist/main` (see `Dockerfile`). The runtime `migrate()` reads `drizzle/meta/_journal.json` — **SQL files not registered there are silently ignored**. Writing a `drizzle/NNNN_*.sql` file by hand without updating the journal will ship the schema change to prod code but leave the DB untouched, producing a "column does not exist" incident on startup.

**Correct workflow:**

1. Edit `src/shared/persistence/drizzle/schema.ts`.
2. Run `npm run db:generate`. This creates both `drizzle/NNNN_*.sql` **and** the matching entry in `drizzle/meta/_journal.json` (plus a snapshot under `drizzle/meta/NNNN_snapshot.json`).
3. Review the generated SQL. If it uses `ADD COLUMN` / `DROP COLUMN` / `CREATE TABLE`, prefer making it idempotent (`ADD COLUMN IF NOT EXISTS`, `DROP TABLE IF EXISTS`) so a hotfix that applies the change out-of-band in prod stays safe when the migration later runs.
4. Apply locally in dev: `npm run db:push` (bypasses journal, syncs schema — safe for dev even with journal gaps).
5. Commit the new SQL file, the updated `_journal.json`, and the new snapshot together. **Do not commit them separately.**

**Do not hand-write migration SQL files.** Even if the SQL is trivial, use `db:generate` so the journal stays in sync. If you must hand-write (e.g., data backfill), still add the entry to `_journal.json` in the same commit.

**Verification before pushing:** ensure `drizzle/meta/_journal.json` has an entry for every `drizzle/NNNN_*.sql` file you are committing. Mismatches break prod migration.

### Snapshot gaps: what to do when `db:generate` reemits old changes

Snapshots `0004`, `0007` and `0008` do not exist — those migrations were hand-written. If `db:generate` starts asking to disambiguate an old column (e.g. `realization_mode`) or emits `ALTER TABLE` statements that are already in production, this is why.

**`drizzle-kit generate` only diffs against the most recent snapshot.** The historical ones are never read. So a gap only matters until the next snapshot exists — repairing it means making sure the newest migration has a correct snapshot, not reconstructing the missing ones. That was done in `0009`, so generation works normally again.

If a gap ever reappears:

1. Run `db:generate` and let it write SQL, snapshot and journal entry together.
2. **Review the SQL and delete the statements that are already applied in production.** Running them again breaks the deploy — duplicate column, or `DROP COLUMN` on a column that no longer exists.
3. Keep the generated snapshot as-is: it represents `schema.ts` and is what fixes the diffing.
4. Confirm the repair by running `db:generate` again — it must answer `No schema changes, nothing to migrate` with no prompt.

**The prompts need a real TTY.** `drizzle-kit` uses an interactive select; piping into it does nothing and the command hangs forever. Run it in a terminal, or drive it through a pty (`script -qec "npx drizzle-kit generate" /dev/null`) feeding Enter only after the prompt has rendered.

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

## Date/Timezone Handling

**CRITICAL: Always use UTC methods for date arithmetic involving stored dates.**

PostgreSQL `timestamp without time zone` columns store dates without timezone info. Drizzle/node-postgres interprets them as UTC (appending `Z`). When JavaScript's `Date` object uses local-time methods (`getMonth()`, `getFullYear()`), the date shifts in non-UTC timezones:

```
DB:    2026-01-01 00:00:00           → stored as-is
JS:    new Date('2026-01-01T00:00:00.000Z')
       .getMonth()  → 11 (Dec 31 in UTC-3!)   ← WRONG
       .getUTCMonth() → 0 (Jan 1)              ← CORRECT
```

**Rules:**
- Use `getUTCMonth()`, `getUTCFullYear()`, `getUTCDate()` when comparing or computing differences between stored dates
- Use `Date.UTC()` when constructing dates for queries or period boundaries
- Never mix local and UTC methods in the same calculation (e.g., `now.getMonth() - startDate.getUTCMonth()`)
- Server runs in `America/Fortaleza` (UTC-3) — any midnight-UTC date becomes previous day locally

**Where this applies:** Plan month calculations, period ranges, scheduled movement matching, cost-of-living lookups — anywhere a stored `startDate`/`createdAt` is compared to `new Date()`.

## MCP Server (`src/mcp/`)

Remote MCP server that replaced the in-app chat. Users connect Claude, ChatGPT, etc. and use Duna tools from their own assistant.

- **Transport:** Streamable HTTP, stateless, JSON responses — `POST /mcp` (`mcp.controller.ts`). A new `McpServer` is built per request by `DunaMcpServerFactory`.
- **Tools:** `duna-mcp-server.factory.ts`. The vault always comes from the OAuth token (`req.auth.extra.vaultId`), **never from a tool parameter**. Tools call existing services (`VaultService`, `VaultWebService`, `PlanService`) — no domain logic in the tool layer. Mark every tool with `readOnlyHint` / `destructiveHint`; the client uses them to ask the user for confirmation.
- **OAuth 2.1:** the SDK's `mcpAuthRouter` (metadata, DCR, PKCE, rate limit) serves `/.well-known/*`, `/authorize`, `/token`, `/register`, `/revoke` at the app root (mounted on the Express instance in `McpModule.onModuleInit`, since Nest middleware is path-prefixed). `DunaOAuthProvider` persists clients, single-use codes and hashed tokens (`oauth_*` tables). Refresh rotates the grant.
- **Consent:** `/authorize` redirects to `FRONTEND_URL/?oauth_request=<signed JWT>`; the web app calls `/oauth/consent` (approve uses the vault cookie). Approval re-validates the redirect_uri against the registered client.
- **Env:** `API_PUBLIC_URL` (public URL of this API; the issuer and resource URLs derive from it), `FRONTEND_URL`, `JWT_SECRET`.
- **CORS:** `main.ts` allows any origin, without credentials, for the MCP/OAuth public paths only.
- **SDK imports:** use subpaths with `.js` (`@modelcontextprotocol/sdk/server/mcp.js`). They resolve under the current `commonjs` tsconfig.
- **Tests:** `test/integration/mcp.integration.spec.ts` covers the full OAuth flow, every tool, isolation between vaults, and a real SDK `Client` over HTTP. DCR is rate limited (20/hour per IP), so the suite registers a single client.

Tool schemas use plain zod `.optional()`. The OpenAI rule "`.nullable()` instead of `.optional()`" applies only to OpenAI structured outputs (`AiService`), not to MCP.

## Verification Commands

```bash
npm run test && npm run test:integration
```
