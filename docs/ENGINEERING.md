# Pratiques d'ingénierie
- **Définition de terminé** : UI + API + persistance + droits + validations + erreurs + audit + tests + documentation (voir PR template).
- **Tests** : domaine pur (vitest), API sur base réelle (supertest, fixtures par tenant, cas négatifs obligatoires), E2E Playwright sur ports dédiés (4310/4311) pour ne jamais réutiliser un serveur étranger.
- **Migrations** : Prisma, jamais d'édition d'une migration appliquée ; SQL de sécurité (RLS, grants, triggers) ajouté à la migration qui crée la table.
- **Argent** : `Money` (Decimal). Aucun `number` pour un montant. Arrondi par ligne (à valider).
- **Règles légales** : `ParameterCatalog`, source officielle citée, approbation humaine, période d'effet. Jamais déduites d'un LLM.
- **Intégrations** : statut « non connecté » tant que credentials officiels et tests réels absents.
- **Revue** : CODEOWNERS sur domaine, schéma et règles métier.
