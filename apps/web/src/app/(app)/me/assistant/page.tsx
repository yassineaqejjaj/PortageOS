"use client";
import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ErrorBox } from "@/lib/ui";
import { Run, RunView } from "@/lib/agents";

export default function AssistantPage() {
  const run = useMutation({ mutationFn: () => api<Run>("me/agent-runs", { method: "POST", body: { playbook: "my_summary" } }) });
  return (
    <>
      <h1>Mon assistant</h1>
      <div className="alert a-info" role="note"><span>Le Consultant Agent présente une synthèse de <b>votre seul dossier</b> à partir de données enregistrées. Il ne répond pas à des questions libres (aucun modèle de langage n’est connecté) et ne peut rien modifier.</span></div>
      <ErrorBox error={run.error} prefix="Erreur" />
      <div><button className="btn btn-primary" disabled={run.isPending} onClick={() => run.mutate()}>Afficher ma synthèse</button></div>
      {run.data && <RunView run={run.data} canApprove={false} canCancel={false} />}
    </>
  );
}
