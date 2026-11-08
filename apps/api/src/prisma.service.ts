import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";
import { loadConfig } from "./config";

export type Tx = Prisma.TransactionClient;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor() {
    super({ datasources: { db: { url: loadConfig().appDb } } });
  }
  /** Exécute `fn` dans une transaction où le RLS est lié au tenant (imposé côté serveur). */
  forTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.$transaction(async tx => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return fn(tx);
    });
  }
  async onModuleDestroy() { await this.$disconnect(); }
}
