import Decimal from "decimal.js";

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

/** Montant monétaire exact (jamais de float). Représenté en Decimal + devise. */
export class Money {
  private constructor(readonly amount: Decimal, readonly currency: string) {}

  static of(amount: string | number | Decimal, currency = "EUR"): Money {
    if (typeof amount === "number" && !Number.isFinite(amount)) throw new Error("Montant invalide");
    return new Money(new Decimal(amount), currency);
  }
  static zero(currency = "EUR") { return Money.of(0, currency); }

  private assertSame(o: Money) {
    if (o.currency !== this.currency) throw new Error(`Devises différentes: ${this.currency} vs ${o.currency}`);
  }
  add(o: Money) { this.assertSame(o); return new Money(this.amount.plus(o.amount), this.currency); }
  sub(o: Money) { this.assertSame(o); return new Money(this.amount.minus(o.amount), this.currency); }
  mul(factor: string | number | Decimal) { return new Money(this.amount.times(factor), this.currency); }
  neg() { return new Money(this.amount.neg(), this.currency); }
  /** Arrondi au centime (demi supérieur), à appliquer au niveau ligne ou total selon règle documentée. */
  round(dp = 2) { return new Money(this.amount.toDecimalPlaces(dp, Decimal.ROUND_HALF_UP), this.currency); }
  isZero() { return this.amount.isZero(); }
  eq(o: Money) { this.assertSame(o); return this.amount.eq(o.amount); }
  toString() { return `${this.amount.toFixed(2)} ${this.currency}`; }
}

export interface VatLine { net: Money; rate: string }

/** TVA calculée par ligne puis arrondie au centime (règle ligne; documenter toute autre règle dans DOMAIN_RULES). */
export function vatForLine(l: VatLine): Money { return l.net.mul(new Decimal(l.rate).div(100)).round(); }

export function invoiceTotals(lines: VatLine[]) {
  let net = Money.zero(), vat = Money.zero();
  for (const l of lines) { net = net.add(l.net.round()); vat = vat.add(vatForLine({ ...l, net: l.net.round() })); }
  return { net, vat, gross: net.add(vat) };
}
