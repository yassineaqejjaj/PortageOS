import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AuthController } from "./auth.controller";
import { AuthGuard } from "./auth.guard";
import { AuditService } from "./audit.service";
import { CompaniesController } from "./companies.controller";
import { MembersController } from "./members.controller";
import { ProspectsController } from "./prospects.controller";
import { ConsultantsController } from "./consultants.controller";
import { ConsultantsService } from "./consultants.service";
import { MissionsController } from "./missions.controller";
import { ClientPortalController, SelfPortalController, TimesheetsController } from "./timesheets.controller";
import { TimesheetsService } from "./timesheets.service";
import { InvoicesController, LedgerController } from "./invoices.controller";
import { LedgerService } from "./ledger.service";
import { PrismaService } from "./prisma.service";

@Module({
  controllers: [AuthController, CompaniesController, MembersController, ProspectsController, ConsultantsController, MissionsController, TimesheetsController, SelfPortalController, ClientPortalController, InvoicesController, LedgerController],
  providers: [PrismaService, AuditService, ConsultantsService, TimesheetsService, LedgerService, { provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
