# ADR 0004 — Règles métier dans un package pur testé

Statut : accepté (2026-11-08)

## Décision
`packages/domain` (Decimal, paramètres datés, journal, machines d'état) sans I/O, compilé en CommonJS pour l'API.

## Conséquences
Règles testables sans base et partageables. Aucune constante légale en dur : `ParameterCatalog` daté/sourcé/approuvé.
