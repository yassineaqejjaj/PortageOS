# Sécurité & RGPD
Cibles : isolation tenant (RLS + vérif objet), MFA/SSO, RBAC/ABAC, chiffrement, secrets hors code, audit immuable, uploads (AV, URLs temporaires), OWASP ASVS, RGPD (rétention, export, effacement), WCAG 2.2 AA, défenses IA (injection, fuite inter-tenant, budgets).
Statut actuel : seul le principe d'isolation tenant du journal est testé (domain). Reste **tout** à implémenter. `.env.example` sans secret.

## Implémenté (séance 2, testé sur Postgres réel)
- Tenant imposé côté serveur : `PrismaService.forTenant` pose `app.tenant_id` en transaction ; RLS sur `Company` et `AuditEvent` ; le rôle applicatif `portage_app` n'est pas propriétaire (donc soumis au RLS).
- Rôles relus en base à chaque requête (jamais pris du jeton) ; utilisateur désactivé = accès coupé immédiatement.
- Objets d'un autre tenant : 404 (IDOR testé en lecture et écriture).
- Audit append-only : triggers refusant UPDATE/DELETE/TRUNCATE, y compris pour le propriétaire.
- Mots de passe : scrypt avec sel ; comparaison à temps constant ; hash factice si utilisateur inconnu.
## Limites connues
- `Membership` et `User` ne sont pas sous RLS (nécessaires au login avant résolution du tenant) : écritures uniquement via services qui forcent le tenant.
- Limiteur de login en mémoire (mono-instance). Pas de MFA, SSO, refresh token, invitation par email, ni vérification de force des mots de passe au-delà de 12 caractères.
- `JWT_SECRET` unique, sans rotation. Pas de journal d'accès (lectures).
