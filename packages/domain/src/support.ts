import { StateMachine } from "./state-machine.js";

export const TICKET_STATES = ["open", "pending_requester", "resolved", "closed"] as const;
export type TicketState = (typeof TICKET_STATES)[number];
export const TICKET_CATEGORIES = ["question", "incident", "request", "other"] as const;
export const TICKET_PRIORITIES = ["low", "normal", "high"] as const;

/** Rôles pseudo-métier : « requester » = auteur du ticket, « staff » = gestionnaire du support. */
export const ticketWorkflow = new StateMachine<TicketState, Record<string, never>>([
  { from: "open", to: "pending_requester", event: "staff_reply", allowedRoles: ["staff"] },
  { from: "pending_requester", to: "pending_requester", event: "staff_reply", allowedRoles: ["staff"] },
  { from: "open", to: "open", event: "requester_reply", allowedRoles: ["requester"] },
  { from: "pending_requester", to: "open", event: "requester_reply", allowedRoles: ["requester"] },
  { from: "resolved", to: "open", event: "requester_reply", allowedRoles: ["requester"] },
  { from: "open", to: "resolved", event: "resolve", allowedRoles: ["staff"] },
  { from: "pending_requester", to: "resolved", event: "resolve", allowedRoles: ["staff"] },
  { from: "open", to: "closed", event: "close", allowedRoles: ["requester", "staff"] },
  { from: "pending_requester", to: "closed", event: "close", allowedRoles: ["requester", "staff"] },
  { from: "resolved", to: "closed", event: "close", allowedRoles: ["requester", "staff"] },
]);
