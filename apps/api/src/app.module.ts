import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AuthController } from "./auth.controller";
import { OperatorController } from "./operator.controller";
import { WhatsappController, WhatsappWebhookController } from "./whatsapp.controller";
import { WhatsappService } from "./whatsapp.service";
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
import { AuthService } from "./auth.service";
import { AccountingController } from "./accounting.controller";
import { AccountingService } from "./accounting.service";
import { DocumentsController } from "./documents.controller";
import { DocumentsService } from "./documents.service";
import { TenantProfileController } from "./tenant-profile.controller";
import { BankController } from "./bank.controller";
import { PaymentsService } from "./payments.service";
import { MailService } from "./mail.service";
import { CrmController } from "./crm.controller";
import { CompanyDetailsController } from "./company-details.controller";
import { CrmService } from "./crm.service";
import { SalarySimulationsController } from "./salary-simulations.controller";
import { PrismaService } from "./prisma.service";

@Module({
  controllers: [SalarySimulationsController, AuthController, CompaniesController, MembersController, ProspectsController, ConsultantsController, MissionsController, TimesheetsController, SelfPortalController, ClientPortalController, InvoicesController, LedgerController, RulesController, ExpensesController, AccountsController, ContractsController, LeavesController, AgentsController, NotificationsController, SupportController, PilotageController, AccountingController, DocumentsController, CrmController, CompanyDetailsController, BankController, TenantProfileController, OperatorController, WhatsappController, WhatsappWebhookController],
  providers: [PrismaService, AuditService, WhatsappService, MailService, PaymentsService, ConsultantsService, TimesheetsService, LedgerService, ParametersService, LeavesService, InvoicesService, AgentsService, NotificationsService, PilotageService, AuthService, AccountingService, DocumentsService, CrmService, { provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
