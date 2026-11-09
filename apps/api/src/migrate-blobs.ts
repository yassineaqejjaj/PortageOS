/**
 * Migre les contenus de documents stockés en base (DocumentBlob) vers le stockage objet.
 * Pour chaque document : lecture, vérification de l'empreinte, dépôt, RELECTURE et comparaison, puis seulement suppression du blob.
 * Usage : STORAGE_DRIVER=s3 S3_BUCKET=... DATABASE_URL=<propriétaire> node dist/migrate-blobs.js [--dry-run]
 */
import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { objectStore } from "./object-store";

async function main() {
  const store = objectStore(); if (!store) throw new Error("STORAGE_DRIVER doit être s3 pour migrer");
  const dry = process.argv.includes("--dry-run"); const db = new PrismaClient();
  let moved = 0, failed = 0;
  try {
    for (;;) {
      const docs = await db.document.findMany({ where: { storageDriver: "db", purgedAt: null, blob: { isNot: null } }, include: { blob: true }, take: 50 });
      if (!docs.length) break;
      const before = moved;
      for (const d of docs) {
        const data = Buffer.from(d.blob!.data); const key = `${d.tenantId}/${d.id}`;
        try {
          if (createHash("sha256").update(data).digest("hex") !== d.sha256) throw new Error("empreinte source invalide");
          if (!dry) {
            await store.put(key, data, d.mime);
            if (!(await store.get(key)).equals(data)) throw new Error("relecture différente");
            await db.$transaction([db.document.update({ where: { id: d.id }, data: { storageDriver: "s3", storageKey: key } }), db.documentBlob.delete({ where: { documentId: d.id } })]);
          }
          moved++;
        } catch (e) { failed++; console.error(`document ${d.id} non migré : ${(e as Error).message}`); }
      }
      if (dry || moved === before) break; // simulation, ou aucun progrès (documents en échec : pas de boucle infinie)
    }
    console.log(`${dry ? "(simulation) " : ""}${moved} document(s) migré(s), ${failed} échec(s).`);
    if (failed) process.exitCode = 1;
  } finally { await db.$disconnect(); }
}
main().catch(e => { console.error(e.message); process.exit(1); });
