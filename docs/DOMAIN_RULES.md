# Règles métier
Implémentées et testées (`packages/domain`) :
- Money exact Decimal ; TVA arrondie **par ligne** puis sommée (règle à valider par expert-comptable).
- Paramètres réglementaires datés/sourcés/approuvés, sans chevauchement ; lecture lève si absent.
- Journal append-only, équilibré, idempotent, contrepassation unique, isolation tenant.
- Numérotation factures sans trou par tenant/série/année (référence mémoire ; version DB transactionnelle à faire).
- Machine d'état générique (rôle, précondition, audit).
À faire : toutes les règles du portage (L1254-x, IDCC 3219) — **à saisir uniquement depuis les sources officielles et validation humaine**, jamais depuis un LLM. Statut : aucune règle légale encore saisie.
