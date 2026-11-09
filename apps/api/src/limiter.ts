import { HttpException } from "@nestjs/common";

/** Limiteur d'ÉCHECS en mémoire (mono-instance) : `max` échecs par fenêtre, remis à zéro après un succès. À remplacer par Redis en multi-instance. */
const buckets = new Map<string, { n: number; reset: number }>();
export function resetLimiters() { buckets.clear(); }
export function checkLimit(key: string, max = 5) { const a = buckets.get(key); if (a && a.reset > Date.now() && a.n >= max) throw new HttpException("Trop de tentatives, réessayez dans une minute", 429); }
export function recordFailure(key: string, windowMs = 60_000) { const now = Date.now(); const a = buckets.get(key); if (!a || a.reset < now) buckets.set(key, { n: 1, reset: now + windowMs }); else a.n++; }
export function clearLimit(key: string) { buckets.delete(key); }
