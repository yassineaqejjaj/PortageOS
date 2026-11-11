import { requestLogger } from "./observability";
import { NestExpressApplication } from "@nestjs/platform-express";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { loadConfig } from "./config";
import { ErrorFilter } from "./error.filter";

export async function createApp() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ["error", "warn"], rawBody: true });
  app.useBodyParser("json", { limit: "1.5mb" }); // imports CSV : 1 Mo de fichier + enveloppe JSON
  app.use(requestLogger);
  app.useGlobalFilters(new ErrorFilter());
  return app;
}
if (require.main === module) {
  createApp().then(a => a.listen(loadConfig().port));
}
