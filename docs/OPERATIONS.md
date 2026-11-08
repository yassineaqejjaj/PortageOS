# Exploitation
- **Santé** : `GET /health` (API). Railway l'utilise comme healthcheck.
- **Migrations** : exécutées au démarrage de l'API (`prisma migrate deploy`, propriétaire). Rétro-compatibilité requise : un déploiement lancé pendant qu'une ancienne instance tourne.
- **Rôle applicatif** : `portage_app` est créé NOLOGIN par migration ; `scripts/db-roles.sh` lui donne LOGIN + mot de passe (variable `APP_DB_PASSWORD`). L'API se connecte avec ce rôle (soumis au RLS), jamais avec le propriétaire.
- **Secrets** : uniquement dans les variables Railway/Vercel. Rotation de `JWT_SECRET` = déconnexion de tous (pas de rotation douce à ce jour).
- **Sauvegardes** : celles de PostgreSQL Railway ; **restauration non testée** (à faire avant toute donnée réelle).
- **Journal d'audit** : append-only en base ; pas d'export externe à ce jour.
- **Incidents** : pas de procédure formalisée ni d'alerting à ce jour.
