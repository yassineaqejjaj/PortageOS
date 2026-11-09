# Handoff design — état réel (2026-11-08)

## Ce qui a été lu
Artifact Claude Design « PORTAGE OS — Produit & Design System 2027 » (type Design, 41 fichiers, v. 1794164424-31ab), lu via l'outil Artifact : `canvas.json`, `portage.css`, et le code source des 17 artboards `.dc.html`. Les artboards n'ont **pas** été rendus visuellement (pas de capture comparée) ; ce sont leurs sources qui ont été lues. Aucun `tokens.json`/`HANDOFF.md` séparé n'est présent dans l'artifact (cités par `Handoff.dc.html` mais non fournis) : les tokens sont ceux de `portage.css`.
Copie locale : `packages/design-system/reference/` (sources + canvas.json) ; `packages/design-system/src/portage.css` (copie fidèle des tokens et classes).

## Artboards (canvas)
Plan : Main (plan/sitemap), Handoff (matrice + mapping écran→API). DS : Foundations, Components, AI, nav/Sidebar, nav/Topbar. Back-office : Operations Center, Agent Workspace, Facturation, Paie. Consultant : Accueil, Compte d'activité, Mobile 390. Client : CRA à valider, Mobile 390. Parcours 3 : CRA → facture → paiement → rapprochement.
Non conçus (sitemap « spécifié » ou « lot suivant ») : auth/MFA/reset/invitation, CRM, consultants 360, contrats, missions, frais, trésorerie, RH, conformité, compta, pilotage, support, config, partenaires, SaaS.

## Règles de design retenues (à respecter)
Tokens sémantiques uniquement (jamais d'hex dans les composants) ; statut = forme + libellé + couleur ; focus 2 px ; vouvoiement, verbes d'action ; montants `Intl fr-FR` EUR, dates JJ/MM/AAAA ; blocage d'abord (Operations Center) ; IA : « préparé par / suggestion / estimation », validation humaine avant toute action sensible ; aucune donnée salariale dans les payloads du portail client ; seuils légaux depuis le moteur de règles avec version affichée. Typo : Plus Jakarta Sans / Inter / JetBrains Mono (OFL), auto-hébergées. Breakpoints : ≤599 mobile, 600–1279 tablette (sidebar 72), ≥1280 desktop (sidebar 248, drawer 480).

## Implémenté dans apps/web
- Tokens + composants CSS importés tels quels (`@portage/design-system/portage.css`), thème sombre via `data-theme` selon la préférence système, polices auto-hébergées via `next/font` (aucun appel à Google au runtime).
- Coque : Sidebar et Topbar (société) reprises du design ; skip-link ; navigation limitée aux routes réelles et filtrée par permission (confort UI, l'API fait foi).
- **Refonte du menu (séance 18)** d'après l'artboard nav/Sidebar : un menu par portail (pastille Gestion / Consultant / Client, déduit des rôles), groupes **Pilotage / Relation / Opérations / Gouvernance**, libellés et icônes du design (Pilotage, Agents IA, Clients, Consultants, Contrats, Missions, Activité / CRA, Notes de frais, Facturation, Trésorerie, Comptes d'activité, Conformité, Comptabilité, Support, Configuration). Les modules multi-écrans sont des **sous-menus repliables** (CRM : 6 écrans ; Trésorerie : rapprochement + registre ; Configuration : membres + audit ; portail consultant : CRA et absences) avec `aria-expanded`, ouverts d'office quand la page courante s'y trouve ; **une seule entrée « page courante »** (la plus spécifique) ; utilisateur en pied (adresse, libellé de rôle, Sécurité du compte) ; bouton **« / »** de réduction à 72 px (token `--layout-sidebar-collapsed`, état mémorisé, noms accessibles conservés) ; **tiroir sous 900 px** (bouton Menu, Échap, fermeture après navigation). Tests : `e2e/navigation.spec.ts`.
- Écrans : Connexion (AuthCard, **non conçu** : spec seulement, reproduit selon les composants du DS), Clients et Journal d'audit (**non conçus** : composés avec les composants du DS, pas de fidélité d'artboard possible).
- Vérifié à la main : light, dark (1440) et mobile 375 ; pas de comparaison pixel avec les artboards.

## Écarts / à traiter
- **Écarts menu** : entrées du design **sans écran réel, donc absentes** (Operations Center, CRM « consultants/entreprises » séparés, Paie, RH, Simulateur de salaire, Factures liées, Litiges, Bons de commande client) ; « Conformité » mène aux paramètres réglementaires (seul écran de conformité existant) ; **pastilles de comptage** du design (7, 5, 3…) non implémentées faute de source de données fiable ; barre de navigation basse mobile des portails remplacée par le tiroir ; réduction automatique sur tablette non faite (réduction manuelle seulement).
- Non implémentés (hors menu) : TenantSwitcher, PeriodPicker, CommandPalette ⌘K, notifications : **non implémentés** (la Topbar ne montre que ce qui est fonctionnel). Le back-office sur mobile n'est pas prévu par le design (portails seulement) : la sidebar s'empile simplement.
- Les artboards conçus (Operations Center, Agents, Facturation, Paie, portails consultant/client, parcours 3) nécessitent leurs modules backend avant implémentation : aucune UI branchée sur des données fictives ne sera ajoutée à l'app réelle.
- Contraste du mode sombre non mesuré ; comparaison visuelle Playwright à mettre en place.
- Contradiction notée : le design prévoit un client « sans donnée salariale » ; l'API portail client devra l'imposer côté serveur (DTO dédiés), pas seulement masquer côté UI.
