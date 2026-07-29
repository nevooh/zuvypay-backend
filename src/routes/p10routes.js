const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { protect } = require('../middleware/authMiddleware');
const { generateP10EmployeeDetailsCsv } = require('../generators/P10Generator');
const { resolveActivePeriodId } = require('../services/periodResolver');

/**
 * @route   GET /api/p10/employee-details/:month/:year
 * @desc    Downloads B_Employees_Dtls_Simp.csv — import this into the real
 *          KRA Simplified P10 template's Section B using its own Import button.
 * @query   periodId (optional) - for History page downloads of an older/corrected period.
 * @access  Private
 */
router.get('/employee-details/:month/:year', protect, async (req, res, next) => {
    const { month, year } = req.params;
    const { periodId } = req.query;
    const companyId = req.user.companyId;

    try {
        const activePeriodId = await resolveActivePeriodId(companyId, month, year, periodId);
        if (!activePeriodId) {
            return res.status(404).json({ status: 'error', message: 'No payroll records found for this period.' });
        }

        const query = `
            SELECT
                e.kra_pin, e.full_name, e.is_resident, e.is_primary_employment,
                e.has_disability_exemption, e.mortgage_interest, e.registered_pension_contribution,
                r.basic_pay_snapshot, r.allowances_snapshot, r.non_cash_benefits_snapshot,
                r.shif_deduction, r.nssf_deduction, r.housing_levy,
                r.taxable_income, r.insurance_relief_applied, r.paye_tax
            FROM payroll_runs r
            JOIN employees e ON r.employee_id = e.id
            WHERE r.period_id = $1
            ORDER BY e.full_name ASC;
        `;
        const result = await pool.query(query, [activePeriodId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ status: 'error', message: 'No payroll records found for this period.' });
        }

        const missingPins = result.rows.filter(r => !r.kra_pin);
        if (missingPins.length > 0) {
            return res.status(400).json({
                status: 'error',
                message: `${missingPins.length} employee(s) are missing a KRA PIN. Add it before generating the P10 file.`,
                employees: missingPins.map(r => r.full_name)
            });
        }

        const employeePayrollData = result.rows.map(row => ({
            kraPin: row.kra_pin,
            fullName: row.full_name,
            isResident: row.is_resident,
            isPrimaryEmployment: row.is_primary_employment,
            hasDisabilityExemption: row.has_disability_exemption,
            basicPaySnapshot: row.basic_pay_snapshot,
            allowancesSnapshot: row.allowances_snapshot,
            nonCashBenefitsSnapshot: row.non_cash_benefits_snapshot,
            shif: row.shif_deduction,
            nssf: row.nssf_deduction,
            mortgageInterest: row.mortgage_interest,
            registeredPensionContribution: row.registered_pension_contribution,
            housingLevy: row.housing_levy,
            taxableIncome: row.taxable_income,
            insuranceReliefApplied: row.insurance_relief_applied,
            payeTax: row.paye_tax
        }));

        // includeHeaderRow: false is the current best-reasoned guess (see p10Generator.js
        // comments) — change to true here if real testing shows the template needs it.
        const csvBuffer = generateP10EmployeeDetailsCsv(employeePayrollData, false);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=B_Employees_Dtls_Simp.csv`);
        return res.status(200).send(csvBuffer);

    } catch (error) {
        next(error);
    }
});

module.exports = router;