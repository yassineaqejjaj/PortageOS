import { describe, expect, it } from "vitest";
import { pasRate, simulateSalary, SalaryParams } from "../src/salary-simulation";

/** Paramètres de la feuille de référence (valeurs de test ; en service elles viennent du catalogue approuvé). */
const P: SalaryParams = {
  workingDaysPerYear: "227", managementFeePercent: "10", netToGrossPercent: "75", paidLeaveDays: "25", leaveDayDivisor: "250", pasTopRatePercent: "43",
  pasGrid: [["1759", "1.3"], ["3052", "7.5"], ["3476", "9.9"], ["3913", "11.9"], ["4566", "13.8"], ["5475", "15.8"], ["6851", "17.9"], ["8557", "20"], ["11877", "24"], ["16086", "28"], ["25251", "33"], ["54088", "38"]].map(([upTo, ratePercent]) => ({ upTo: upTo!, ratePercent: ratePercent! })),
};
const run = (tjm: string, dailyExpenses: string, grossAnnual: string) => simulateSalary({ tjm, daysPerMonth: "20", dailyExpenses, mutualMonthly: "100", grossAnnual }, P);

describe("simulation de rémunération : cas de référence (feuilles B&G Partner)", () => {
  const cases: [string, string, string, Record<string, string>][] = [
    ["700", "270", "58000", { envelope: "143010.00", professionalExpenses: "5400.00", grossMonthly: "4833.33", netBeforePas: "3625.00", pasRatePercent: "11.90", netAfterPas: "3193.63", netPaidMonthly: "8693.63", salaryPerLeaveDay: "232.00", totalPerLeaveDay: "502.00", extraForUntakenLeave: "12550.00" }],
    ["700", "230", "65000", { professionalExpenses: "4600.00", grossMonthly: "5416.67", netBeforePas: "4062.50", pasRatePercent: "13.80", netAfterPas: "3501.88", netPaidMonthly: "8201.88", salaryPerLeaveDay: "260.00", totalPerLeaveDay: "490.00", extraForUntakenLeave: "12250.00" }],
    ["700", "200", "70000", { professionalExpenses: "4000.00", grossMonthly: "5833.33", netBeforePas: "4375.00", pasRatePercent: "13.80", netAfterPas: "3771.25", netPaidMonthly: "7871.25", salaryPerLeaveDay: "280.00", totalPerLeaveDay: "480.00", extraForUntakenLeave: "12000.00" }],
    ["435", "140", "41000", { envelope: "88870.50", professionalExpenses: "2800.00", grossMonthly: "3416.67", netBeforePas: "2562.50", pasRatePercent: "7.50", netAfterPas: "2370.31", netPaidMonthly: "5270.31", salaryPerLeaveDay: "164.00", totalPerLeaveDay: "304.00", extraForUntakenLeave: "7600.00" }],
    ["435", "130", "43000", { professionalExpenses: "2600.00", grossMonthly: "3583.33", netBeforePas: "2687.50", pasRatePercent: "7.50", netAfterPas: "2485.94", netPaidMonthly: "5185.94", salaryPerLeaveDay: "172.00", totalPerLeaveDay: "302.00", extraForUntakenLeave: "7550.00" }],
    ["435", "122", "44000", { professionalExpenses: "2440.00", grossMonthly: "3666.67", netBeforePas: "2750.00", pasRatePercent: "7.50", netAfterPas: "2543.75", netPaidMonthly: "5083.75", salaryPerLeaveDay: "176.00", totalPerLeaveDay: "298.00", extraForUntakenLeave: "7450.00" }],
  ];
  it.each(cases)("TJM %s · frais %s · brut %s", (tjm, exp, gross, expected) => { expect(run(tjm, exp, gross)).toMatchObject(expected); });
  it("grille PAS : seuil inclus, au-delà du dernier seuil taux maximal", () => {
    expect(pasRate("3913.00", P.pasGrid, "43")).toBe("11.9"); expect(pasRate("3913.01", P.pasGrid, "43")).toBe("13.8"); expect(pasRate("60000", P.pasGrid, "43")).toBe("43");
  });
  it("rentabilité interne : (CA − brut×(1+45 %) − frais − mutuelle) ÷ CA ; absente sans paramètre de charges", () => {
    const r = simulateSalary({ tjm: "700", daysPerMonth: "20", dailyExpenses: "270", mutualMonthly: "100", grossAnnual: "58000" }, { ...P, employerChargesPercent: "45" });
    expect(r).toMatchObject({ internalMargin: "8800.00", internalProfitabilityPercent: "5.54" }); // CA 158 900 − 84 100 − 64 800 − 1 200
    expect(run("700", "270", "58000")).toMatchObject({ internalMargin: null, internalProfitabilityPercent: null });
  });
  it("refuse un scénario hors enveloppe, un TJM nul et des jours invalides", () => {
    expect(() => run("700", "270", "140000")).toThrow(/enveloppe/); expect(() => run("0", "270", "58000")).toThrow(/TJM/);
    expect(() => simulateSalary({ tjm: "700", daysPerMonth: "20.3", dailyExpenses: "1", mutualMonthly: "0", grossAnnual: "50000" }, P)).toThrow(/Jours/);
  });
});
