import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { loadConfig } from "./config";
import { ErrorFilter } from "./error.filter";

export async function createApp() {
  const app = await NestFactory.create(AppModule, { logger: ["error", "warn"] });
  app.useGlobalFilters(new ErrorFilter());
  return app;
}
if (require.main === module) {
  createApp().then(a => a.listen(loadConfig().port));
}
