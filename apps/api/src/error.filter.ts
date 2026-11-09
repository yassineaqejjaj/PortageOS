import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from "@nestjs/common";

/** Format d'erreur standard {error:{status,message}}; aucun détail interne exposé en 500. */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  private log = new Logger("error");
  catch(e: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    if (e instanceof HttpException) {
      const r = e.getResponse() as { message?: string | string[]; code?: string } | string;
      const message = typeof r === "string" ? r : Array.isArray(r.message) ? r.message.join("; ") : r.message ?? e.message;
      return res.status(e.getStatus()).json({ error: { status: e.getStatus(), message, ...(typeof r === "object" && r.code ? { code: r.code } : {}) } });
    }
    const st = (e as { status?: number; type?: string }).status;
    if (st === 413 || (e as { type?: string }).type === "entity.too.large") return res.status(413).json({ error: { status: 413, message: "Requête trop volumineuse" } });
    this.log.error(e instanceof Error ? e.stack : String(e));
    return res.status(500).json({ error: { status: 500, message: "Erreur interne" } });
  }
}
