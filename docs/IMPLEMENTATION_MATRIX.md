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
| Auth/tenant/RBAC/audit | ⬜ | ⬜ | – | ⬜ | ⬜ |
| Design System / tokens | – | ⬜ | Claude Design non lu | ⬜ | ⬜ bloqué: lien manquant |
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
Prochaines étapes Lot 0 : Prisma + schéma tenant/identités + migrations, `apps/api` NestJS (auth, tenant guard, audit), `apps/web` Next.js, Playwright, import design (dès lien fourni).
