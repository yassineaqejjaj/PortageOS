import { Injectable, Logger } from "@nestjs/common";
import { createTransport, Transporter } from "nodemailer";
import { PrismaService } from "./prisma.service";
import { sha256 } from "./secretbox";

export type MailTemplate = "password_reset" | "invitation";
const SUBJECT: Record<MailTemplate, string> = { password_reset: "Réinitialisation de votre mot de passe", invitation: "Invitation à rejoindre votre espace" };

/**
 * Envoi d'e-mails transactionnels. SANS `SMTP_URL`, rien n'est envoyé et le journal indique « not_connected » :
 * le produit ne prétend jamais avoir envoyé un message. Le journal ne contient ni corps ni lien.
 */
@Injectable()
export class MailService {
  private log = new Logger("mail");
  private transport: Transporter | null = null;
  constructor(private prisma: PrismaService) {}
  get connected() { return !!process.env.SMTP_URL; }
  private tx() { return (this.transport ??= createTransport(process.env.SMTP_URL!)); }
  baseUrl() { return (process.env.WEB_BASE_URL ?? "").replace(/\/$/, ""); }

  async send(d: { to: string; template: MailTemplate; link: string; tenantId?: string; tenantName?: string; expiresInText: string }): Promise<"sent" | "failed" | "not_connected"> {
    let status: "sent" | "failed" | "not_connected" = "not_connected"; let error: string | undefined;
    if (this.connected && this.baseUrl()) {
      try {
        const url = `${this.baseUrl()}${d.link}`;
        await this.tx().sendMail({ from: process.env.MAIL_FROM ?? "no-reply@localhost", to: d.to, subject: SUBJECT[d.template],
          text: `${d.template === "password_reset" ? "Une réinitialisation de mot de passe a été demandée" : "Vous êtes invité(e)"}${d.tenantName ? ` pour « ${d.tenantName} »` : ""}.\n\nLien (valable ${d.expiresInText}, usage unique) : ${url}\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez ce message.` });
        status = "sent";
      } catch (e) { status = "failed"; error = (e as Error).message.slice(0, 200); this.log.error(`envoi échoué (${d.template}): ${error}`); }
    } else if (this.connected) { status = "failed"; error = "WEB_BASE_URL manquant"; }
    await this.prisma.emailOutbox.create({ data: { tenantId: d.tenantId, toHash: sha256(d.to.toLowerCase()), template: d.template, status, error } }).catch(() => undefined);
    return status;
  }
}
