import net from "node:net";

export type ScanResult = { status: "clean" | "not_scanned"; engine?: string } | { status: "infected"; engine: string; signature: string };
export class ScanUnavailable extends Error {}

/** Analyse via un démon ClamAV (protocole INSTREAM) si CLAMAV_HOST est défini ; sinon « non analysé » (déclaré tel quel, jamais présenté comme sain). Échec du démon = échec de l'envoi (fail-closed). */
export function scanBuffer(buf: Buffer): Promise<ScanResult> {
  const host = process.env.CLAMAV_HOST; if (!host) return Promise.resolve({ status: "not_scanned" });
  const port = Number(process.env.CLAMAV_PORT ?? 3310);
  return new Promise((resolve, reject) => {
    const s = net.connect({ host, port }); let resp = ""; s.setTimeout(15_000);
    s.on("connect", () => {
      s.write("zINSTREAM\0");
      for (let i = 0; i < buf.length; i += 65536) { const c = buf.subarray(i, i + 65536); const len = Buffer.alloc(4); len.writeUInt32BE(c.length); s.write(len); s.write(c); }
      s.write(Buffer.alloc(4));
    });
    s.on("data", d => { resp += d.toString("utf8"); });
    s.on("end", () => {
      const t = resp.replace(/\0/g, "").trim();
      if (/\bOK$/.test(t)) return resolve({ status: "clean", engine: "clamav" });
      const m = t.match(/^stream:\s*(.+?)\s+FOUND$/); if (m) return resolve({ status: "infected", engine: "clamav", signature: m[1]! });
      reject(new ScanUnavailable(`Réponse inattendue du démon : ${t.slice(0, 80)}`));
    });
    s.on("timeout", () => { s.destroy(); reject(new ScanUnavailable("Délai dépassé")); });
    s.on("error", e => reject(new ScanUnavailable(e.message)));
  });
}
