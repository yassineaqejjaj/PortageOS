# PORTAGE OS — Paquet de transmission pour Claude Code

Source de vérité visuelle : le canvas Claude Design « PORTAGE OS — Produit & Design System 2027 ».
Ce dossier contient : `HANDOFF.md` (ce fichier), `tokens.json` (tokens W3C-like, light + dark), `tokens.css` (CSS variables + classes de référence utilisées dans les artboards).

> Toutes les données des maquettes sont **fictives**. Aucun seuil légal n'est codé en dur : il provient d'un moteur de règles versionné (`RuleEngine`), dont la version est affichée à l'écran.

## 1. Stack recommandée
- Next.js (App Router) + TypeScript strict, Tailwind configuré sur les CSS variables de `tokens.css` (`theme.extend.colors = { bg: { canvas: 'var(--color-bg-canvas)' … } }`).
- Primitives accessibles : Radix UI / shadcn (Dialog, Popover, Tabs, Combobox, Toast).
- Tableaux : TanStack Table (tri, colonnes configurables, sélection, virtualisation).
- Formats : `Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' })`, dates `dd/MM/yyyy` (date-fns, locale `fr`).
- Thème : attribut `data-theme="dark"` sur `<html>` ; défaut = préférence système.

## 2. Artboards → routes
| Artboard | Route | Rôle(s) |
|---|---|---|
| Main | (documentation) | — |
| DS-Foundations / DS-Components / DS-AI | `/design-system` (Storybook conseillé) | dev |
| Sidebar, Topbar | composants `nav/Sidebar`, `nav/Topbar` | tous |
| BO-Operations | `/bo` | gestionnaire, direction |
| BO-Agents | `/bo/agents/runs/:id` | gestionnaire (+ droits métier de chaque action) |
| BO-Facturation | `/bo/facturation`, `/bo/facturation/:id` (drawer) | finance, gestionnaire |
| BO-Paie | `/bo/paie/:periode` | gestionnaire paie |
| CO-Accueil | `/me` | consultant |
| CO-Compte | `/me/compte/:periode` | consultant |
| CO-Mobile | `/me`, `/me/cra/:periode` (≤ 599 px) | consultant |
| CL-CRA / CL-Mobile | `/client/cra`, `/client/cra/:id` | approbateur client |
| Flow-CRA-Facture | parcours 3 (transversal) | multi-rôles |

### Sitemap complet (routes à implémenter)
- **/auth** : `login`, `mfa`, `sso/callback`, `reset`, `invite/:token`, `select-tenant`, `select-role`, `onboarding`
- **/bo** : `crm/consultants`, `crm/entreprises`, `consultants/:id`, `contrats/:id(/diff)`, `missions/:id`, `activite`, `activite/cra/:id`, `frais/:id`, `facturation/:id`, `tresorerie/{encaissements,rapprochements,recouvrement,previsions}`, `paie/:periode`, `comptes/:consultant`, `rh/*`, `conformite/*`, `compta/*`, `pilotage/*`, `support/*`, `agents/{catalogue,runs/:id,approvals,incidents}`, `config/{marque,societes,roles,utilisateurs,regles,integrations,billing,api,webhooks,retention,audit}`
- **/me** : `missions`, `cra/:periode`, `frais`, `compte/:periode`, `simulateur`, `factures`, `documents`, `contrats`, `rh`, `support`, `assistant`, `preferences`
- **/client** : `consultants`, `cra/:id`, `commandes`, `contrats`, `factures`, `litiges`, `contacts`, `assistant`, `parametres`
- **/partner** : `dossiers`, `exports`, `commissions`, `documents`
- **/saas** : `tenants/:id`, `offres`, `abonnements`, `usage`, `quotas-agents`, `support-acces`, `integrations`, `logs`

## 3. Entités principales
`Tenant, User, Role, Permission, Consultant, ClientCompany, ClientContact, Contract(version), Amendment, Mission, RateHistory, Cra, CraDay, ApprovalStep, Expense, Invoice, InvoiceLine, EInvoiceEvent, Payment, BankTransaction, Reconciliation, Reminder, Dispute, PayrollPeriod, PayrollVariable, Payslip, Dsn, ActivityAccountEntry, Statement, Rule(version), ComplianceCheck, AgentRun, AgentStep, ProposedAction, Source, AuditEvent, Notification`.

