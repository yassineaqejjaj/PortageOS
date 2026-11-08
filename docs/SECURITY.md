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
- Front : jeton jamais accessible au JS (cookie httpOnly), liste blanche du proxy, contrôle d'Origin sur login/logout/écritures (vérifié par curl), en-têtes X-Frame-Options/nosniff/Referrer-Policy. Pas de CSP ni de rate limiting côté BFF (à faire). Pas de renouvellement de session : expiration à 15 min = retour au login.

## Séance 5
- RLS étendue à Consultant, Mission, Timesheet(+Line), Invoice(+Sequence), Payment, JournalEntry/Line, OnboardingTask.
- Portails : cloisonnement par `Membership.companyId` / `consultantId` (contrôle d'objet applicatif en plus du RLS tenant). Le portail client ne renvoie ni TJM, ni montants, ni rémunération (test sur le contenu des réponses).
- Registre : append-only (journal, paiements), équilibre vérifié en base par contrainte différée, montants contraints (CHECK).
- Limite : le rattachement d'un utilisateur à une entreprise/un consultant se fait par la base (aucune UI d'administration des membres) ; le contrôle d'objet des portails repose sur le code des contrôleurs (pas de RLS par entreprise).
- Données personnelles : les dossiers consultants contiennent des données personnelles (nom, email) ; pas de pièces d'identité ni de RIB stockés à ce jour. Avant d'y ajouter des pièces d'identité, coordonnées bancaires ou données de paie (classification C2/C3 selon votre politique), chiffrement applicatif, journal d'accès et hébergement UE sont à mettre en place.

## Séance 6
- Paramètres réglementaires : quatre yeux appliqué par le code ET par contrainte SQL (`approvedBy <> createdBy`), versions approuvées immuables (trigger).
- Contrats signés, modèles publiés, avoirs : immuables (triggers). La « signature » est une déclaration interne tracée ; elle n'a pas la valeur d'une signature électronique qualifiée.
- Notes de frais : séparation des tâches (pas d'auto-approbation), remboursement réservé à la finance.
- Compte d'activité : montant jamais calculé avec un paramètre manquant ; étiqueté estimation.
- Limite : les justificatifs ne sont pas stockés (référence texte). Avant tout dépôt de fichiers : stockage privé, antivirus, URL temporaires, contrôle d'accès.

## Séance 7
- Absences : RLS sur LeaveRequest/LeaveAdjustment ; ajustements de solde append-only et motivés ; pas d'auto-approbation ; un arrêt maladie ne consomme pas le solde. Les motifs d'absence et arrêts maladie sont des données de santé sensibles (art. 9 RGPD) : le champ `reason` est libre et ne doit pas contenir de diagnostic ; chiffrement applicatif, minimisation des accès et durée de conservation à définir avant tout usage réel.
- Limite : le non-chevauchement des demandes est vérifié par le code, pas par une contrainte SQL.

## Séance 8 — agents
- Moindre privilège : un agent s'exécute avec les permissions de l'utilisateur qui le lance (vérifiées avant le run et à chaque appel d'outil) ; liste blanche d'outils par agent ; lecture et écriture distinctes.
- Aucune écriture autonome : une action est une proposition figée (outil, arguments, montant, niveau d'approbation immuables par trigger), exécutée seulement après approbation d'un humain disposant du droit de l'action, avec SES droits. L'audit attribue l'action à l'humain. Au-delà d'un seuil de montant paramétré (`ai.second_approval_threshold_eur`), deux approbateurs distincts sont requis ; les décisions concurrentes sont sérialisées (verrou de ligne) et l'exécution n'a lieu qu'une fois.
- Budgets et coupe-circuit par agent et par tenant (appels d'outils par exécution, exécutions par jour, désactivation immédiate), configurables par l'administrateur seul.
- Isolation : RLS sur toutes les tables d'agents ; journal d'appels et approbations append-only.
- **Non couvert** : aucun modèle de langage n'est connecté. Par conséquent, l'injection de prompt, l'exfiltration via un modèle, le RAG avec ACL, la minimisation des données envoyées à un fournisseur et les évaluations de modèles ne sont ni implémentés ni testés. Ils devront l'être AVANT toute connexion d'un LLM (analyse d'impact RGPD, validation juridique).
