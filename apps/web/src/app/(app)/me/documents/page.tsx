"use client";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { DocumentsPanel } from "@/lib/documents";

export default function MyDocumentsPage() {
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<{ consultantId?: string }>("me") });
  return (
    <>
      <h1>Mes documents</h1>
      <p className="muted">Déposez ici les pièces demandées pour votre dossier (pièce d’identité, coordonnées bancaires, attestation RC Pro). Seuls vous et les personnes habilitées de votre société peuvent les consulter.</p>
      {me.data && !me.data.consultantId && <div className="alert a-info" role="note"><span>Votre compte n’est pas rattaché à un dossier consultant.</span></div>}
      {me.data?.consultantId && <DocumentsPanel ownerType="consultant" ownerId={me.data.consultantId} categories={["identity_document", "bank_details", "rc_pro", "other"]} canUpload title="Pièces de mon dossier" />}
    </>
  );
}