## 4. Mapping écran → actions → API (indicatif REST)
- **Operations** : `GET /closings/{period}`, `GET /approvals?status=pending`, `GET /kpis?period=&tenant=` — chaque KPI renvoie `{value, unit, source, asOf}`.
- **Agents** : `POST /agent-runs {goal}` → plan ; `PATCH /agent-runs/{id} {state: paused|running|stopped}` ; `POST /actions/{id}/(approve|reject|retry)` ; `GET /actions/{id}/sources`.
- **Facturation** : `GET /invoices`, `POST /invoices/{id}/issue`, `POST /invoices/{id}/einvoice`, `POST /payments`, `POST /reminders` (brouillon IA → validation).
- **Paie** : `GET /payroll/periods/{p}`, `POST /payroll/periods/{p}/variables/import`, `POST /payroll/periods/{p}/validate` (rôle paie uniquement).
- **Consultant** : `GET /me/summary`, `GET /me/account/entries?period=`, `GET /me/statements/{p}.pdf`, `PUT /me/cra/{p}`, `POST /me/cra/{p}/submit`, `POST /me/assistant` (scope = dossier personnel côté serveur).
- **Client** : `POST /client/cra/{id}/approve`, `POST /client/cra/{id}/reject {reason}` — les DTO client **excluent** toute donnée salariale.

## 5. Règles d'interaction IA (non négociables)
1. Cycle de vie : `suggestion → draft → ready → approved → executed | failed` (+ `rejected`, `paused`).
2. Un agent agit avec les permissions de l'utilisateur qui l'a lancé ; une action dont la permission manque est « Transmettre à … ».
3. Paie, virements, contrats, DSN, factures émises, suppression : validation humaine explicite ; virements = saisie de confirmation.
4. Toute proposition expose : responsable, objets touchés, avant/après, sources datées, données manquantes, annulabilité.
5. Lots : seuls les risques faibles sont sélectionnables en lot.
6. Pause / Arrêt / Escalade toujours accessibles ; statuts annoncés via `aria-live`.

## 6. États à implémenter partout
normal, hover, focus-visible, active, loading (skeleton > spinner), disabled, success, error, warning, empty, read-only, forbidden (403), session expirée, erreur API avec code incident, conflit de version (diff + fusion).

## 7. Responsive
- ≥ 1280 : sidebar 248 + topbar 64 + contenu (max 1600) + drawer 480.
- 600–1279 : sidebar 72 icônes, drawer en overlay, colonnes secondaires masquées.
- ≤ 599 : portails consultant/client + opérations essentielles ; tab bar basse 4 entrées ; tableaux → listes de cartes ; barre d'action collante ; cibles 44 px.

## 8. Jeu de données fictif (cohérence)
- Sociétés : **Altitude Portage** (15 consultants), **Nexa Portage** (6).
- Clients Altitude : Helioris Énergie, Banque Méridienne, Groupe Valdor Retail, Atlas Mobilités, Orbe Logistique ; client Nexa : Clinéa Santé Numérique.
- Héroïne consultant : Camille Moreau, M-2026-014 Helioris, TJM 650 €, oct. 20 j → F-2026-0412 13 000 € HT / 15 600 € TTC ; compte d'activité 3 420,00 → 5 631,60 € ; net 4 772,00 € versé le 10/11/2026.
- Impayés : F-2026-0371 (18 720 € TTC, 24 j), F-2026-0388 (14 160 €, 19 j), F-2026-0365 (reste 8 400 € sur 14 400 €) = 41 280 € TTC.
- Anomalies : Karim Benali 23 j/22 ; Inès Garnier sous plancher de rémunération (règle PAIE-MIN v2026.4) ; Pierre Martin sortie 31/10.

## 9. Couverture (état au lot 1)
Conçus en haute fidélité : Design System (3 artboards + nav), Operations Center (avec bascule de tenant), Agent Workspace, Facturation, Paie, Accueil et Compte consultant, mobile consultant, CRA client desktop + mobile, parcours 3 cliquable, handoff.
Spécifiés (routes/composants/états, écrans à produire aux lots suivants) : voir la matrice de l'artboard « Handoff ».

## 10. Références officielles citées dans les écrans de conformité
- https://entreprendre.service-public.gouv.fr/vosdroits/F31620
- https://www.legifrance.gouv.fr/conv_coll/id/KALICONT000035326397
- https://www.economie.gouv.fr/tout-savoir-sur-la-facturation-electronique-pour-les-entreprises
