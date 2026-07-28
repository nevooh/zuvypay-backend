/**
 * One route in payrollRoutes.js (`GET /bank-file/:month/:year`) serves every
 * bank. It looks up the company's selected bank here; if a real hardcoded
 * generator exists for that bank, it's used. If not, the route falls back
 * to the generic universal CSV so nothing ever breaks for an unbuilt bank.
 *
 * To add a new bank once you've reviewed their real uploaded template:
 *   1. Copy _template.js in this folder, rename it to match the bank
 *      (e.g. equity.js), and fill in the real column layout you see in
 *      the actual downloaded file (use the fileUrl from the admin
 *      submissions list to grab it).
 *   2. Register it below.
 *   3. Call POST /admin/bank-submissions/:id/mark-built so companies on
 *      that bank stop seeing "still being set up."
 *
 * No shared column-mapping table, no generic filler — each bank's real
 * layout (however many columns it actually needs) is just written in
 * plain code, same pattern as nssfGenerator.js / p10Generator.js.
 */

const registry = {
    // 'Equity Bank': require('./equity'),
    // 'Kenya Commercial Bank (KCB)': require('./kcb'),
};

/**
 * @param {string} bankName
 * @returns {Function|null} a generator function, or null if this bank isn't built yet
 */
function getGeneratorForBank(bankName) {
    return registry[bankName] || null;
}

module.exports = { getGeneratorForBank };
