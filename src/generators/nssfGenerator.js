const XLSX = require('xlsx');

/**
 * Builds the NSSF payroll upload file, matching the REAL template
 * (Payroll_Template-Rel03_02_18) verified directly from the actual file —
 * not inferred from search results. This replaces an earlier, incorrect
 * version of this generator that invented a header block and a two-row-
 * per-employee Tier I/II split that do not exist in the real template.
 *
 * Real structure: ONE sheet, ONE header row, ONE row per employee.
 * NSSF itself splits Gross Pay into Tier I/II on their end — this file
 * does not need to pre-split it.
 *
 * Hard rules enforced by NSSF (from the template's own instructions):
 * - No formulas in any cell
 * - No special characters (/, ", -, etc.)
 * - Nothing after the last data row (no totals, no "compiled by" row)
 * - Columns A–F must be TEXT format; Gross Pay and Voluntary stay General/numeric
 * - No blank rows, no hidden rows/columns
 * - File must contain exactly ONE sheet
 * - NSSF number must be 9–10 characters, preserving leading zeros / trailing 'X'
 *
 * @param {Array} employeePayrollData - one entry per employee:
 *   { payrollNumber, surname, otherNames, nationalId, kraPin, nssfNumber,
 *     grossPay, voluntaryContribution }
 * @returns {Buffer} Completed .xlsx file as a buffer
 */
function generateNssfReturnFile(employeePayrollData) {
    const headers = [
        'PAYROLL NUMBER', 'SURNAME', 'OTHER NAMES', 'ID NO',
        'KRA PIN', 'NSSF NO', 'GROSS PAY', 'VOLUNTARY'
    ];

    const rows = employeePayrollData.map(emp => {
        // Strip characters NSSF explicitly disallows, and guard against blank required fields
        const clean = (value) => String(value ?? '').replace(/["/\-]/g, '').trim();

        return [
            clean(emp.payrollNumber), // optional per the template — empty string is fine
            clean(emp.surname),
            clean(emp.otherNames),
            clean(emp.nationalId),
            clean(emp.kraPin),
            clean(emp.nssfNumber), // must be 9–10 chars; validated before this is called — see route
            Number(emp.grossPay) || 0,
            Number(emp.voluntaryContribution) || 0
        ];
    });

    const sheetData = [headers, ...rows];
    const worksheet = XLSX.utils.aoa_to_sheet(sheetData);

    // Force columns A–F to TEXT format, per NSSF's explicit rule — otherwise Excel/xlsx
    // may auto-format things like NSSF numbers with leading zeros as numbers and silently
    // strip the leading zero, corrupting the exact value NSSF needs.
    const range = XLSX.utils.decode_range(worksheet['!ref']);
    for (let row = range.s.r + 1; row <= range.e.r; row++) {
        for (let col = 0; col <= 5; col++) { // columns A(0) through F(5)
            const cellRef = XLSX.utils.encode_cell({ r: row, c: col });
            if (worksheet[cellRef]) {
                worksheet[cellRef].t = 's'; // force string type
                worksheet[cellRef].z = '@'; // force text number format
            }
        }
    }

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1'); // must be the ONLY sheet, per rule 7

    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = { generateNssfReturnFile };