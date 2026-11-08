# PORTAGE OS

**Le poste de gestion du portage salarial français : CRM, contrats, CRA, facturation, paie via prestataire, compte d'activité et agents IA, dans un SaaS multi-tenant en marque blanche.**

> **Statut : socle en construction (Lot 0 terminé, Lot 1 amorcé). Ce n'est pas un produit utilisable en réel.**
> Aucune paie, DSN, facturation électronique, signature ni intégration bancaire n'est implémentée ou connectée. Rien n'a été validé juridiquement ni par un spécialiste paie. Voir [docs/STATUS.md](docs/STATUS.md) pour l'état exact, module par module.

|                     |                                                                                              |
| ------------------- | -------------------------------------------------------------------------------------------- |
| **Stack**           | TypeScript · Next.js 15 · NestJS · Prisma · PostgreSQL (RLS) · Playwright · Docker           |
| **Qualité**         | 25 tests domaine · 73 tests API/intégration (base réelle) · 22 tests E2E · TypeScript strict · CI |
| **En ligne (test)** | Voir [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) (Railway : API + PostgreSQL · Vercel : web)     |
| **Design**          | Claude Design importé (`packages/design-system`), clair et sombre, WCAG 2.2 AA visé          |
| **Données**         | 100 % fictives (jeux de démonstration isolés des workflows réels)                            |

![Facturation, thème clair](docs/screenshots/factures-light.png)

## Sommaire
[Ce qui existe](#ce-qui-existe) · [Ce qui n'existe pas](#ce-qui-nexiste-pas-encore) · [Architecture](#architecture) · [Sécurité](#sécurité) · [Qualité et tests](#qualité-et-tests) · [Démarrer en local](#démarrer-en-local) · [Déploiement](#déploiement) · [Structure du dépôt](#structure-du-dépôt) · [Documentation](#documentation)

## Ce qui existe
| Domaine | Contenu réel | Preuve |
|---|---|---|
| Identité et tenants | Login JWT 15 min, mots de passe scrypt, appartenances multi-sociétés, 12 rôles RBAC, limiteur d'échecs de login | `apps/api/test/tenant-isolation.test.ts` |
| Isolation | RLS PostgreSQL par tenant, rôles relus en base à chaque requête, IDOR = 404, test de mutation RLS | idem + [ADR 0001](docs/adr/0001-rls-tenant-isolation.md) |
| Audit | Journal append-only (triggers), écrit pour les actions critiques | [ADR 0003](docs/adr/0003-append-only-audit.md) |
| Domaine pur | Montants Decimal, TVA par ligne, paramètres réglementaires datés/sourcés/approuvés, journal comptable équilibré avec contrepassation, numérotation sans trou, machine d'état | `packages/domain/test` |
| CRM prospects | Pipeline nouveau → contacté → qualifié → converti / perdu, préconditions, concurrence optimiste, audit | `apps/api/test/prospects.test.ts`, E2E |
| Clients | Entreprises clientes (nom, SIREN), validation | tests API + E2E |
| Consultants | Dossier, checklist d'onboarding (6 tâches manuelles), activation conditionnée, création à la conversion d'un prospect | `billing-chain.test.ts` |
| Missions | Consultant actif × client, TJM, TVA saisie, dates | idem |
| CRA | Saisie contrôlée (½/1 jour, période, dates), machine d'état, portails consultant et client cloisonnés (client sans donnée salariale), preuve en audit, verrouillage | idem + `e2e/chain.spec.ts` |
| Facturation | Facture depuis CRA validé (Decimal), numérotation sans trou, émission, encaissements partiels, annulation par contrepassation. **Non connectée** à une plateforme agréée | idem |
| Paramètres réglementaires | Catalogue daté, sourcé, approuvé à quatre yeux, immuable ; aucune valeur légale livrée | `modules2.test.ts` |
| Notes de frais | Barème kilométrique paramétré (refus s'il manque), plafond repas signalé, justificatifs (référence), doublons, séparation des tâches, remboursement + journal | idem + E2E |
| Avoirs | Avoir total numéroté (AV), contrepassation | idem |
| Compte d'activité | Relevé mensuel **estimatif** détaillé, sourcé, jamais présenté comme un salaire | idem + E2E |
| Contrats | Modèles versionnés immuables, variables strictes, signature **déclarée** (non qualifiée) | idem + E2E |
| Absences et congés | Décompte en jours ouvrés (fériés = paramètres approuvés), solde par ajustements RH motivés, approbation sans auto-validation, annulation, cohérence avec le CRA | `leaves.test.ts` + E2E |
| Agents | 6 agents (Payroll indisponible), outils typés lecture/écriture, playbooks **déterministes**, propositions approuvées par des humains (1 ou 2 niveaux), budgets, coupe-circuit, journal d'appels. **Aucun LLM connecté** | `agents.test.ts` + E2E |
| Notifications | In-app (CRA, frais, absences, support), destinataires cloisonnés, préférences par type. **E-mail non connecté** | `support-notifications.test.ts` + E2E |
| Support | Tickets, réponses, notes internes invisibles du demandeur, workflow, assignation, recherche, modèles | idem + E2E |
| Registre financier | Journal append-only équilibré (trigger en base), balance, réconciliation créances ↔ factures | idem |
| Front | Coque du design, login, prospects, clients, audit ; BFF avec cookie httpOnly ; clair/sombre ; mobile | `apps/web/e2e` |

## Ce qui n'existe pas encore
Signature électronique qualifiée, acquisition automatique des congés, dépôt de justificatifs/OCR, facturation électronique (PDF, plateforme agréée), banque et recouvrement, **paie et DSN**, compte d'activité, RH, conformité (règles légales à saisir depuis des sources officielles), comptabilité, pilotage, portails consultant/client/partenaires, administration SaaS, planificateur LLM, RAG et évaluations des agents, portails partenaire, MFA/SSO, invitations, workers durables, webhooks. Chaque ligne figure dans la [matrice d'implémentation](docs/IMPLEMENTATION_MATRIX.md) avec son statut.

## Architecture
```
Navigateur ──► Vercel (Next.js : UI + BFF /api/session, /api/proxy) ──► Railway : API NestJS ──► PostgreSQL (RLS)
                    cookie httpOnly, liste blanche de routes, contrôle d'Origin    rôle portage_app, audit append-only
```
Monorepo pnpm : `apps/api`, `apps/web`, `packages/domain` (règles pures), `packages/design-system`. Détail : [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), décisions : [docs/adr](docs/adr).

## Sécurité
Tenant imposé côté serveur, jamais le rôle du front. Aucun secret dans le dépôt. Limites connues (pas de MFA, pas de refresh de token, `User`/`Membership` hors RLS, limiteur en mémoire) : [docs/SECURITY.md](docs/SECURITY.md).

## Qualité et tests
```bash
pnpm test                                   # domaine + API (Postgres requis)
pnpm -F @portage/web test:e2e               # Playwright, ports dédiés 4310/4311
```
La CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)) exécute typecheck, build, tests, seed démo et E2E sur une base PostgreSQL jetable. Plan : [docs/TEST_PLAN.md](docs/TEST_PLAN.md).

