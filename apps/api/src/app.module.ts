import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AuthController } from "./auth.controller";
import { AuthGuard } from "./auth.guard";
import { AuditService } from "./audit.service";
import { CompaniesController } from "./companies.controller";
import { MembersController } from "./members.controller";
import { ProspectsController } from "./prospects.controller";
import { PrismaService } from "./prisma.service";

@Module({
  controllers: [AuthController, CompaniesController, MembersController, ProspectsController],
  providers: [PrismaService, AuditService, { provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
