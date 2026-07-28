/**
 * Calculates the National Social Security Fund (NSSF) tiered deduction.
 * NSSF Act 2013, Year 4 (effective 1 February 2026).
 *
 * Bracket rules:
 * - Tier I: 6% of gross up to KES 9,000 (Max KES 540)
 * - Tier II: 6% of gross between KES 9,001 and KES 108,000 (Max KES 5,940)
 * - Maximum total cap: KES 6,480 for gross salaries KES 108,000 and above.
 *
 * @param {number} grossSalary - The employee's total gross salary
 * @returns {number} The total combined NSSF deduction (Tier I + Tier II)
 */
function calculateNSSF(grossSalary) {
    if (!grossSalary || grossSalary <= 0) return 0.00;

    const LEL = 9000;   // Tier I lower earnings limit
    const UEL = 108000; // Tier II upper earnings limit

    const tier1 = Math.min(grossSalary, LEL) * 0.06;
    const tier2Earnings = Math.max(0, Math.min(grossSalary, UEL) - LEL);
    const tier2 = tier2Earnings * 0.06;

    return Math.round((tier1 + tier2) * 100) / 100;
}

/**
 * Same calculation as calculateNSSF, but returns Tier I and Tier II separately.
 * Needed for the NSSF return file, which requires each tier as its own row.
 * Kept as a separate function (rather than changing calculateNSSF's return shape)
 * so nothing that already depends on calculateNSSF's single-number output breaks.
 *
 * @param {number} grossSalary
 * @returns {{tier1: number, tier2: number, total: number}}
 */
function calculateNSSFBreakdown(grossSalary) {
    if (!grossSalary || grossSalary <= 0) return { tier1: 0.00, tier2: 0.00, total: 0.00 };

    const LEL = 9000;
    const UEL = 108000;

    const tier1 = Math.round((Math.min(grossSalary, LEL) * 0.06) * 100) / 100;
    const tier2Earnings = Math.max(0, Math.min(grossSalary, UEL) - LEL);
    const tier2 = Math.round((tier2Earnings * 0.06) * 100) / 100;

    return { tier1, tier2, total: Math.round((tier1 + tier2) * 100) / 100 };
}

module.exports = calculateNSSF;
module.exports.calculateNSSFBreakdown = calculateNSSFBreakdown;