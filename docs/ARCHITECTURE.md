# Architecture
Monorepo pnpm. Modular monolith pour le cœur métier.
- `apps/web` Next.js (App Router) · `apps/api` NestJS · `apps/ai` FastAPI/LangGraph · `apps/jobs` workers durables (Temporal si possible, sinon file en base + jobs idempotents) — **non créés à ce jour**.
- `packages/domain` règles pures testées (créé) · `packages/contracts` types/Zod/OpenAPI · `packages/integrations` adapters · `packages/design-system`.
- PostgreSQL (DECIMAL, migrations réversibles, RLS), Redis, stockage S3 privé (MinIO en dev), outbox/inbox, idempotence API, logs structurés, traces, health checks.
- Infra cible : Vercel (web) + Railway (api/jobs/DB) ; alternative UE à documenter (voir DECISIONS D-004).
Python local 3.9 : insuffisant pour `apps/ai`, prévoir 3.11+ (Docker).

## apps/web (créé)
Next.js 15 App Router. Le navigateur ne parle jamais directement à l'API : un BFF (`/api/session`, `/api/proxy/*`) stocke le JWT dans un cookie httpOnly/SameSite=Lax, applique une liste blanche de routes et vérifie `Origin` sur les écritures (CSRF). Variables : `API_URL` (défaut http://localhost:3001). Dev local : lancer l'API compilée (`pnpm -F @portage/api build && node apps/api/dist/main.js`, avec JWT_SECRET et APP_DATABASE_URL) puis `pnpm -F @portage/web dev`. `tsx` ne convient pas à l'API (pas de emitDecoratorMetadata).
