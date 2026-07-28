const XLSX = require('xlsx');

/**
 * Builds the SHIF/SHA bulk contribution upload file.
 * Verified directly from a real uploaded template (Payroll_Template.xlsx) —
 * this corrected an earlier draft built from a YouTube tutorial, which had
 * the right general idea but missed a column and had the order slightly off.
 *
 * Real column order (Sheet1):
 * A: PAYROLL NUMBER
 * B: FIRSTNAME
 * C: LASTNAME
 * D: IDENTITY TYPE  — REQUIRED, fixed values only (from Sheet2's dropdown list):
 *                     'National ID', 'Alien ID', 'Passport Number', 'Refugee ID'
 * E: ID NO
 * F: KRA PIN
 * G: NHIF NO         — still literally named this in the real file, even though
 *                       NHIF was replaced by SHA — accept a SHA number here too
 * H: CONTRIBUTION AMOUNT — the CALCULATED 2.75% (min 300), not gross salary
 * I: PHONE
 *
 * STILL UNVERIFIED (same caution as everywhere else until tested for real):
 * - Header row inclusion/exclusion — untested, currently included by default
 *   since this looks like a flat single-sheet import (similar to NSSF's real
 *   file), not an import-into-an-existing-templated-sheet like P10's Section B.
 * - Whether "CONTRIBUTION AMOUNT" wants the SHIF deduction alone, or something
 *   else — currently mapped to your calculateSHIF() output, which matches the
 *   tutorial's description, but not yet confirmed by an actual SHA validation.
 *
 * @param {Array} employeePayrollData - one entry per employee:
 *   { payrollNumber, firstName, lastName, identityType, idNo, kraPin,
 *     nhifOrShaNumber, contributionAmount, phone }
 * @returns {Buffer} .xlsx file as a buffer
 */
function generateShifContributionFile(employeePayrollData) {
    const headers = [
        'PAYROLL NUMBER', 'FIRSTNAME', 'LASTNAME', 'IDENTITY TYPE',
        'ID NO', 'KRA PIN', 'NHIF NO', 'CONTRIBUTION AMOUNT', 'PHONE'
    ];

    const rows = employeePayrollData.map(emp => [
        emp.payrollNumber || '',
        emp.firstName || '',
        emp.lastName || '',
        emp.identityType || 'National ID', // reasonable default for most Kenyan employees
        emp.idNo || '',
        emp.kraPin || '',
        emp.nhifOrShaNumber || '',
        Number(emp.contributionAmount) || 0,
        emp.phone || ''
    ]);

    const sheetData = [headers, ...rows];
    const worksheet = XLSX.utils.aoa_to_sheet(sheetData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');

    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = { generateShifContributionFile };