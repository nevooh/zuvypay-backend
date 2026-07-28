/**
 * Calculates KRA Pay As You Earn (PAYE) tax based on progressive tax bands.
 * Applies the statutory KES 2,400 monthly Personal Relief ONLY when this is the
 * employee's primary (main) job — secondary employment does not get personal relief.
 *
 * @param {number} taxableIncome - Gross Salary minus NSSF/SHIF/Housing Levy/mortgage relief
 * @param {boolean} isPrimaryEmployment - Whether this is the employee's main job (default true)
 * @returns {number} Final PAYE tax to be paid to KRA (rounded to 2 decimal places)
 */
function calculatePAYE(taxableIncome, isPrimaryEmployment = true) {
    if (!taxableIncome || taxableIncome <= 0) {
        return 0.00;
    }

    let tax = 0;
    let remainingIncome = taxableIncome;

    // Band 1: First KES 24,000 at 10%
    if (remainingIncome > 24000) {
        tax += 24000 * 0.10;
        remainingIncome -= 24000;
    } else {
        tax += remainingIncome * 0.10;
        remainingIncome = 0;
    }

    // Band 2: Next KES 8,333 at 25%
    if (remainingIncome > 0) {
        if (remainingIncome > 8333) {
            tax += 8333 * 0.25;
            remainingIncome -= 8333;
        } else {
            tax += remainingIncome * 0.25;
            remainingIncome = 0;
        }
    }

    // Band 3: Next KES 467,667 at 30%
    if (remainingIncome > 0) {
        if (remainingIncome > 467667) {
            tax += 467667 * 0.30;
            remainingIncome -= 467667;
        } else {
            tax += remainingIncome * 0.30;
            remainingIncome = 0;
        }
    }

    // Band 4: Next KES 300,000 at 32.5%
    if (remainingIncome > 0) {
        if (remainingIncome > 300000) {
            tax += 300000 * 0.325;
            remainingIncome -= 300000;
        } else {
            tax += remainingIncome * 0.325;
            remainingIncome = 0;
        }
    }

    // Band 5: Above KES 800,000 at 35%
    if (remainingIncome > 0) {
        tax += remainingIncome * 0.35;
    }

    // Personal Relief only applies to primary employment — secondary jobs get none
    const personalRelief = isPrimaryEmployment ? 2400.00 : 0.00;
    let finalPAYE = tax - personalRelief;

    // PAYE cannot be negative
    if (finalPAYE < 0) {
        finalPAYE = 0.00;
    }

    return Math.round(finalPAYE * 100) / 100;
}

module.exports = calculatePAYE;