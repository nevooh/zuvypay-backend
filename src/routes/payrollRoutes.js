const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const calculateEnterprisePayroll = require('../calculators/index');
const { protect } = require('../middleware/authMiddleware');
const { triggerStkPush, checkInvoiceStatus } = require('../services/intasendService');
const { resolveActivePeriodId, expireStalePendingPeriods } = require('../services/periodResolver');
const { getGeneratorForBank } = require('../generators/bankGenerators');

const PRICE_PER_EMPLOYEE = 30; // KES per employee per run, per the pricing shown on the Pay screen

async function computeForCompany(companyId) {
    const empResult = await pool.query(`SELECT * FROM employees WHERE company_id = $1 AND is_archived = FALSE`, [companyId]);
    const employees = empResult.rows;

    const computed = [];
    for (const employee of employees) {
        const customPayResult = await pool.query(
            `SELECT r.amount, t.type_category, t.is_taxable, t.name
             FROM employee_recurring_payments r
             JOIN company_payment_types t ON r.payment_type_id = t.id
             WHERE r.employee_id = $1`,
            [employee.id]
        );

        const basicSalaryValue = Number(employee.basic_salary) > 0
            ? employee.basic_salary
            : employee.gross_salary;
        const calculatorInput = { ...employee, basic_salary: basicSalaryValue };
        const calculations = calculateEnterprisePayroll(calculatorInput, customPayResult.rows);

        computed.push({
            employeeId: employee.id,
            fullName: employee.full_name,
            customPayments: customPayResult.rows,
            calculations
        });
    }
    return computed;
}

async function markPeriodPaid(period, invoiceIdForLog) {
    await pool.query(
        `UPDATE payroll_periods SET status = 'PAID', paid_at = CURRENT_TIMESTAMP, paid_by = confirmed_by WHERE id = $1`,
        [period.id]
    );
    await pool.query(
        `UPDATE payroll_runs SET payment_status = 'PAID' WHERE period_id = $1`,
        [period.id]
    );
    await pool.query(
        `INSERT INTO audit_logs (company_id, user_id, action_performed, details)
         VALUES ($1, $2, 'PAYROLL_PAID', $3)`,
        [period.company_id, period.confirmed_by, `Payment confirmed for ${period.payroll_month}/${period.payroll_year} (invoice ${invoiceIdForLog}).`]
    );
}

async function markPeriodFailed(period) {
    await pool.query(`UPDATE payroll_periods SET status = 'EXPIRED' WHERE id = $1`, [period.id]);
    await pool.query(
        `INSERT INTO audit_logs (company_id, user_id, action_performed, details)
         VALUES ($1, $2, 'PAYROLL_PAYMENT_FAILED', $3)`,
        [period.company_id, period.confirmed_by, `M-Pesa payment failed/cancelled for ${period.payroll_month}/${period.payroll_year} (invoice ${period.intasend_invoice_id}).`]
    );
}

router.post('/calculate', protect, async (req, res, next) => {
    const { month, year } = req.body;
    const companyId = req.user.companyId;

    if (!month || !year) {
        return res.status(400).json({ status: 'error', message: 'Missing required parameters: month and year are mandatory.' });
    }

    try {
        const computed = await computeForCompany(companyId);
        if (computed.length === 0) {
            return res.status(404).json({ status: 'error', message: 'No employees found registered under this company profile.' });
        }

        const paidCheck = await pool.query(
            `SELECT id, paid_at FROM payroll_periods
             WHERE company_id = $1 AND payroll_month = $2 AND payroll_year = $3 AND status = 'PAID'
             ORDER BY paid_at DESC LIMIT 1`,
            [companyId, month, year]
        );

        res.status(200).json({
            status: 'success',
            month, year,
            isCorrection: paidCheck.rows.length > 0,
            existingPaidPeriod: paidCheck.rows[0] || null,
            preview: computed
        });
    } catch (error) {
        next(error);
    }
});

