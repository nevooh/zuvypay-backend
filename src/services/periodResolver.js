const pool = require('../config/db');

const PENDING_EXPIRY_MINUTES = 15; // Safaricom itself kills the STK prompt in under 2 minutes —
// this just gives generous buffer for a slow webhook before we call the attempt dead.

/**
 * Flips any PENDING period for this company/month/year that's been sitting
 * longer than PENDING_EXPIRY_MINUTES into EXPIRED. Called lazily whenever
 * status is checked — no background job needed for this. Once expired, the
 * period no longer blocks a fresh Confirm attempt, and a late webhook for
 * the old invoice_id will find no PENDING row left to match, so it's safely
 * ignored instead of wrongly marking a dead attempt as paid.
 */
async function expireStalePendingPeriods(companyId, month, year) {
    await pool.query(
        `UPDATE payroll_periods
         SET status = 'EXPIRED'
         WHERE company_id = $1 AND payroll_month = $2 AND payroll_year = $3
           AND status = 'PENDING'
           AND confirmed_at < NOW() - INTERVAL '${PENDING_EXPIRY_MINUTES} minutes'`,
        [companyId, month, year]
    );
}

/**
 * Figures out which payroll_periods.id a download/report route should read
 * its payroll_runs rows from.
 *
 * - If an explicit periodId is passed (the History page always passes one,
 *   since it's browsing a specific past run), we just verify it belongs to
 *   this company and is actually PAID, then use it directly. This is how
 *   "download the docs for that day alone" for an old period works.
 * - Otherwise (the normal Downloads page, no history browsing involved), we
 *   resolve to the LATEST PAID period for that month/year. If that period
 *   happens to be a correction, this naturally picks the corrected figures
 *   over the original — which is what "the current run" should mean.
 *
 * Returns null if nothing PAID exists yet for the request, which every
 * calling route should treat as "no payroll processed for this period."
 */
async function resolveActivePeriodId(companyId, month, year, explicitPeriodId) {
    if (explicitPeriodId) {
        const result = await pool.query(
            `SELECT id FROM payroll_periods WHERE id = $1 AND company_id = $2 AND status = 'PAID'`,
            [explicitPeriodId, companyId]
        );
        return result.rows[0]?.id || null;
    }

    const result = await pool.query(
        `SELECT id FROM payroll_periods
         WHERE company_id = $1 AND payroll_month = $2 AND payroll_year = $3 AND status = 'PAID'
         ORDER BY paid_at DESC LIMIT 1`,
        [companyId, month, year]
    );
    return result.rows[0]?.id || null;
}

module.exports = { resolveActivePeriodId, expireStalePendingPeriods };