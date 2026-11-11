# Intégrations
Toutes **non connectées** (aucun credential). Chaque adapter : config chiffrée, health, sandbox, retries, idempotence, signature webhook, tests contractuels.
| Domaine | Fournisseur | Statut |
|---|---|---|
| Paie/DSN | à choisir (ex. Silae si droits) | non démarré |
| Facturation électronique (PA) | à choisir | non démarré |
| Signature électronique | à choisir | non démarré |
| Banque | open banking / imports | non démarré |
| Comptabilité | exports | non démarré |
| Sirene | API INSEE | non démarré |
| Email | transactionnel | non démarré |
| Paiement SaaS | à choisir | non démarré |
Faux fournisseurs : local uniquement.

## WhatsApp (Meta WhatsApp Cloud API) — non connecté
Adaptateur `whatsapp.provider.ts` (Graph API) prêt, **jamais appelé contre le vrai service** : requêtes vérifiées seulement avec un fetch factice. Prérequis et variables : docs/BLOCKERS.md, docs/DEPLOYMENT.md. Le statut « vérifié » n'est posé qu'après un appel réel réussi (`POST /whatsapp/channel/verify`).