router.post('/:month/:year/confirm', protect, async (req, res, next) => {
    const { month, year } = req.params;
    const { acknowledgeCorrection } = req.body;
    const companyId = req.user.companyId;
    const userId = req.user.id;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const existingPaid = await client.query(
            `SELECT id, paid_at FROM payroll_periods
             WHERE company_id = $1 AND payroll_month = $2 AND payroll_year = $3 AND status = 'PAID'
             ORDER BY paid_at DESC LIMIT 1`,
            [companyId, month, year]
        );
        const priorPaidPeriod = existingPaid.rows[0] || null;

        if (priorPaidPeriod && !acknowledgeCorrection) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                status: 'confirmation_required',
                message: `${month}/${year} payroll was already paid on ${priorPaidPeriod.paid_at}. Re-confirming will create a correction run for this period — the original paid figures stay untouched, but the new figures become the current record for downloads. Resubmit with acknowledgeCorrection: true to proceed.`,
                priorPaidPeriod
            });
        }

        const stalePending = await client.query(
            `SELECT id FROM payroll_periods
             WHERE company_id = $1 AND payroll_month = $2 AND payroll_year = $3 AND status = 'PENDING'`,
            [companyId, month, year]
        );
        for (const row of stalePending.rows) {
            await client.query(`DELETE FROM payroll_runs WHERE period_id = $1`, [row.id]);
            await client.query(`DELETE FROM payroll_periods WHERE id = $1`, [row.id]);
        }

        const computed = await computeForCompany(companyId);
        if (computed.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ status: 'error', message: 'No employees found registered under this company profile.' });
        }

        const periodResult = await client.query(
            `INSERT INTO payroll_periods (
                company_id, payroll_month, payroll_year, status,
                is_correction, correction_of, confirmed_by, confirmed_at,
                amount_due, employee_count
             ) VALUES ($1, $2, $3, 'PENDING', $4, $5, $6, CURRENT_TIMESTAMP, $7, $8)
             RETURNING *`,
            [
                companyId, month, year,
                !!priorPaidPeriod, priorPaidPeriod?.id || null,
                userId,
                computed.length * PRICE_PER_EMPLOYEE,
                computed.length
            ]
        );
        const period = periodResult.rows[0];

        for (const item of computed) {
            const c = item.calculations;
            await client.query(
                `INSERT INTO payroll_runs (
                    employee_id, payroll_month, payroll_year, gross_pay,
                    nssf_deduction, shif_deduction, housing_levy, paye_tax, net_pay,
                    basic_pay_snapshot, allowances_snapshot, non_cash_benefits_snapshot,
                    insurance_relief_applied, withholding_tax_applied,
                    mortgage_relief_applied, pension_relief_applied, taxable_income,
                    calculated_by, payment_status, period_id
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'PENDING',$19)`,
                [
                    item.employeeId, month, year, c.metrics.grossSalary,
                    c.employeeDeductions.nssf, c.employeeDeductions.shif, c.employeeDeductions.housingLevy,
                    c.employeeDeductions.payeTax, c.metrics.netPay,
                    c.metrics.basicPaySnapshot, c.metrics.allowancesSnapshot, c.metrics.nonCashBenefitsSnapshot,
                    c.employeeDeductions.insuranceReliefApplied, c.employeeDeductions.withholdingTaxApplied,
                    c.employeeDeductions.mortgageReliefApplied, c.employeeDeductions.pensionReliefApplied,
                    c.metrics.taxableIncomeBeforeBrackets, userId, period.id
                ]
            );
        }

        await client.query(
            `INSERT INTO audit_logs (company_id, user_id, action_performed, details)
             VALUES ($1, $2, $3, $4)`,
            [
                companyId, userId,
                priorPaidPeriod ? 'PAYROLL_CORRECTION_CONFIRMED' : 'PAYROLL_CONFIRMED',
                priorPaidPeriod
                    ? `Confirmed a correction run for ${month}/${year} (original paid ${priorPaidPeriod.paid_at}, kept intact).`
                    : `Confirmed payroll for ${month}/${year}, pending payment.`
            ]
        );

        await client.query('COMMIT');

        res.status(201).json({
            status: 'success',
            message: 'Payroll confirmed and pending payment.',
            period,
            amountDue: period.amount_due
        });
    } catch (error) {
        await client.query('ROLLBACK');
        next(error);
    } finally {
        client.release();
    }
});

