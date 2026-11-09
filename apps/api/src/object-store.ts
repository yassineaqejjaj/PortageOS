import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

/** Port de stockage objet. Le pilote `db` (contenu dans PostgreSQL) reste le défaut ; `s3` cible tout service compatible S3 (hébergeur UE). */
export interface ObjectStore {
  readonly driver: "s3" | "memory";
  put(key: string, data: Buffer, mime: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

class S3Store implements ObjectStore {
  readonly driver = "s3" as const;
  private c: S3Client; private bucket: string;
  constructor(env: NodeJS.ProcessEnv) {
    this.bucket = env.S3_BUCKET!;
    this.c = new S3Client({ region: env.S3_REGION ?? "eu-west-3", endpoint: env.S3_ENDPOINT || undefined, forcePathStyle: env.S3_FORCE_PATH_STYLE === "1",
      credentials: env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY ? { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY } : undefined });
  }
  async put(key: string, data: Buffer, mime: string) { await this.c.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data, ContentType: mime, ServerSideEncryption: "AES256" })); }
  async get(key: string) { const r = await this.c.send(new GetObjectCommand({ Bucket: this.bucket, Key: key })); return Buffer.from(await r.Body!.transformToByteArray()); }
  async delete(key: string) { await this.c.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key })); }
}

/** Pilote mémoire : TESTS uniquement (refusé en production). */
export class MemoryStore implements ObjectStore {
  readonly driver = "memory" as const; readonly objects = new Map<string, Buffer>();
  async put(key: string, data: Buffer) { this.objects.set(key, Buffer.from(data)); }
  async get(key: string) { const o = this.objects.get(key); if (!o) throw new Error("objet introuvable"); return Buffer.from(o); }
  async delete(key: string) { this.objects.delete(key); }
}

let memory: MemoryStore | null = null;
export const testMemoryStore = () => (memory ??= new MemoryStore());
export function resetObjectStoreForTests() { memory = null; }
/** null = stockage en base (défaut). Configuration incohérente => erreur au démarrage de l'envoi plutôt qu'un repli silencieux. */
export function objectStore(env = process.env): ObjectStore | null {
  const d = env.STORAGE_DRIVER ?? "db";
  if (d === "db") return null;
  if (d === "memory") { if (env.NODE_ENV === "production" || env.APP_ENV === "production") throw new Error("STORAGE_DRIVER=memory interdit en production"); return testMemoryStore(); }
  if (d === "s3") { if (!env.S3_BUCKET) throw new Error("S3_BUCKET requis pour STORAGE_DRIVER=s3"); return (s3 ??= new S3Store(env)); }
  throw new Error(`STORAGE_DRIVER inconnu : ${d}`);
}
let s3: S3Store | null = null;
