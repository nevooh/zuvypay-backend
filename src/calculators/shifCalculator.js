/**
 * Calculates the Social Health Insurance Fund (SHIF) deduction.
 * Flat 2.75% of Gross Salary with a statutory minimum floor of KES 300.
 * 
 * @param {number} grossSalary - The employee's total gross salary
 * @returns {number} The calculated SHIF deduction with minimum floor applied
 */
function calculateSHIF(grossSalary) {
    if (!grossSalary || grossSalary <= 0) {
        return 0.00;
    }
    
    let shifAmount = grossSalary * 0.0275;
    
    // Statutory Floor Rule: Minimum contribution must be KES 300
    if (shifAmount < 300.00) {
        shifAmount = 300.00;
    }
    
    return Math.round(shifAmount * 100) / 100;
}

module.exports = calculateSHIF;