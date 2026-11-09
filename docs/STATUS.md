# État du produit (2026-11-08)
Tableau d'honnêteté : ce qui est **fonctionnel en local**, **testé en CI**, **déployé**, **connecté à un prestataire**, **validé juridiquement/métier**.

| Niveau | État |
|---|---|
| Fonctionnel en local | Auth/tenant/RBAC/audit, prospects, clients, consultants/onboarding, missions, CRA (portails consultant et client), factures, encaissements, registre, coque UI, clair/sombre |
| Testé automatiquement | 30 + 95 + 26 tests (domaine, API sur Postgres réel, E2E Playwright desktop et mobile). CI GitHub verte sur `main` au 2026-11-08 (typecheck, build, tests, seed, E2E sur PostgreSQL jetable) |
| Déployé | Test uniquement, base vide : web sur Vercel, API + PostgreSQL sur Railway (voir docs/DEPLOYMENT.md pour ce qui est vérifié et non vérifié) |
| Connecté à un prestataire | **Rien** (paie, DSN, facturation électronique, signature, banque, Sirene : non démarrés, statut « non connecté ») |
| Validé juridiquement / métier | **Rien**. Aucune règle légale n'est saisie ; aucune recette par un spécialiste paie ou juriste |

Reste à faire : tout ce qui est marqué ⬜ dans [IMPLEMENTATION_MATRIX.md](IMPLEMENTATION_MATRIX.md). Ordre prévu : Lot 1 (clients/consultants/onboarding/documents), Lot 2 (contrats, missions, CRA, frais), Lot 3 (facturation, banque, registre), Lot 4 (paie via prestataire, DSN, conformité), Lot 5 (portails), Lot 6 (agents IA), Lot 7 (audit transversal).
