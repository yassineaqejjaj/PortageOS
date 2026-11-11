-- Les prospects peuvent consentir à recevoir une simulation (sujet « prospect »).
ALTER TABLE "WhatsappConsent" DROP CONSTRAINT wa_consent_chk;
ALTER TABLE "WhatsappConsent" ADD CONSTRAINT wa_consent_chk CHECK ("subjectType" IN ('consultant', 'contact', 'prospect') AND status IN ('opted_in', 'opted_out') AND phone ~ '^\+[1-9][0-9]{7,14}$');

-- Messages sortants de type « document » (PDF libre dans la fenêtre de 24 h).
ALTER TABLE "WhatsappMessage" DROP CONSTRAINT wa_msg_chk;
ALTER TABLE "WhatsappMessage" ADD CONSTRAINT wa_msg_chk CHECK (direction IN ('in', 'out') AND kind IN ('text', 'template', 'document') AND status IN ('queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'received', 'not_connected', 'simulated'));