## Démarrer en local
Prérequis : Node 22+, pnpm 10, Docker.
```bash
cp .env.example .env              # renseigner des valeurs LOCALES (aucun secret réel)
docker compose up -d postgres
pnpm install
pnpm migrate                      # migrations (propriétaire)
APP_DB_PASSWORD=... ./scripts/db-roles.sh   # active le rôle applicatif portage_app
DEMO_PASSWORD=... pnpm seed       # tenant « demo » fictif (refusé si APP_ENV=production)
pnpm -F @portage/domain build && pnpm -F @portage/api build
node apps/api/dist/main.js        # API :3001 (JWT_SECRET, APP_DATABASE_URL requis)
pnpm -F @portage/web dev          # web :3000
```

## Déploiement
Railway (API + PostgreSQL) et Vercel (web) : procédure, variables et vérifications dans [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). Alternative européenne documentée dans le même fichier.

## Structure du dépôt
```text
apps/api              API NestJS (auth, tenant, RBAC, audit, prospects, clients) + Prisma
apps/web              Next.js (UI, BFF), tests E2E Playwright
packages/domain       Règles métier pures et testées
packages/design-system  Tokens et CSS importés de Claude Design + sources des artboards
docs/                 Architecture, ADR, sécurité, déploiement, matrice, statut, captures
.github/              CI, modèles de PR/issues, CODEOWNERS, Dependabot
```

## Documentation
[STATUS](docs/STATUS.md) · [IMPLEMENTATION_MATRIX](docs/IMPLEMENTATION_MATRIX.md) · [PRODUCT_SCOPE](docs/PRODUCT_SCOPE.md) · [ARCHITECTURE](docs/ARCHITECTURE.md) · [DOMAIN_RULES](docs/DOMAIN_RULES.md) · [DESIGN_HANDOFF](docs/DESIGN_HANDOFF.md) · [INTEGRATIONS](docs/INTEGRATIONS.md) · [SECURITY](docs/SECURITY.md) · [TEST_PLAN](docs/TEST_PLAN.md) · [DEPLOYMENT](docs/DEPLOYMENT.md) · [OPERATIONS](docs/OPERATIONS.md) · [ENGINEERING](docs/ENGINEERING.md) · [DECISIONS](docs/DECISIONS.md)

> Aucune licence n'est accordée : tous droits réservés tant qu'aucune licence n'est ajoutée.
