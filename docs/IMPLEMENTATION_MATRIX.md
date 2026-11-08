# Matrice d'implémentation (état au 2026-11-08, fin de séance 1)
Légende : ✅ terminé · 🟡 partiel · ⬜ non démarré · 🔒 bloqué intégration externe.
Aucun module n'est ✅ de bout en bout (UI+API+DB+droits+audit+tests+doc).

| Module | Backend | UI | Intégration | Tests | Statut / preuve |
|---|---|---|---|---|---|
| Fondations : Money, TVA ligne | `packages/domain/src/money.ts` | – | – | domain.test.ts | 🟡 primitive testée |
| Paramètres réglementaires datés | `parameters.ts` | ⬜ | – | domain.test.ts | 🟡 moteur seul, aucune valeur légale saisie, pas d'UI de revue |
| Journal financier append-only | `ledger.ts` (mémoire) | ⬜ | – | domain.test.ts | 🟡 pas de persistance DB |
| Numérotation factures | `numbering.ts` (mémoire) | – | – | domain.test.ts | 🟡 version DB transactionnelle et test de concurrence à faire |
| Machine d'état générique | `state-machine.ts` | – | – | domain.test.ts | 🟡 les 12 workflows ne sont pas définis |
| Monorepo, CI, docker-compose, .env.example | racine | – | – | CI non exécutée | 🟡 compose non lancé |
| Auth/tenant/RBAC/audit | `apps/api/src/*` (login JWT HS256 15 min, AuthGuard rechargeant Membership, RBAC par rôle, RLS Postgres `Company`/`AuditEvent`, audit append-only par trigger, limiteur de login mémoire) | `apps/web`: login, coque, journal d'audit; BFF avec cookie httpOnly | – | `apps/api/test/tenant-isolation.test.ts` (14 tests, base réelle; mutation RLS off → 3 échecs) | 🟡 socle seulement: pas de MFA/SSO, pas d'invitation email, pas de refresh/rotation de tokens, pas de RLS sur Membership, pas d'UI, rôles non personnalisables, pas de journal d'accès |
| Clients (entité Company minimale) | create/get/list/patch, SIREN 9 chiffres | `apps/web/src/app/(app)/companies` (liste, création, états chargement/vide/403/erreur) | Sirene ⬜ | inclus ci-dessus | 🟡 pas de sites/contacts/risque, pas de validation Luhn/Sirene |
| Design System / tokens | – | `apps/web/src/app/tokens.css` = tokens PROVISOIRES (thèmes light/dark), pas issus de Claude Design | Claude Design non lu | ⬜ | ⬜ bloqué: lien manquant |
| A CRM | ⬜ | ⬜ | – | ⬜ | ⬜ |
| B Onboarding consultants | ⬜ | ⬜ | DPAE, OCR | ⬜ | ⬜ |
| C Clients | ⬜ | ⬜ | Sirene | ⬜ | ⬜ |
| D Contrats/juridique | ⬜ | ⬜ | Signature | ⬜ | ⬜ |
| E Missions | ⬜ | ⬜ | – | ⬜ | ⬜ |
| F CRA/temps/absences | ⬜ | ⬜ | – | ⬜ | ⬜ |
| G Notes de frais | ⬜ | ⬜ | OCR | ⬜ | ⬜ |
| H Facturation électronique | ⬜ | ⬜ | PA agréée 🔒 | ⬜ | ⬜ |
| I Banque/recouvrement | ⬜ | ⬜ | Banque 🔒 | ⬜ | ⬜ |
| J Paie & DSN | ⬜ | ⬜ | Prestataire paie 🔒 | ⬜ | ⬜ (traitement réel = non connecté) |
| K Compte d'activité/simulateur | ⬜ | ⬜ | – | ⬜ | ⬜ |
| L RH | ⬜ | ⬜ | – | ⬜ | ⬜ |
| M Conformité | ⬜ | ⬜ | – | ⬜ | ⬜ règles légales à saisir depuis sources officielles |
| N Comptabilité | ⬜ | ⬜ | Export compta | ⬜ | ⬜ |
| O Pilotage | ⬜ | ⬜ | – | ⬜ | ⬜ |
| P Support & portails (consultant/client/partenaire) | ⬜ | ⬜ | Email | ⬜ | ⬜ |
| Q Admin SaaS/abonnements | ⬜ | ⬜ | Paiement SaaS | ⬜ | ⬜ |
| IA : 6 agents + orchestrateur, RAG, éval | ⬜ | ⬜ | Providers IA | ⬜ | ⬜ |
| Workflows 1–12 | ⬜ | ⬜ | – | ⬜ | ⬜ |
| Webhooks/outbox/imports/exports/recherche | ⬜ | ⬜ | – | ⬜ | ⬜ |
| Validation juridique/métier/paie | – | – | – | – | ⬜ aucune effectuée |

## Reprise
Fait séance 2 : Prisma + migration init, `apps/api` (auth, garde tenant, RBAC, audit), tests d'intégration.
Fait séance 3 : `apps/web` Next.js 15 (BFF, login, clients, audit), vérifié manuellement dans le navigateur intégré (login, validation, création, audit) ; build OK.
Prochaines étapes Lot 0 : Playwright (aucun test E2E automatisé à ce jour), tests composants, OpenAPI, MFA/invitations, rotation de tokens, outbox/idempotence API, logs structurés, import design (dès lien fourni). Puis Lot 1.
