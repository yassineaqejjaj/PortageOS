export function loadConfig(env = process.env) {
  const jwtSecret = env.JWT_SECRET ?? "";
  if (jwtSecret.length < 32) throw new Error("JWT_SECRET (>= 32 caractères) requis");
  const appDb = env.APP_DATABASE_URL;
  if (!appDb) throw new Error("APP_DATABASE_URL requis (rôle portage_app, soumis au RLS)");
  return { jwtSecret, appDb, tokenTtlSeconds: 900, port: Number(env.PORT ?? 3001) };
}
export type AppConfig = ReturnType<typeof loadConfig>;
