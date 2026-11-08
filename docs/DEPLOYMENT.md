# Déploiement (test, 2026-11-08)

| Composant | Plateforme | Détail |
|---|---|---|
| Web (Next.js + BFF) | Vercel, projet `portageos`, racine `apps/web`, Node 22 | https://portageos.vercel.app |
| API (NestJS) | Railway, projet `portageos`, service `api` (Dockerfile `apps/api/Dockerfile`) | https://api-production-3d59.up.railway.app (`/health`) |
| PostgreSQL | Railway, service `Postgres` | privé (`RAILWAY_PRIVATE_DOMAIN`) |

**État réel** : déployé en environnement de **test**, base **vide** (aucun tenant, aucune donnée de démonstration en ligne). Vérifié : `/health` = ok, migrations appliquées au démarrage, rôle `portage_app` activé, login via le BFF refusé proprement pour un tenant inexistant (401), API sans jeton = 401, en-têtes de sécurité du web présents. **Non vérifié** : connexion avec un compte réel en ligne (aucun tenant créé), sauvegarde/restauration, montée en charge, domaine personnalisé, protection de déploiement Vercel (l'URL est publique).

```
Navigateur ──► Vercel (UI + /api/session, /api/proxy ; variable API_URL) ──► Railway api ──► Railway Postgres
```

## Variables
Railway `api` : `DATABASE_URL=${{Postgres.DATABASE_URL}}` (propriétaire, migrations et bootstrap) · `APP_DB_PASSWORD` (aléatoire) · `APP_DATABASE_URL=postgresql://portage_app:<APP_DB_PASSWORD>@${{Postgres.RAILWAY_PRIVATE_DOMAIN}}:5432/${{Postgres.PGDATABASE}}` · `JWT_SECRET` (aléatoire, >= 32) · `APP_ENV=production` · `RAILWAY_DOCKERFILE_PATH=apps/api/Dockerfile`.
Vercel : `API_URL` (URL publique de l'API Railway), lue à l'exécution par le BFF.
Aucun secret n'est dans le dépôt ; les valeurs vivent dans Railway/Vercel.

## Procédure
```bash
# API (Railway) : railway.json + variable RAILWAY_DOCKERFILE_PATH imposent le Dockerfile
railway up --service api --detach
# Web (Vercel), depuis la racine du dépôt (rootDirectory=apps/web configuré sur le projet)
npx vercel deploy --prod --yes
```
Au démarrage l'API exécute `prisma migrate deploy`, puis `bootstrap-db` (LOGIN du rôle `portage_app`), puis démarre.

## Créer le premier tenant (une fois, hors UI)
```bash
railway run --service api -- sh -c 'BOOTSTRAP_TENANT_SLUG=ma-societe BOOTSTRAP_TENANT_NAME="Ma société" \
  BOOTSTRAP_ADMIN_EMAIL=admin@exemple.fr BOOTSTRAP_ADMIN_PASSWORD="<14+ caractères>" node apps/api/dist/bootstrap-tenant.js'
```
(`railway run` exécute localement avec les variables Railway : utiliser l'URL publique de la base si nécessaire.) Ne jamais exécuter le seed de démonstration en production : il refuse `APP_ENV=production`.

## Points d'attention
- `railway.json` est marqué obsolète par Railway (fin de support annoncée au 2026-12-01) : migrer vers l'Infrastructure as Code.
- Pas de déploiement automatique depuis GitHub (déploiements manuels par CLI à ce jour).
- Pas de MFA, pas de refresh de token : ne pas y mettre de données réelles.
- Hébergement UE : Railway et Vercel ne garantissent pas la résidence UE par défaut. Avant toute donnée RH/paie réelle : hébergement UE contractualisé (ex. Scaleway ou OVHcloud avec PostgreSQL managé et le même Dockerfile), DPA signé.
