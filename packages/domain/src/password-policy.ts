const COMMON = ["password", "motdepasse", "azerty", "qwerty", "123456", "111111", "letmein", "welcome", "portage", "admin", "iloveyou", "changeme"];

/** Politique de mot de passe : longueur d'abord (>= 12), pas d'information évidente, pas de motif trivial. Retourne la liste des problèmes (vide = accepté). */
export function checkPassword(pw: string, ctx: { email?: string } = {}): string[] {
  const issues: string[] = [];
  if (pw.length < 12) issues.push("12 caractères minimum");
  if (pw.length > 200) issues.push("200 caractères maximum");
  const lower = pw.toLowerCase();
  const local = ctx.email?.split("@")[0]?.toLowerCase();
  if (local && local.length >= 4 && lower.includes(local)) issues.push("ne doit pas contenir votre identifiant email");
  if (COMMON.some(c => lower.includes(c))) issues.push("contient un mot ou une suite trop courants");
  if (/^(.)\1+$/.test(pw)) issues.push("caractère répété");
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter(r => r.test(pw)).length;
  if (pw.length < 16 && classes < 3) issues.push("mélangez au moins 3 types de caractères (ou allongez à 16)");
  return issues;
}
