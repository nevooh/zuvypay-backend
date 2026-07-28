const XLSX = require('xlsx');

/**
 * Fills a bank's blank bulk-payment template with this month's payroll,
 * using the column mapping already confirmed manually (either by the
 * company themselves via self_confirmed, or by admin approval) — no AI
 * involved, this is plain deterministic spreadsheet writing.
 *
 * @param {Buffer} templateBuffer - the blank template file's bytes
 * @param {string} sheetName - which sheet in the workbook to write into
 * @param {object} mapping - { name, account_number, amount, branch_code, national_id }
 *                           each a 0-indexed column number, or null/undefined
 *                           if that field isn't present in this template
 * @param {Array} rows - one object per employee: { full_name, account_number, branch_code, national_id, net_pay }
 * @returns {Buffer} the filled workbook as an .xlsx buffer
 */
function fillBankTemplate(templateBuffer, sheetName, mapping, rows) {
    const workbook = XLSX.read(templateBuffer, { type: 'buffer' });
    const worksheet = workbook.Sheets[sheetName];

    if (!worksheet) {
        throw new Error(`Sheet "${sheetName}" was not found in this bank's template.`);
    }

    // Row 0 is assumed to be the header row (the one BankSetup.jsx showed
    // for matching) — employee data starts directly below it.
    const startRow = 1;

    rows.forEach((row, i) => {
        const excelRow = startRow + i;
        writeIfMapped(worksheet, excelRow, mapping.name, row.full_name);
        writeIfMapped(worksheet, excelRow, mapping.account_number, row.account_number);
        writeIfMapped(worksheet, excelRow, mapping.amount, row.net_pay);
        writeIfMapped(worksheet, excelRow, mapping.branch_code, row.branch_code);
        writeIfMapped(worksheet, excelRow, mapping.national_id, row.national_id);
    });

    // Extend the sheet's known range so Excel actually displays the new rows
    // instead of silently ignoring cells written past the original bounds.
    const range = XLSX.utils.decode_range(worksheet['!ref']);
    range.e.r = Math.max(range.e.r, startRow + rows.length - 1);
    worksheet['!ref'] = XLSX.utils.encode_range(range);

    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

function writeIfMapped(worksheet, rowIndex, colIndex, value) {
    if (colIndex === null || colIndex === undefined || colIndex === -1) return;
    const address = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex });
    worksheet[address] = {
        t: typeof value === 'number' ? 'n' : 's',
        v: value ?? ''
    };
}

module.exports = { fillBankTemplate };