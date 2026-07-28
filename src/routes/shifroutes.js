const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { protect } = require('../middleware/authMiddleware');
const { generateShifContributionFile } = require('../generators/ShifGenerator');
const { resolveActivePeriodId } = require('../services/periodResolver');

/**
 * @route   GET /api/shif/export/:month/:year
 * @desc    Downloads the SHIF bulk contribution file for the requested period.
 *          Built from a real uploaded template — see shifGenerator.js for what's
 *          confirmed vs. still unverified (header row, exact meaning of
 *          Contribution Amount).
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

        const query = `
            SELECT
                e.surname, e.other_names, e.identity_type, e.national_id,
                e.kra_pin, e.nhif_or_sha_number, e.phone,
                r.shif_deduction
            FROM payroll_runs r
            JOIN employees e ON r.employee_id = e.id
            WHERE r.period_id = $1
            ORDER BY e.surname ASC;
        `;
        const result = await pool.query(query, [activePeriodId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ status: 'error', message: 'No processed payroll records found for the requested period.' });
        }

        const missingShaNumbers = result.rows.filter(r => !r.nhif_or_sha_number);
        if (missingShaNumbers.length > 0) {
            return res.status(400).json({
                status: 'error',
                message: `${missingShaNumbers.length} employee(s) are missing an NHIF/SHA number. Add it before generating this file.`,
                employees: missingShaNumbers.map(r => `${r.other_names} ${r.surname}`)
            });
        }

        const employeePayrollData = result.rows.map((row, index) => ({
            payrollNumber: String(index + 1),
            firstName: row.other_names,
            lastName: row.surname,
            identityType: row.identity_type,
            idNo: row.national_id,
            kraPin: row.kra_pin,
            nhifOrShaNumber: row.nhif_or_sha_number,
            contributionAmount: row.shif_deduction,
            phone: row.phone
        }));

        const fileBuffer = generateShifContributionFile(employeePayrollData);

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=SHIF_Contributions_M${month}_Y${year}.xlsx`);
        return res.status(200).send(fileBuffer);

    } catch (error) {
        next(error);
    }
});

module.exports = router;