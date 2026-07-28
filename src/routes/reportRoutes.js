const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { protect } = require('../middleware/authMiddleware');
const { resolveActivePeriodId } = require('../services/periodResolver');

/**
 * @route   GET /api/reports/summary
 * @desc    Fetches the complete historical payroll summary run lists for a specific month and year
 * @query   periodId (optional) - for viewing an older/corrected period from the History page.
 * @access  Private
 */
router.get('/summary', protect, async (req, res, next) => {
    const { month, year, periodId } = req.query;
    const companyId = req.user.companyId; // Enforce security isolation from the token!

    if (!month || !year) {
        return res.status(400).json({
            status: 'error',
            message: 'Missing filter keys: month and year queries are required.'
        });
    }

    try {
        const activePeriodId = await resolveActivePeriodId(companyId, month, year, periodId);
        if (!activePeriodId) {
            return res.status(200).json({
                status: 'success',
                month, year,
                analytics: {
                    totalNetPayOutflow: 0, totalKRAObligation: 0, totalNSSFObligation: 0,
                    totalSHIFObligation: 0, totalHousingLevyMatchable: 0, totalCompanyCostMetrics: 0
                },
                records: []
            });
        }

        const queryText = `
            SELECT 
                r.id AS run_id,
                e.full_name,
                e.employee_type,
                r.payroll_month,
                r.payroll_year,
                r.basic_pay_snapshot,
                r.allowances_snapshot,
                r.non_cash_benefits_snapshot,
                r.nssf_deduction,
                r.shif_deduction,
                r.housing_levy,
                r.insurance_relief_applied,
                r.paye_tax,
                r.withholding_tax_applied,
                r.net_pay,
                r.payment_status
            FROM payroll_runs r
            JOIN employees e ON r.employee_id = e.id
            WHERE r.period_id = $1
            ORDER BY e.full_name ASC;
        `;

        const result = await pool.query(queryText, [activePeriodId]);

        // Calculate overarching company liabilities for the dashboard summary view cards
        let totalCompanyNetPay = 0;
        let totalKRA_PAYE = 0;
        let totalNSSF = 0;
        let totalSHIF = 0;
        let totalHousingLevyEmployee = 0;

        result.rows.forEach(row => {
            totalCompanyNetPay += Number(row.net_pay);
            totalKRA_PAYE += Number(row.paye_tax) + Number(row.withholding_tax_applied);
            totalNSSF += Number(row.nssf_deduction);
            totalSHIF += Number(row.shif_deduction);
            totalHousingLevyEmployee += Number(row.housing_levy);
        });

        res.status(200).json({
            status: 'success',
            month,
            year,
            analytics: {
                totalNetPayOutflow: Math.round(totalCompanyNetPay * 100) / 100,
                totalKRAObligation: Math.round(totalKRA_PAYE * 100) / 100,
                totalNSSFObligation: Math.round(totalNSSF * 100) / 100,
                totalSHIFObligation: Math.round(totalSHIF * 100) / 100,
                totalHousingLevyMatchable: Math.round(totalHousingLevyEmployee * 100) / 100,
                // NSSF and Housing Levy are both matched 1:1 by the employer (per
                // your own calculator's logic) — both doubled here. SHIF has no
                // employer match under current law, so it's counted once only.
                totalCompanyCostMetrics: Math.round((totalCompanyNetPay + totalKRA_PAYE + totalSHIF + (totalHousingLevyEmployee * 2) + (totalNSSF * 2)) * 100) / 100
            },
            records: result.rows
        });

    } catch (error) {
        next(error);
    }
});

module.exports = router;