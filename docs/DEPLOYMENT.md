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

## Variables optionnelles (séance 16)
| Variable | Effet |
|---|---|
| `SMTP_URL`, `MAIL_FROM`, `WEB_BASE_URL` | active l'envoi d'e-mails (invitation, mot de passe oublié) ; sans eux : `not_connected` au journal, rien n'est envoyé |
| `STORAGE_DRIVER=s3`, `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE=1` | contenu des nouveaux documents dans un stockage objet ; `node apps/api/dist/migrate-blobs.js --dry-run` puis sans option pour migrer l'existant |
| `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` | active la réception WhatsApp (webhook `POST/GET /webhooks/whatsapp`, à déclarer dans l'application Meta) ; sans eux : le webhook refuse tout (403) et les envois restent possibles. `WHATSAPP_GRAPH_VERSION` (défaut `v21.0`, à contrôler face à la version supportée par Meta). `WHATSAPP_PROVIDER=fake` = local uniquement, ignoré en production |
| `METRICS_TOKEN` | active `GET /metrics` (jeton porteur) ; absent = 404 |
| `/health/ready` | sonde de disponibilité (base interrogée) ; `/health` reste la sonde légère |

## Société de démonstration en ligne
`ALLOW_ONLINE_DEMO=1 DEMO_ONLINE_PASSWORD=<14+ car.> node apps/api/dist/demo-tenant.js` (via `railway ssh`, depuis `/repo`) crée le tenant `demo-en-ligne` et 10 comptes fictifs. Le slug doit commencer par `demo` ; jamais pour une société réelle.

## Console plateforme (exploitant)
Créer UNE fois le tenant d'exploitation (MFA obligatoire, impossible d'en créer un second) :
```
BOOTSTRAP_PLATFORM=1 BOOTSTRAP_TENANT_SLUG=exploitation BOOTSTRAP_TENANT_NAME="Exploitation" BOOTSTRAP_ADMIN_EMAIL=<email> BOOTSTRAP_ADMIN_PASSWORD="<14+ caractères>" node apps/api/dist/bootstrap-tenant.js
```
Se connecter avec la société `exploitation`, activer le MFA (obligatoire), puis ouvrir `/operator`. Les sociétés se créent ensuite depuis la console.
