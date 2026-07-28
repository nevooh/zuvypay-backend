const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { protect } = require('../middleware/authMiddleware');
const { generatePayslipPdf, generateCombinedPayslipsPdf } = require('../generators/payslipGenerator');
const { sendPayslipEmail } = require('../services/emailService');
const { resolveActivePeriodId } = require('../services/periodResolver');

async function fetchPayslipData(companyId, employeeId, month, year, periodId) {
    const activePeriodId = await resolveActivePeriodId(companyId, month, year, periodId);
    if (!activePeriodId) return null;

    const query = `
        SELECT c.company_name, c.kra_pin AS company_pin,
               e.full_name, e.email,
               r.gross_pay, r.basic_pay_snapshot, r.paye_tax, r.nssf_deduction,
               r.shif_deduction, r.housing_levy, r.net_pay
        FROM payroll_runs r
        JOIN employees e ON r.employee_id = e.id
        JOIN companies c ON e.company_id = c.id
        WHERE e.company_id = $1 AND e.id = $2 AND r.period_id = $3;
    `;
    const result = await pool.query(query, [companyId, employeeId, activePeriodId]);
    return result.rows[0];
}

function buildPdfData(row, month, year) {
    return {
        companyName: row.company_name,
        companyPin: row.company_pin,
        employeeName: row.full_name,
        month, year,
        basicPay: row.basic_pay_snapshot,
        grossPay: row.gross_pay,
        paye: row.paye_tax,
        nssf: row.nssf_deduction,
        shif: row.shif_deduction,
        housingLevy: row.housing_levy,
        netPay: row.net_pay
    };
}

/**
 * @route GET /api/payslips/:employeeId/:month/:year/download
 * @query periodId (optional) - pass this when downloading from the History
 *        page for an older/corrected period; omitted, defaults to the
 *        latest PAID period for that month (the normal Downloads page).
 */
router.get('/:employeeId/:month/:year/download', protect, async (req, res, next) => {
    const { employeeId, month, year } = req.params;
    const { periodId } = req.query;
    try {
        const row = await fetchPayslipData(req.user.companyId, employeeId, month, year, periodId);
        if (!row) return res.status(404).json({ status: 'error', message: 'No payroll record found.' });

        const pdfBuffer = await generatePayslipPdf(buildPdfData(row, month, year));
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=Payslip_${row.full_name.replace(' ', '_')}.pdf`);
        return res.status(200).send(pdfBuffer);
    } catch (error) {
        next(error);
    }
});

/**
 * @route POST /api/payslips/:employeeId/:month/:year/email
 */
router.post('/:employeeId/:month/:year/email', protect, async (req, res, next) => {
    const { employeeId, month, year } = req.params;
    const { periodId } = req.query;
    try {
        const row = await fetchPayslipData(req.user.companyId, employeeId, month, year, periodId);
        if (!row) return res.status(404).json({ status: 'error', message: 'No payroll record found.' });
        if (!row.email) return res.status(400).json({ status: 'error', message: `${row.full_name} has no email on file.` });

        const pdfBuffer = await generatePayslipPdf(buildPdfData(row, month, year));
        await sendPayslipEmail(row.email, row.full_name, `${month}/${year}`, pdfBuffer);

        res.status(200).json({ status: 'success', message: `Payslip emailed to ${row.email}.` });
    } catch (error) {
        next(error);
    }
});

/**
 * @route POST /api/payslips/email-all/:month/:year
 * @desc  Emails every employee's payslip for the period. Continues past
 *        individual failures (e.g. missing email) rather than stopping the
 *        whole batch — reports which ones succeeded/failed at the end.
 */
router.post('/email-all/:month/:year', protect, async (req, res, next) => {
    const { month, year } = req.params;
    const { periodId } = req.query;
    const companyId = req.user.companyId;

    try {
        const activePeriodId = await resolveActivePeriodId(companyId, month, year, periodId);
        if (!activePeriodId) {
            return res.status(404).json({ status: 'error', message: 'No payroll records found for this period.' });
        }

        const query = `
            SELECT c.company_name, c.kra_pin AS company_pin,
                   e.id AS employee_id, e.full_name, e.email,
                   r.gross_pay, r.basic_pay_snapshot, r.paye_tax, r.nssf_deduction,
                   r.shif_deduction, r.housing_levy, r.net_pay
            FROM payroll_runs r
            JOIN employees e ON r.employee_id = e.id
            JOIN companies c ON e.company_id = c.id
            WHERE e.company_id = $1 AND r.period_id = $2;
        `;
        const result = await pool.query(query, [companyId, activePeriodId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ status: 'error', message: 'No payroll records found for this period.' });
        }

        const sent = [];
        const failed = [];

        for (const row of result.rows) {
            try {
                if (!row.email) throw new Error('No email on file');
                const pdfBuffer = await generatePayslipPdf(buildPdfData(row, month, year));
                await sendPayslipEmail(row.email, row.full_name, `${month}/${year}`, pdfBuffer);
                sent.push(row.full_name);
            } catch (err) {
                failed.push({ name: row.full_name, reason: err.message });
            }
        }

        res.status(200).json({
            status: 'success',
            message: `${sent.length} sent, ${failed.length} failed.`,
            sent, failed
        });
    } catch (error) {
        next(error);
    }
});

/**
 * @route GET /api/payslips/download-all/:month/:year
 * @desc  ALL employees' payslips as ONE combined PDF (each employee's slip
 *        as its own page), not a zip of separate files.
 */
router.get('/download-all/:month/:year', protect, async (req, res, next) => {
    const { month, year } = req.params;
    const { periodId } = req.query;
    const companyId = req.user.companyId;

    try {
        const activePeriodId = await resolveActivePeriodId(companyId, month, year, periodId);
        if (!activePeriodId) {
            return res.status(404).json({ status: 'error', message: 'No payroll records found for this period.' });
        }

        const query = `
            SELECT c.company_name, c.kra_pin AS company_pin,
                   e.full_name, r.gross_pay, r.basic_pay_snapshot, r.paye_tax,
                   r.nssf_deduction, r.shif_deduction, r.housing_levy, r.net_pay
            FROM payroll_runs r
            JOIN employees e ON r.employee_id = e.id
            JOIN companies c ON e.company_id = c.id
            WHERE e.company_id = $1 AND r.period_id = $2
            ORDER BY e.full_name ASC;
        `;
        const result = await pool.query(query, [companyId, activePeriodId]);
        if (result.rows.length === 0) {
            return res.status(404).json({ status: 'error', message: 'No payroll records found for this period.' });
        }

        const dataList = result.rows.map(row => buildPdfData(row, month, year));
        const pdfBuffer = await generateCombinedPayslipsPdf(dataList);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=All_Payslips_M${month}_Y${year}.pdf`);
        return res.status(200).send(pdfBuffer);
    } catch (error) {
        next(error);
    }
});

module.exports = router;
