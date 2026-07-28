/**
 * Calculates the employee's Affordable Housing Levy deduction.
 * By Kenyan law, this is a flat 1.5% of the Gross Salary.
 * 
 * @param {number} grossSalary - The employee's total gross salary for the month
 * @returns {number} The calculated Housing Levy deduction rounded to 2 decimal places
 */
function calculateHousingLevy(grossSalary) {
    if (!grossSalary || grossSalary <= 0) {
        return 0.00;
    }
    
    const levyAmount = grossSalary * 0.015;
    
    // Round cleanly to 2 decimal places for accurate Shilling cents
    return Math.round(levyAmount * 100) / 100;
}

module.exports = calculateHousingLevy;