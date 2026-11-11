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

## Séance 9 — notifications et support
- Notifications : boîte strictement personnelle (filtrée par utilisateur authentifié, IDOR = 404), destinataires déterminés côté serveur (client = utilisateurs de l'entreprise de la mission uniquement), l'acteur n'est pas notifié de sa propre action, seule la date de lecture est modifiable (trigger), jamais supprimées.
- Support : un demandeur ne voit que ses tickets (404 sinon), les notes internes sont filtrées côté serveur dans la requête, les messages sont append-only, le contenu est stocké en texte brut et affiché échappé (React), longueurs bornées.
- Limites : pas de pièces jointes (pas d'antivirus à gérer), pas de limitation de débit propre à la création de tickets/messages (risque d'abus par un compte authentifié), pas d'e-mail (aucune fuite par e-mail, mais pas d'alerte hors application). Les tickets peuvent contenir des données personnelles saisies librement : durée de conservation à définir.

## Séance 10 — pilotage
- Accès réservé à `pilotage.read` (administrateur, direction, finance) ; l'export CSV est audité et protégé contre l'injection de formules (cellules commençant par = + - @ préfixées).
- Les agrégats sont calculés dans la transaction du tenant (RLS) : aucun mélange inter-tenant (testé).
- Limite : la période est bornée à 36 mois et le calcul se fait en mémoire ; pas de limitation de débit propre aux exports.

## Séance 11 — authentification complète
- **Sessions** : le jeton de rafraîchissement est opaque (256 bits), stocké HACHÉ ; rotation à chaque usage ; réutilisation d'un ancien jeton hors fenêtre de 15 s = vol présumé, session révoquée et événement d'audit ; durée absolue 30 jours, inactivité 7 jours ; chaque requête vérifie en base que la session n'est ni révoquée ni expirée (révocation immédiate : déconnexion, retrait d'un membre, changement ou réinitialisation de mot de passe).
- **BFF** : jeton d'accès et de rafraîchissement en cookies httpOnly/SameSite=Lax ; le rafraîchissement est limité au chemin /api ; renouvellement transparent et une seule relance ; contrôle d'Origin sur toutes les écritures.
- **MFA TOTP** : secret chiffré AES-256-GCM (clé `MFA_ENCRYPTION_KEY`, 32 octets) ; vérification à temps constant, fenêtre ±1 pas, pas déjà utilisé refusé (mise à jour atomique) ; codes de secours hachés, à usage unique ; 5 échecs/minute puis blocage (mémoire, mono-instance) ; jeton d'étape de 5 minutes sans accès aux routes ; désactivation = mot de passe + code. MFA imposable par société, avec refus si l'administrateur n'est pas lui-même inscrit.
- **Invitations / réinitialisation** : lien à usage unique, 7 jours, jeton haché, une seule invitation active par adresse, liaison obligatoire à une entreprise (client) ou un dossier (consultant), un compte existant doit prouver son mot de passe et n'est jamais modifié. **Aucun e-mail n'est envoyé** : le lien est transmis par l'administrateur.
- **Mot de passe** : 12 caractères minimum, pas d'identifiant ni de mots courants, 3 types de caractères ou 16+ ; scrypt avec sel.
- **Limites connues** : pas de SSO ni WebAuthn ; limiteur d'échecs en mémoire (non partagé entre instances, perdu au redémarrage) ; `Session`, `Invitation` et `User` ne sont pas sous RLS ; pas de rotation douce des clés ; les codes de secours ne sont régénérables qu'en désactivant puis réactivant le MFA ; pas de notification de connexion inhabituelle.

## Séance 12 — comptabilité et clôture
- Une période close n'accepte plus aucune écriture : refus applicatif (409) ET trigger PostgreSQL sur l'insertion de `JournalEntry` (testé par insertion directe). La clôture est séquentielle, exige l'absence de blocages (factures brouillon, périodes antérieures ouvertes avec écritures) et l'accusé de réception explicite des avertissements, conservés dans l'audit append-only. La réouverture est réservée à l'administrateur, motivée, et se fait en ordre inverse.
- Les écritures manuelles exigent un motif, sont équilibrées et se corrigent par contrepassation (écritures manuelles uniquement : les écritures automatiques se corrigent par leurs flux). Les comptes inconnus ou inactifs sont refusés.
- Le rôle `external_accountant` accède à la comptabilité (lecture, exports) et à rien d'autre (testé). Les exports sont audités ; l'export FEC est marqué provisoire tant que la période n'est pas close.
- Limites : le plan comptable par défaut et le format FEC n'ont pas été validés par un expert-comptable ni par l'outil officiel de contrôle ; la validation d'exercice n'existe pas (clôture mensuelle seulement).

