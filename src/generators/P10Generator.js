const XLSX = require('xlsx');

/**
 * Builds B_Employees_Dtls_Simp.csv for KRA's real "Simplified Unified Payroll
 * Return" (v30.0.2), Section B — corrected against REAL validation errors
 * returned by KRA's own macro after an actual test import, not guesswork.
 *
 * CONFIRMED BY REAL TEST:
 * - No header row needed — confirmed correct. KRA's import reads raw data
 *   rows directly; the earlier "with header" alternative is no longer needed.
 * - "Type of Housing" is REQUIRED and must be one of KRA's exact fixed values:
 *   'Benefit not given', 'House to Non full time service Director',
 *   'Employer's Owned House', 'Employer's Rented House', or 'Agriculture Farm'.
 *   Defaults to 'Benefit not given' for employees with no housing benefit.
 * - "Total Gross Pay", "Taxable Pay", and "PAYE Tax" are FORMULA-CALCULATED
 *   fields inside KRA's own sheet — they must be left BLANK, not filled by us.
 *   KRA's own Excel formulas compute these automatically from the raw inputs
 *   (Total Cash Pay, benefits, SHIF, NSSF, pension, mortgage, housing levy,
 *   personal relief, insurance relief). Sending our own computed totals into
 *   these fields was the actual cause of three of the four real errors found.
 * - "Self Assessed PAYE Tax" remains an INPUT field (no error was raised
 *   against it) — this is where our own calculated PAYE figure belongs.
 *
 * @param {Array} employeePayrollData
 * @returns {Buffer} CSV file, no header row (confirmed correct by real test)
 */
function generateP10EmployeeDetailsCsv(employeePayrollData) {
    const rows = employeePayrollData.map(emp => {
        const totalCashPay = Number(emp.basicPaySnapshot || 0) + Number(emp.allowancesSnapshot || 0);

        // APPROXIMATION — car/house benefit still stored as one combined figure
        // in your database, not split. Still a known gap, unrelated to this fix.
        const carBenefitApprox = Number(emp.nonCashBenefitsSnapshot || 0);

        return [
            String(emp.kraPin || ''),
            emp.fullName,
            emp.isResident ? 'Resident' : 'Non-Resident',
            emp.isPrimaryEmployment ? 'Primary Employee' : 'Secondary Employee',
            emp.hasDisabilityExemption ? 'Yes' : 'No',
            '', // F: Exemption Certificate Number — not tracked
            totalCashPay.toFixed(2),
            carBenefitApprox.toFixed(2),
            '0.00', // I: Value of Meals — not tracked
            '0.00', // J: Non Cash Benefits (other) — not tracked
            'Benefit not given', // K: Type of Housing — REQUIRED fixed value, confirmed by real error
            '', // L: Housing Benefit — must be BLANK (not 0) when Type of Housing is 'Benefit not given', confirmed by real error
            '0.00', // M: Other Benefits — not tracked
            '', // N: Total Gross Pay — FORMULA field, must be blank, confirmed by real error
            Number(emp.shif || 0).toFixed(2),
            Number(emp.nssf || 0).toFixed(2),
            Number(emp.registeredPensionContribution || 0).toFixed(2),
            '0.00', // R: Post Retirement Medical Fund — not tracked
            Number(emp.mortgageInterest || 0).toFixed(2),
            Number(emp.housingLevy || 0).toFixed(2),
            '', // U: Taxable Pay — FORMULA field, must be blank, confirmed by real error
            '2400.00', // V: Monthly Personal Relief — NOT flagged as an error in the real test, kept as a real value
            Number(emp.insuranceReliefApplied || 0).toFixed(2),
            '', // X: PAYE Tax — FORMULA field, must be blank, confirmed by real error
            Number(emp.payeTax || 0).toFixed(2) // Y: Self Assessed PAYE Tax — our real computed PAYE goes here
        ];
    });

    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    const csvString = XLSX.utils.sheet_to_csv(worksheet);

    return Buffer.from(csvString, 'utf-8');
}

module.exports = { generateP10EmployeeDetailsCsv };