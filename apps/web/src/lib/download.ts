/** Télécharge un export servi par le proxy (le jeton reste dans un cookie httpOnly). */
export async function download(path: string, filename: string): Promise<string | null> {
  const r = await fetch(`/api/proxy/${path}`);
  if (!r.ok) return ((await r.json().catch(() => null))?.error?.message as string | undefined) ?? "Export impossible";
  const cd = r.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ?? filename;
  const url = URL.createObjectURL(await r.blob()); const a = document.createElement("a"); a.href = url; a.download = cd; a.click(); URL.revokeObjectURL(url);
  return null;
}