## Séance 13 — documents et justificatifs
- **Validation du contenu** : le type est déduit de la signature binaire (PDF, PNG, JPEG, WebP), jamais du type MIME ni de l'extension annoncés ; un exécutable ou un script renommé est refusé ; 10 Mo maximum (contrôlé par le BFF, l'API et la base) ; nom assaini et extension imposée.
- **Téléchargement** : toujours en pièce jointe, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox`, `Cache-Control: private, no-store` ; jamais d'aperçu en ligne (pas de XSS par document).
- **Contrôle d'accès par objet** (et non par simple rôle) : personne concernée ou rôle habilité ; pièce d'identité et RIB réservés à la RH/administration et à la personne concernée, **non partageables par lien**, invisibles des autres rôles (liste filtrée) ; le portail client n'accède à aucun document (testé) ; isolation inter-sociétés par RLS (404).
- **Liens temporaires** : jeton signé (HS256, finalité dédiée), 15 minutes maximum, uniquement pour les documents non sensibles et pour un rôle disposant du droit de partage ; chaque accès par lien est journalisé ; un document supprimé devient indisponible (410).
- **Antivirus** : client ClamAV (INSTREAM) **fail-closed** : si le démon est configuré mais injoignable, l'envoi est refusé (503) ; un fichier infecté est refusé, rien n'est stocké et l'événement est audité (transaction distincte, il survit au refus). **Sans démon configuré, les fichiers sont stockés « non analysés » et l'interface l'indique** : en production actuelle, aucune analyse antivirus n'est active. Les tests utilisent un démon simulé : ils valident notre client du protocole, pas le moteur d'analyse.
- **Cycle de vie** : suppression logique motivée (droit dédié), purge physique du contenu après suppression (droit à l'effacement) avec conservation des métadonnées et de l'audit ; contenu et métadonnées immuables en base (triggers). Pas de rétention automatique ni de chiffrement applicatif du contenu à ce jour ; le contenu est stocké dans PostgreSQL (sauvegardes de la base = sauvegardes des documents).
- **Journal d'accès** : téléchargements authentifiés et par lien dans l'audit append-only (acteur, document, catégorie).
- Données personnelles sensibles : une pièce d'identité ou un RIB déposé en production relève de votre analyse d'impact (classification C2/C3) : hébergement UE, chiffrement et durée de conservation sont à définir avant tout usage réel.

## Séance 14 — CRM
- **Profilage** : le score de priorisation est calculé à partir de données que la société détient déjà (interactions, étape, campagne) ; il est explicable critère par critère, réglable, **sans effet automatique** (aucune décision n'en découle) ; il doit figurer au registre de traitement et à l'information des personnes (DPO : non fait, cf. BLOCKERS).
- **Import CSV** : 1 Mo / 2 000 lignes, aperçu sans écriture, adresses validées, doublons écartés, validation à usage unique (revendication atomique), annulation logique tracée ; corps JSON limité à 1,5 Mo, au-delà 413.
- **Commissions** : droits distincts (lecture, approbation, paiement), quatre yeux entre générateur et approbateur, règle et montants figés par triggers, unicité par source (idempotence), écriture comptable avec clé idempotente.
- **Journaux** : interactions et simulations append-only (triggers).

## Séance 16
- **Mot de passe oublié** : pas d'énumération (réponse identique), limite par adresse, lien haché en base, 1 h, usage unique ; le journal d'e-mails (`EmailOutbox`, append-only) ne contient ni corps, ni lien, ni adresse en clair.
- **Stockage objet** : empreinte vérifiée à chaque lecture (altération → 503), chiffrement côté serveur demandé, pilote mémoire interdit en production.
- **Observabilité** : journaux sans corps ni requête ni identifiants dans les routes ; `/metrics` désactivé sans jeton.

## Séance 23 : WhatsApp
- **Webhook public** (`/webhooks/whatsapp`) : refusé (403) sans `WHATSAPP_APP_SECRET`/`WHATSAPP_VERIFY_TOKEN` ; sinon signature HMAC-SHA256 du **corps brut** vérifiée à temps constant avant tout traitement (401 si absente, erronée ou corps modifié). Rejeu inoffensif (identifiant fournisseur unique par tenant).
- **Isolation** : toutes les tables WhatsApp sont sous RLS, sauf `WhatsappRoute` (phone_number_id → tenant, aucun secret) nécessaire pour router un webhook avant de connaître le tenant ; un numéro ne peut appartenir qu'à une société.
- **Secrets** : jeton d'accès chiffré AES-256-GCM (clé du MFA), jamais renvoyé ni journalisé ; messages d'erreur du fournisseur tronqués et sans jeton ; suppression du jeton et du routage à la désactivation.
- **Consentement** : aucun envoi sans consentement enregistré (preuve, origine, audit) ; STOP le retire automatiquement ; rétablissement humain tracé.
- **Limites** : les corps de messages sont conservés sans purge automatique ; pas de secret d'application par société ; un message « sending » interrompu par un arrêt du serveur n'est pas repris automatiquement.
