# ADR 0001 — Isolation multi-tenant par RLS PostgreSQL

Statut : accepté (2026-11-08)

## Décision
Le rôle applicatif `portage_app` n'est pas propriétaire des tables et chaque transaction pose `app.tenant_id` (`PrismaService.forTenant`). Les politiques RLS filtrent `Company`, `Prospect`, `AuditEvent`.

## Conséquences
Une erreur applicative (oubli de filtre) ne peut pas fuiter entre tenants. Coût : toute requête métier passe par `forTenant`; `User`/`Membership` restent hors RLS (login avant résolution du tenant). Un test de mutation (RLS désactivé) fait échouer les tests d'isolation.