router.post('/:month/:year/pay', protect, async (req, res, next) => {
    const { month, year } = req.params;
    const { phoneNumber } = req.body;
    const companyId = req.user.companyId;

    if (!phoneNumber) {
        return res.status(400).json({ status: 'error', message: 'A phone number is required to send the M-Pesa prompt.' });
    }

    try {
        await expireStalePendingPeriods(companyId, month, year);

        const pendingResult = await pool.query(
            `SELECT p.*, u.email, u.full_name
             FROM payroll_periods p
             JOIN users u ON u.id = p.confirmed_by
             WHERE p.company_id = $1 AND p.payroll_month = $2 AND p.payroll_year = $3 AND p.status = 'PENDING'`,
            [companyId, month, year]
        );
        const period = pendingResult.rows[0];
        if (!period) {
            return res.status(404).json({ status: 'error', message: 'No confirmed payroll is waiting for payment for this period. Confirm it first.' });
        }

        const [firstName, ...rest] = (period.full_name || 'Payroll Admin').split(' ');
        const stk = await triggerStkPush({
            phoneNumber,
            amount: period.amount_due,
            email: period.email,
            firstName,
            lastName: rest.join(' ') || 'Admin',
            apiRef: `payroll-period-${period.id}`
        });

        await pool.query(
            `UPDATE payroll_periods SET intasend_invoice_id = $1, phone_number = $2 WHERE id = $3`,
            [stk.invoiceId, phoneNumber, period.id]
        );

        res.status(200).json({
            status: 'success',
            message: 'M-Pesa prompt sent — check the phone to enter the PIN and complete payment.',
            invoiceId: stk.invoiceId,
            periodId: period.id
        });
    } catch (error) {
        next(error);
    }
});

router.post('/webhook/intasend', async (req, res, next) => {
    const { invoice_id, state } = req.body;

    try {
        const periodResult = await pool.query(
            `SELECT * FROM payroll_periods WHERE intasend_invoice_id = $1 AND status = 'PENDING'`,
            [invoice_id]
        );
        const period = periodResult.rows[0];
        if (!period) {
            return res.status(200).json({ status: 'ignored', message: 'No matching pending period.' });
        }

        if (state === 'COMPLETE') {
            await markPeriodPaid(period, invoice_id);
        } else if (state === 'FAILED') {
            await markPeriodFailed(period);
        }

        res.status(200).json({ status: 'success' });
    } catch (error) {
        next(error);
    }
});

router.get('/:month/:year/status', protect, async (req, res, next) => {
    const { month, year } = req.params;
    const companyId = req.user.companyId;
    try {
        await expireStalePendingPeriods(companyId, month, year);

        let result = await pool.query(
            `SELECT p.*, cu.full_name AS confirmed_by_name, pu.full_name AS paid_by_name
             FROM payroll_periods p
             LEFT JOIN users cu ON cu.id = p.confirmed_by
             LEFT JOIN users pu ON pu.id = p.paid_by
             WHERE p.company_id = $1 AND p.payroll_month = $2 AND p.payroll_year = $3
             ORDER BY p.created_at DESC`,
            [companyId, month, year]
        );
        let pending = result.rows.find(r => r.status === 'PENDING') || null;
        let justFailed = false;

        if (pending && pending.intasend_invoice_id) {
            const liveState = await checkInvoiceStatus(pending.intasend_invoice_id);
            if (liveState === 'COMPLETE') {
                await markPeriodPaid(pending, pending.intasend_invoice_id);
            } else if (liveState === 'FAILED') {
                await markPeriodFailed(pending);
                justFailed = true;
            }

            if (liveState === 'COMPLETE' || liveState === 'FAILED') {
                result = await pool.query(
                    `SELECT p.*, cu.full_name AS confirmed_by_name, pu.full_name AS paid_by_name
                     FROM payroll_periods p
                     LEFT JOIN users cu ON cu.id = p.confirmed_by
                     LEFT JOIN users pu ON pu.id = p.paid_by
                     WHERE p.company_id = $1 AND p.payroll_month = $2 AND p.payroll_year = $3
                     ORDER BY p.created_at DESC`,
                    [companyId, month, year]
                );
                pending = result.rows.find(r => r.status === 'PENDING') || null;
            }
        }

        const paid = result.rows.find(r => r.status === 'PAID') || null;
        res.status(200).json({ status: 'success', pending, paid, justFailed });
    } catch (error) {
        next(error);
    }
});

