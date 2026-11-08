# PORTAGE OS — règles de contribution (pour Claude Code et humains)

SaaS multi-tenant pour sociétés de portage salarial françaises. Périmètre complet : voir `docs/PRODUCT_SCOPE.md`. État réel : `docs/IMPLEMENTATION_MATRIX.md` (source de vérité de l'avancement).

## Règles impératives
- Montants : `Money`/Decimal (`@portage/domain`), jamais de float. Aucun calcul de montant affiché côté UI isolé.
- Aucune constante légale (minima, plafond SS, taux) en dur : `ParameterCatalog` daté, sourcé, approuvé.
- Tenant ID imposé côté serveur ; ne jamais faire confiance au rôle envoyé par le front.
- Journal comptable append-only ; correction par contrepassation.
- Paie/DSN : pas de formule approximative présentée comme paie légale ; montants sans prestataire validé = « estimation ».
- Intégration externe : statut « non connecté » tant que credentials officiels et tests réels absents. Faux fournisseur = local uniquement.
- Une fonction n'est « terminée » que si UI + API + persistance + droits + validations + erreurs + audit + tests + doc existent. Mettre à jour la matrice avec preuve.
- Pas de données clients réelles dans exemples/tests. Seeds démo séparés de la prod.
- Design : Claude Design est la source de vérité visuelle : tokens/CSS dans `packages/design-system`, état et écarts dans `docs/DESIGN_HANDOFF.md`. Tokens sémantiques uniquement, pas d'hex en dur.

## Commandes
`pnpm setup | dev | test | lint | build | typecheck | migrate | seed`

## Reprise de travail
Lire la matrice, puis `docs/DECISIONS.md`. Mettre à jour les deux en fin de session.
