# État du produit (2026-11-08)
Tableau d'honnêteté : ce qui est **fonctionnel en local**, **testé en CI**, **déployé**, **connecté à un prestataire**, **validé juridiquement/métier**.

| Niveau | État |
|---|---|
| Fonctionnel en local | Auth/tenant/RBAC/audit, prospects, clients, coque UI, clair/sombre |
| Testé automatiquement | 13 + 20 + 14 tests (domaine, API sur Postgres réel, E2E Playwright desktop et mobile). La CI GitHub n'a pas encore tourné au moment de la rédaction : voir l'onglet Actions |
| Déployé | Voir docs/DEPLOYMENT.md (état réel et URL consignés après chaque déploiement) |
| Connecté à un prestataire | **Rien** (paie, DSN, facturation électronique, signature, banque, Sirene : non démarrés, statut « non connecté ») |
| Validé juridiquement / métier | **Rien**. Aucune règle légale n'est saisie ; aucune recette par un spécialiste paie ou juriste |

Reste à faire : tout ce qui est marqué ⬜ dans [IMPLEMENTATION_MATRIX.md](IMPLEMENTATION_MATRIX.md). Ordre prévu : Lot 1 (clients/consultants/onboarding/documents), Lot 2 (contrats, missions, CRA, frais), Lot 3 (facturation, banque, registre), Lot 4 (paie via prestataire, DSN, conformité), Lot 5 (portails), Lot 6 (agents IA), Lot 7 (audit transversal).
