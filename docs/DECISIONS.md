# Décisions
- D-001 (2026-11-08) Démarrage sans design : tokens appliqués plus tard ; aucune UI finalisée avant import.
- D-002 pnpm workspaces, TypeScript strict, vitest.
- D-003 Décimales via decimal.js ; TVA arrondie par ligne (à valider).
- D-004 Hébergement : Vercel/Railway par défaut ; alternative UE (ex. Scaleway/OVH) à documenter avant données réelles RH/paie.
- D-005 Git local sur `main`, pas de remote.
- D-006 (2026-11-08) Design importé depuis l'artifact Claude Design (portage.css). Navigation limitée aux routes réelles ; pas d'écran du design branché sur des données fictives. Polices via next/font (RGPD).
- D-007 (2026-11-09) Polices auto-hébergées via @fontsource (et non next/font/google) : `next/font/google` télécharge les polices pendant le build et a fait échouer des builds (CI et Vercel) de façon intermittente ; fontsource est déterministe, hors ligne et sans appel à Google.
- D-008 (2026-11-09) CRM : le scoring est un barème **transparent** (points justifiés, pondérations par société, bornes 0-100), jamais un modèle opaque ni une décision automatisée ; la règle d'une commission est **figée** à la création du parrainage (trigger) et un montant payé ne change plus ; une commission est approuvée par une autre personne que celle qui l'a générée ; la simulation commerciale n'utilise qu'un taux de frais approuvé ou saisi comme hypothèse et ne calcule ni cotisations ni net salarié ; un accord-cadre actif plafonne le TJM des missions rattachées. Les commissions sont comptabilisées 622/512 sans prétention fiscale (à valider par l'expert-comptable).
- D-009 (2026-11-09) Clients : le délai de paiement est une donnée convenue, jamais une règle légale appliquée ; la consommation d'un bon de commande est calculée (jamais saisie) à partir des factures émises et son dépassement est signalé sans bloquer la facturation (décision métier à confirmer) ; la somme de contrôle du SIREN est un avertissement car Sirene n'est pas connecté.
