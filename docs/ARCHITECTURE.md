# Architecture
Monorepo pnpm. Modular monolith pour le cœur métier.
- `apps/web` Next.js (App Router) · `apps/api` NestJS · `apps/ai` FastAPI/LangGraph · `apps/jobs` workers durables (Temporal si possible, sinon file en base + jobs idempotents) — **non créés à ce jour**.
- `packages/domain` règles pures testées (créé) · `packages/contracts` types/Zod/OpenAPI · `packages/integrations` adapters · `packages/design-system`.
- PostgreSQL (DECIMAL, migrations réversibles, RLS), Redis, stockage S3 privé (MinIO en dev), outbox/inbox, idempotence API, logs structurés, traces, health checks.
- Infra cible : Vercel (web) + Railway (api/jobs/DB) ; alternative UE à documenter (voir DECISIONS D-004).
Python local 3.9 : insuffisant pour `apps/ai`, prévoir 3.11+ (Docker).
