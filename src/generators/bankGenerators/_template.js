const XLSX = require('xlsx');

/**
 * TEMPLATE — copy this file, rename it (e.g. equity.js), and fill in the
 * REAL layout of the bank's actual bulk-upload template once you've
 * downloaded and looked at the real file (use the fileUrl the admin
 * submissions list now gives you).
 *
 * Every generator gets the same input shape and must return the same
 * output shape, so the dispatcher in index.js can treat every bank
 * identically — that's the "one route for every bank" part.
 *
 * @param {Array} rows - one object per employee for this period:
 *   {
 *     full_name, bank_name, kba_branch_code, account_number, net_pay,
 *     national_id, kra_pin, email, phone   // whatever else you need is
 *                                           // already available here —
 *                                           // extend the SELECT in
 *                                           // payrollRoutes.js if a bank
 *                                           // needs a field not listed.
 *   }
 * @param {number} month
 * @param {number} year
 * @returns {{ buffer: Buffer, filename: string, contentType: string }}
 */
function generate(rows, month, year) {
    // --- EXAMPLE using an actual blank template file as the base ---
    // If the bank gave you a real .xlsx template with a specific sheet name
    // and header row, load it (e.g. from disk, or fetched via getFile() if
    // you saved their blank template through the submit-template flow) and
    // write real values into its real cells:
    //
    //   const workbook = XLSX.readFile('path/to/their/blank_template.xlsx');
    //   const sheet = workbook.Sheets['Sheet1']; // whatever their real sheet is named
    //   rows.forEach((row, i) => {
    //       const r = i + 1; // row 0 is their header row
    //       XLSX.utils.sheet_add_aoa(sheet, [[
    //           row.full_name, row.account_number, row.kba_branch_code, row.net_pay
    //           // ...however many real columns THIS bank's template actually has
    //       ]], { origin: { r, c: 0 } });
    //   });
    //   const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    // --- Placeholder below so this file runs before you've filled it in ---
    const worksheet = XLSX.utils.json_to_sheet(rows.map(r => ({
        'Full Name': r.full_name,
        'Account Number': r.account_number,
        'Branch Code': r.kba_branch_code,
        'Amount': r.net_pay
    })));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    return {
        buffer,
        filename: `BankFile_M${month}_Y${year}.xlsx`,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    };
}

module.exports = generate;
