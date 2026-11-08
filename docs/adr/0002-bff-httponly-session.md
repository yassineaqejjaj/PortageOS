# ADR 0002 — BFF Next.js et session en cookie httpOnly

Statut : accepté (2026-11-08)

## Décision
Le navigateur ne parle qu'au BFF (`/api/session`, `/api/proxy/*`) qui stocke le JWT en cookie httpOnly SameSite=Lax, applique une liste blanche de routes et vérifie `Origin` sur les écritures.

## Conséquences
Le jeton n'est jamais lisible par JavaScript (XSS), CSRF réduit. Coût : un saut réseau de plus; expiration 15 min sans refresh (à traiter).
