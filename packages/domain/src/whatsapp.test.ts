import { describe, expect, it } from "vitest";
import { advanceStatus, isStopKeyword, isWithinServiceWindow, normalizePhone, renderTemplatePreview } from "./whatsapp.js";

describe("whatsapp", () => {
  it("normalise les numéros en E.164", () => {
    expect(normalizePhone("06 12 34 56 78")).toBe("+33612345678");
    expect(normalizePhone("+33 6 12 34 56 78")).toBe("+33612345678");
    expect(normalizePhone("0033612345678")).toBe("+33612345678");
    expect(normalizePhone("+44 7700 900123")).toBe("+447700900123");
    for (const bad of ["", "abc", "12345", "+0123456789", "0012", "+33"]) expect(normalizePhone(bad)).toBeNull();
    expect(normalizePhone("7700900123")).toBeNull(); // pas de pays déduit hors forme française
  });
  it("fenêtre de service de 24 h", () => {
    const now = new Date("2026-11-11T12:00:00Z");
    expect(isWithinServiceWindow(null, now)).toBe(false);
    expect(isWithinServiceWindow(new Date("2026-11-10T12:00:01Z"), now)).toBe(true);
    expect(isWithinServiceWindow(new Date("2026-11-10T12:00:00Z"), now)).toBe(false);
    expect(isWithinServiceWindow(new Date("2026-11-11T12:00:01Z"), now)).toBe(false); // futur : horloge incohérente
  });
  it("mots-clés d'arrêt", () => {
    for (const t of ["STOP", " stop. ", "Arrêt", "DÉSINSCRIRE !"]) expect(isStopKeyword(t)).toBe(true);
    for (const t of ["stop the presses please", "ok", "", "ne pas arrêter"]) expect(isStopKeyword(t)).toBe(false);
  });
  it("les statuts n'avancent que vers l'avant", () => {
    expect(advanceStatus("sent", "delivered")).toBe("delivered");
    expect(advanceStatus("read", "delivered")).toBe("read");
    expect(advanceStatus("sent", "failed")).toBe("failed");
    expect(advanceStatus("delivered", "failed")).toBe("delivered");
    expect(advanceStatus("failed", "read")).toBe("failed");
    expect(advanceStatus("simulated", "read")).toBe("simulated");
    expect(advanceStatus("sent", "inconnu")).toBe("sent");
  });
  it("aperçu de modèle", () => {
    expect(renderTemplatePreview("timesheet_reminder", ["Léa", "2026-10", "Mission A"])).toContain("Léa");
  });
});
