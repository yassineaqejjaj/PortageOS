# Ce qui ne peut PAS être « terminé » par du code seul

Mis à jour le 2026-11-08. Chaque ligne est un prérequis **externe** : compte, contrat, clé, homologation ou validation par un professionnel habilité. Tant qu'il n'est pas levé, le module concerné reste « partiel » ou « non connecté » dans [IMPLEMENTATION_MATRIX.md](IMPLEMENTATION_MATRIX.md), quel que soit le volume de code écrit.

| Domaine | Ce qui manque | Qui peut le lever | Ce que le code fournit déjà |
|---|---|---|---|
| Paie et DSN (module J) | Contrat et accès API d'un prestataire de paie/DSN (ex. Silae), recette par un spécialiste paie sur des cas réels | Vous / votre prestataire paie | Compte d'activité estimatif, paramètres datés, agents Payroll déclarés indisponibles. **Aucune formule de paie n'est (ni ne sera) inventée.** |
| Facturation électronique | Immatriculation / contrat avec une plateforme agréée (PA), annuaire, e-reporting | Vous / la PA choisie | Factures numérotées, `einvoiceStatus = not_connected` |
| Signature électronique qualifiée | Contrat avec un prestataire de confiance | Vous | Déclaration de signature interne tracée (non qualifiée) |
| Banque | Agrégateur/open banking agréé ou import de relevés fournis | Vous | Encaissements saisis à la main |
| E-mail | Fournisseur transactionnel + domaine (SPF/DKIM) ; variables `SMTP_URL`, `MAIL_FROM`, `WEB_BASE_URL` | Vous | Notifications in-app ; **adaptateur SMTP et mot de passe oublié prêts, jamais testés contre un vrai serveur** |
| WhatsApp | Compte Meta Business vérifié, numéro WhatsApp Business, application Meta (secret + jeton de vérification du webhook), jeton d'accès système, **modèles de messages approuvés par Meta**, URL publique HTTPS du webhook (`/webhooks/whatsapp`), base juridique et information des personnes (RGPD) | Vous | Canal, consentement, boîte de réception, webhook signé, relance de CRA ; **requêtes Graph API jamais testées contre le vrai service** (fetch factice) |
| Modèle de langage | Clé fournisseur LLM, analyse d'impact RGPD, validation juridique | Vous | Agents à playbooks déterministes, approbations humaines |
| Sirene / identifiants entreprises | Jeton API INSEE | Vous | Saisie manuelle du SIREN (9 chiffres) |
| Abonnement SaaS | Compte du fournisseur de paiement (webhooks vérifiés) | Vous | — |
| Règles légales (portage salarial, IDCC 3219, minima, cotisations) | **Saisie depuis les sources officielles et approbation par un juriste/paie** | Un professionnel habilité | Catalogue de paramètres datés, sourcés, approuvés à quatre yeux ; **aucune valeur légale livrée** |
| Stockage objet et antivirus | Un stockage S3-compatible (bucket) et un démon ClamAV (service dédié) | Vous | Contenu en PostgreSQL (≤ 10 Mo) par défaut ; adaptateur S3 prêt (`STORAGE_DRIVER=s3`, `S3_BUCKET`, `S3_ENDPOINT`…, **jamais testé contre un vrai bucket**) ; adaptateur ClamAV fail-closed prêt (`CLAMAV_HOST`) ; **aucune analyse antivirus réelle n'est active en production** |
| Hébergement | Hébergement UE contractualisé, DPA, sauvegardes testées | Vous | Dockerfile portable, config Railway/Vercel de test |
| Validation juridique et métier | Revue par juristes, DPO, expert-comptable, spécialiste paie | Eux | Documentation des règles et des limites |
| Sécurité | Test d'intrusion externe, analyse d'impact RGPD | Prestataire / DPO | Tests d'isolation, RLS, audit append-only |

**Conséquence honnête** : même avec tout le code possible, le produit ne pourra pas être déclaré « terminé », conforme ou prêt pour une paie réelle sans ces éléments. Le code avance sur tout ce qui ne dépend pas d'eux.
