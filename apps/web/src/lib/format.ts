const date = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Paris" });
const dateTime = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });
export const fmtDate = (iso: string) => date.format(new Date(iso));
export const fmtDateTime = (iso: string) => dateTime.format(new Date(iso));
export const fmtEUR = (n: number | string) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(Number(n));
