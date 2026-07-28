const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { protect } = require('../middleware/authMiddleware');
const { generateNssfReturnFile } = require('../generators/nssfGenerator');
const { resolveActivePeriodId } = require('../services/periodResolver');

/**
 * @route   GET /api/nssf/export/:month/:year
 * @desc    Downloads the NSSF payroll upload file for the requested period.
 *          No employer header info needed in the file itself — the real
 *          template is just a flat employee table, uploaded via NSSF's own
 *          portal where the employer is already identified by their login.
 * @query   periodId (optional) - for History page downloads of an older/corrected period.
 * @access  Private
 */
router.get('/export/:month/:year', protect, async (req, res, next) => {
    const { month, year } = req.params;
    const { periodId } = req.query;
    const companyId = req.user.companyId;

    try {
        const activePeriodId = await resolveActivePeriodId(companyId, month, year, periodId);
        if (!activePeriodId) {
            return res.status(404).json({ status: 'error', message: 'No processed payroll records found for the requested period.' });
        }

        const payrollQuery = `
            SELECT e.surname, e.other_names, e.national_id, e.kra_pin, e.nssf_number, r.gross_pay
            FROM payroll_runs r
            JOIN employees e ON r.employee_id = e.id
            WHERE r.period_id = $1
            ORDER BY e.surname ASC;
        `;
        const payrollResult = await pool.query(payrollQuery, [activePeriodId]);

        if (payrollResult.rows.length === 0) {
            return res.status(404).json({ status: 'error', message: 'No processed payroll records found for the requested period.' });
        }

        // NSSF's template explicitly requires 9–10 characters — catch this BEFORE
        // generating the file, same "don't ship silently wrong data" principle
        // we've used everywhere else in this build.
        const invalidNssfNumbers = payrollResult.rows.filter(r => {
            const len = (r.nssf_number || '').length;
            return len < 9 || len > 10;
        });

        if (invalidNssfNumbers.length > 0) {
            return res.status(400).json({
                status: 'error',
                message: `${invalidNssfNumbers.length} employee(s) have a missing or invalid NSSF number (must be 9–10 characters). Fix these before generating the file.`,
                employees: invalidNssfNumbers.map(r => ({ name: r.full_name, nssfNumber: r.nssf_number || '(missing)' }))
            });
        }

        const employeePayrollData = payrollResult.rows.map((row, index) => {
            return {
                payrollNumber: String(index + 1), // simple sequential numbering: 1, 2, 3...
                surname: row.surname,
                otherNames: row.other_names,
                nationalId: row.national_id,
                kraPin: row.kra_pin,
                nssfNumber: row.nssf_number,
                grossPay: row.gross_pay,
                voluntaryContribution: 0 // Tier III voluntary top-ups aren't tracked yet — see note below
            };
        });

        const fileBuffer = generateNssfReturnFile(employeePayrollData);

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=NSSF_Payroll_M${month}_Y${year}.xlsx`);
        return res.status(200).send(fileBuffer);

    } catch (error) {
        next(error);
    }
});

module.exports = router;

/**
 * NOTE: voluntaryContribution is hardcoded to 0 for every employee right now,
 * since there's no field anywhere in the system tracking Tier III voluntary
 * NSSF top-ups. If any of your customers' employees actually use this, you'd
 * want a real column for it — low priority until someone actually needs it.
 */