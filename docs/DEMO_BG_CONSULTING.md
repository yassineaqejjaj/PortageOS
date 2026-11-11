# Démo « BG Consulting » (société pilote)

Environnement de démonstration **local et fictif**, rejoué à travers l'API (machines d'état, droits, numérotation, journal, audit réels). Script : [`apps/api/scripts/demo-bg-consulting.ts`](../apps/api/scripts/demo-bg-consulting.ts).

## Ce que la démo n'est pas
- **WhatsApp est simulé** (`WHATSAPP_PROVIDER=fake`, interdit en production) : aucun message ne part vers Meta. Les messages sont marqués « simulé ». Les réponses entrantes passent par le vrai webhook signé (HMAC).
- **Les agents sont déterministes** (playbooks), sans LLM : ils lisent, détectent, **proposent** ; un humain approuve.
- Signature de contrat **déclarée** (pas de signature qualifiée), facturation **non connectée** à une plateforme agréée, aucune paie/DSN. Données entièrement fictives.

## Lancer
```bash
docker compose up -d postgres && pnpm migrate            # base prête (rôle portage_app via scripts/db-roles.sh)
pnpm -F @portage/domain build && pnpm -F @portage/api build

export JWT_SECRET=... MFA_ENCRYPTION_KEY=... APP_DATABASE_URL=... DATABASE_URL=...     # valeurs locales
export WHATSAPP_PROVIDER=fake WHATSAPP_APP_SECRET=... WHATSAPP_VERIFY_TOKEN=...
node apps/api/dist/main.js                                # API :3001   (pas `tsx` : les décorateurs NestJS exigent le build tsc)

DEMO_PASSWORD=... pnpm -F @portage/api demo:bg            # injecte la société (idempotent : s'arrête si elle existe)
API_URL=http://localhost:3001 pnpm -F @portage/web exec next dev -p 3456
```
Connexion : champ « Société » = `demo-bgconsulting`, e-mail ci-dessous, mot de passe = `DEMO_PASSWORD`. Autre slug : `DEMO_TENANT_SLUG=demo-…`.

## Comptes
| Rôle | Compte |
|---|---|
| Admin, Commerce, Ops, Finance, RH, Direction, Conformité, Expert-comptable | `admin@`, `commerce@`, `ops@`, `finance@`, `hr@`, `direction@`, `compliance@`, `accountant@` + `demo-bgconsulting.test` |
| Consultants | `lea.fontaine@`, `karim.benali@`, `ines.moreau@`, `thomas.girard@`, `sofia.nguyen@` + `demo-bgconsulting.test` |
| Clients (portail) | `client.bm@` (Banque Méridienne), `client.at@` (Atlantis), `client.he@` (Helios) + `demo-bgconsulting.test` |

## Données injectées
| Domaine | Contenu |
|---|---|
| Lead gen | 2 campagnes (salon consultants, prospection DSI), 13 prospects à tous les stades (nouveau, contacté, qualifié, converti, perdu), interactions, tâches de relance, apporteur + parrainage, simulation de rémunération |
| Conversion | 5 consultants et 3 sociétés clientes créés **par conversion de prospects**, accords-cadres actifs |
| Onboarding | 4 consultants activés ; **Sofia Nguyen** laissée à mi-checklist |
| Contrats | Modèle CDI publié ; 3 signés, 1 envoyé (Thomas, à relancer), 1 brouillon (Sofia) |
| Parrainage et cooptation | Modules *CRM > Apporteurs et commissions*. **Parrainage** : Léa Fontaine parraine Thomas Girard (3 % du net encaissé, 12 mois ; 2 commissions dues). **Cooptation** : Karim coopte Sofia (prime fixe 500 €, convertie → approuvée par la finance puis **payée**, écriture au registre) ; Léa coopte Yasmine (400 €) et Inès coopte Romain (500 €), candidats encore en cours → prime à venir. **Apporteur d'affaires** : Cabinet Alpha RH sur Inès (5 %, 12 mois ; 1 commission approuvée, 1 due). Règles figées à la création, approbation en quatre yeux |
| Missions | 4 missions (TJM 610–850 €) |
| CRA → cash | Août–sept. : 8 CRA validés, facturés, encaissés (Thomas : encaissement partiel) · Oct. : 2 factures émises non réglées, 1 CRA validé **non facturé**, 1 CRA approuvé client **à valider** · Nov. : 1 soumis, 1 brouillon, 2 non démarrés |
| Notes de frais | 1 remboursée, 1 approuvée, 1 soumise, 1 brouillon |
| Congés | Soldes initiaux, 1 approuvé, 2 en attente, 1 refusé (motif) |
| WhatsApp | Canal simulé, modèle de relance CRA activé, consentements tracés (**Sofia sans consentement**), 3 relances CRA, 2 réponses entrantes |
| Agents | 5 exécutions ; propositions en attente d'approbation |

## Scénario de démo (≈ 25 min)
1. **Lead → contrat** (`commerce`, puis `hr`) : CRM > Prospects (entonnoir) → Campagnes → un prospect converti → Consultants (dossier créé) → Contrats (signé / envoyé / brouillon).
2. **Onboarding** (`ops`) : dossier de Sofia incomplet → *Agents* > Onboarding Agent la signale.
3. **Vie du consultant** (`lea.fontaine`) : Mes CRA (novembre soumis) · Mes frais · Mes absences (solde, demande) · Assistant (« Ma synthèse »).
4. **Alertes CRA WhatsApp** (`ops`) : WhatsApp > Relancer la file → boîte de réception ; les réponses de Thomas et Inès sont entrantes ; envoyer `STOP` (webhook) retire le consentement. Sofia : relance refusée faute de consentement.
5. **Validation client** (`client.bm`) : approuver un CRA → `ops` valide.
6. **Agents administratifs** (`ops`, `finance`) : *Operations Agent* propose la validation du CRA de Thomas ; *Finance Agent* propose la facture du CRA d'Inès ; **approuver** une proposition → facture brouillon → émission (`finance`) → encaissement.
7. **Parrainage / cooptation** (`commerce`, puis `finance`) : CRM > Apporteurs et commissions → parrains et règles ; `finance` approuve une commission due (refusé à l'auteur du parrainage) puis la paie ; convertir Yasmine ou Romain (`commerce`) fait naître la prime de cooptation.
8. **Pilotage / registre** (`direction`, `finance`) : CA, créances, journal équilibré.

Repartir de zéro : supprimer le tenant (voir la note ci-dessous) ou utiliser un autre `DEMO_TENANT_SLUG`.

> Le journal d'audit est append-only (triggers) : un tenant ne se supprime pas via l'API. En local, la remise à zéro se fait en base avec `session_replication_role = replica` (à ne jamais faire hors dev).
