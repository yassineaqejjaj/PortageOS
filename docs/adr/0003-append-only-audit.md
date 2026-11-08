# ADR 0003 — Audit append-only par triggers

Statut : accepté (2026-11-08)

## Décision
`AuditEvent` refuse UPDATE/DELETE/TRUNCATE par trigger, y compris pour le propriétaire de la base.

## Conséquences
Piste d'audit non modifiable côté base. Limite : un superutilisateur peut encore désactiver le trigger : la rétention/export externe reste à prévoir.
