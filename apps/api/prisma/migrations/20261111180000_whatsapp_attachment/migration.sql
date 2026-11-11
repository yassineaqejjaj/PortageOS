-- Pièce jointe d'un message sortant : référence à une simulation (le PDF est régénéré à l'envoi, jamais stocké en base).
ALTER TABLE "WhatsappMessage" ADD COLUMN "simulationId" TEXT, ADD COLUMN "attachmentName" TEXT;
