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
import { ParametersService } from "./parameters.service";
import { RulesController } from "./rules.controller";
import { ExpensesController } from "./expenses.controller";
import { AccountsController } from "./accounts.controller";
import { ContractsController } from "./contracts.controller";
import { LeavesController } from "./leaves.controller";
import { LeavesService } from "./leaves.service";
import { InvoicesService } from "./invoices.service";
import { AgentsController } from "./agents.controller";
import { AgentsService } from "./agents.service";
import { NotificationsController } from "./notifications.controller";
import { NotificationsService } from "./notifications.service";
import { SupportController } from "./support.controller";
import { PilotageController } from "./pilotage.controller";
import { PilotageService } from "./pilotage.service";
import { PrismaService } from "./prisma.service";

@Module({
  controllers: [AuthController, CompaniesController, MembersController, ProspectsController, ConsultantsController, MissionsController, TimesheetsController, SelfPortalController, ClientPortalController, InvoicesController, LedgerController, RulesController, ExpensesController, AccountsController, ContractsController, LeavesController, AgentsController, NotificationsController, SupportController, PilotageController],
  providers: [PrismaService, AuditService, ConsultantsService, TimesheetsService, LedgerService, ParametersService, LeavesService, InvoicesService, AgentsService, NotificationsService, PilotageService, { provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