router.get('/history', protect, async (req, res, next) => {
    const companyId = req.user.companyId;
    try {
        const result = await pool.query(
            `SELECT p.*, cu.full_name AS confirmed_by_name, pu.full_name AS paid_by_name
             FROM payroll_periods p
             LEFT JOIN users cu ON cu.id = p.confirmed_by
             LEFT JOIN users pu ON pu.id = p.paid_by
             WHERE p.company_id = $1 AND p.status = 'PAID'
             ORDER BY p.created_at DESC`,
            [companyId]
        );
        res.status(200).json({ status: 'success', periods: result.rows });
    } catch (error) {
        next(error);
    }
});

router.get('/history/:periodId', protect, async (req, res, next) => {
    const { periodId } = req.params;
    const companyId = req.user.companyId;
    try {
        const periodResult = await pool.query(
            `SELECT * FROM payroll_periods WHERE id = $1 AND company_id = $2 AND status = 'PAID'`,
            [periodId, companyId]
        );
        if (periodResult.rows.length === 0) {
            return res.status(404).json({ status: 'error', message: 'Period not found.' });
        }

        const runsResult = await pool.query(
            `SELECT r.*, e.full_name
             FROM payroll_runs r
             JOIN employees e ON r.employee_id = e.id
             WHERE r.period_id = $1
             ORDER BY e.full_name ASC`,
            [periodId]
        );

        res.status(200).json({ status: 'success', period: periodResult.rows[0], runs: runsResult.rows });
    } catch (error) {
        next(error);
    }
});

router.get('/:month/:year', protect, async (req, res, next) => {
    const { month, year } = req.params;
    const { periodId } = req.query;
    const companyId = req.user.companyId;

    try {
        const activePeriodId = await resolveActivePeriodId(companyId, month, year, periodId);
        if (!activePeriodId) {
            return res.status(404).json({ status: 'error', message: 'No paid payroll found for this period yet.' });
        }

        const result = await pool.query(
            `SELECT r.*, e.full_name
             FROM payroll_runs r
             JOIN employees e ON r.employee_id = e.id
             WHERE r.period_id = $1
             ORDER BY e.full_name ASC`,
            [activePeriodId]
        );
        res.status(200).json({ status: 'success', periodId: activePeriodId, runs: result.rows });
    } catch (error) {
        next(error);
    }
});

router.get('/bank-file/:month/:year', protect, async (req, res, next) => {
    const { month, year } = req.params;
    const { periodId } = req.query;
    const companyId = req.user.companyId;

    try {
        const activePeriodId = await resolveActivePeriodId(companyId, month, year, periodId);
        if (!activePeriodId) {
            return res.status(404).json({ status: 'error', message: 'No processed payroll records found for the requested period.' });
        }

        const queryText = `
            SELECT
                e.full_name, e.bank_name, e.kba_branch_code, e.account_number, r.net_pay,
                e.national_id, e.kra_pin, e.email, e.phone
            FROM payroll_runs r
            JOIN employees e ON r.employee_id = e.id
            WHERE r.period_id = $1
            ORDER BY e.full_name ASC;
        `;
        const result = await pool.query(queryText, [activePeriodId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ status: 'error', message: 'No processed payroll records found for the requested period.' });
        }

        // The bank file format depends on which bank the COMPANY submits
        // bulk payments through — not any individual employee's personal
        // bank (employees can each bank wherever they like; that's exactly
        // why bulk files list every employee's own bank/account within one
        // submission through the company's own bank).
        const companyResult = await pool.query(`SELECT selected_bank FROM companies WHERE id = $1`, [companyId]);
        const companyBank = companyResult.rows[0]?.selected_bank;
        if (!companyBank) {
            return res.status(400).json({ status: 'error', message: 'No bank selected yet on your Company page — pick one there first.' });
        }
        const generator = getGeneratorForBank(companyBank);

        if (generator) {
            const { buffer, filename, contentType } = generator(result.rows, month, year);
            res.setHeader('Content-Type', contentType);
            res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
            return res.status(200).send(buffer);
        }

        // No hardcoded generator built for this bank yet. Rather than hand
        // over a generic file that bank may well reject on upload, be
        // upfront about it — same "still being set up" language used on
        // the Company page.
        return res.status(409).json({
            status: 'error',
            message: `The bank file template for ${companyBank} hasn't been set up yet. This usually takes under 24 hours — we'll notify you once it's ready.`
        });
    } catch (error) {
        next(error);
    }
});

module.exports = router;