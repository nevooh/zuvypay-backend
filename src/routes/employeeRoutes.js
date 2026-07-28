const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { protect } = require('../middleware/authMiddleware');

// Shared by POST /add and PUT /:id. The frontend only ever collects the
// 3-digit BRANCH code from the admin (the part that genuinely can't be
// looked up automatically) — this combines it with the bank's own known
// 2-digit code to build the real 5-digit KBA sorting code. Previously
// missing entirely: the 3-digit value was being stored as-is, meaning
// every employee saved so far has an incomplete branch code (e.g. "000"
// instead of "68000" for Equity Head Office) — wrong for any real bank
// transfer file.
async function resolveKbaBranchCode(bankName, branchCode) {
    if (!/^\d{3}$/.test(branchCode || '')) {
        throw { status: 400, message: 'Branch code must be exactly 3 digits (e.g. 000 for Head Office).' };
    }
    const bankResult = await pool.query(`SELECT bank_code FROM kenya_banks WHERE bank_name = $1`, [bankName]);
    if (bankResult.rows.length === 0) {
        throw { status: 400, message: `Unknown bank: ${bankName}. Pick one from the list.` };
    }
    return bankResult.rows[0].bank_code + branchCode;
}

// Shared by POST /add and PUT /:id so both enforce the exact same rules —
// one place to update if a DB column length ever changes.
function checkRequiredFields({ surname, otherNames, nationalId, accountNumber, kbaBranchCode }) {
    const requiredFields = [
        ['Surname', surname],
        ['Other Names', otherNames],
        ['National ID', nationalId],
        ['Account Number', accountNumber],
        ['Branch Code', kbaBranchCode]
    ];
    const missing = requiredFields.filter(([, value]) => !value).map(([label]) => label);
    if (missing.length === 0) return null;
    return missing.length === 1
        ? `Missing mandatory field: ${missing[0]} is required.`
        : `Missing mandatory fields: ${missing.join(', ')} are required.`;
}

function checkLengthLimits({ surname, otherNames, nationalId, kraPin, bankName, kbaBranchCode, accountNumber, employeeType, email }) {
    const lengthLimits = [
        ['Surname', surname, 100],
        ['Other Names', otherNames, 100],
        ['National ID', nationalId, 20],
        ['KRA PIN', kraPin, 11],
        ['Bank', bankName, 50],
        ['Branch Code', kbaBranchCode, 5],
        ['Account Number', accountNumber, 30],
        ['Employee Type', employeeType, 30],
        ['Email', email, 100]
    ];
    for (const [label, value, max] of lengthLimits) {
        if (value && String(value).length > max) {
            return `${label} must be at most ${max} characters (got ${String(value).length}).`;
        }
    }
    if (email && !email.includes('@')) {
        return 'Email looks incomplete — check for a typo before saving. Payslips send to whatever is stored here.';
    }
    return null;
}

/**
 * @route   GET /api/employees
 * @desc    Lists every ACTIVE employee belonging to the logged-in user's
 *          company. Archived employees are hidden by default — pass
 *          ?includeArchived=true to see everyone (used by the "Archived"
 *          view so nothing is ever truly lost, just hidden).
 * @access  Private
 */
router.get('/', protect, async (req, res, next) => {
    try {
        const includeArchived = req.query.includeArchived === 'true';
        const result = await pool.query(
            includeArchived
                ? `SELECT * FROM employees WHERE company_id = $1 ORDER BY created_at ASC`
                : `SELECT * FROM employees WHERE company_id = $1 AND is_archived = FALSE ORDER BY created_at ASC`,
            [req.user.companyId]
        );
        res.status(200).json({ status: 'success', employees: result.rows });
    } catch (error) {
        next(error);
    }
});

/**
 * @route   GET /api/employees/:id
 * @desc    Single employee, scoped to the logged-in user's company so one
 *          company can never fetch another company's employee by guessing an ID.
 * @access  Private
 */
router.get('/:id', protect, async (req, res, next) => {
    try {
        const result = await pool.query(
            `SELECT * FROM employees WHERE id = $1 AND company_id = $2`,
            [req.params.id, req.user.companyId]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ status: 'error', message: 'Employee not found.' });
        }
        res.status(200).json({ status: 'success', employee: result.rows[0] });
    } catch (error) {
        next(error);
    }
});

/**
 * @route   POST /api/employees/add
 * @desc    Creates a new employee profile attached to the logged-in admin's company.
 *          Surname and Other Names are the source of truth now — full_name is
 *          DERIVED from them, never the other way around. Guessing which word
 *          in a full name is the surname was unreliable (Kenyan naming order
 *          doesn't consistently follow "last word = surname"), and a wrong
 *          guess risks an incorrect statutory filing. Requiring the two
 *          reliable fields directly removes that risk entirely.
 * @access  Private
 */
router.post('/add', protect, async (req, res, next) => {
    const {
        employeeType, surname, otherNames, nationalId, kraPin, basicSalary,
        bankName, kbaBranchCode, accountNumber, carBenefitValue, nssfNumber,
        houseBenefitValue, insurancePremium, mortgageInterest, isResident,
        hasDisabilityExemption, registeredPensionContribution, isPrimaryEmployment,
        email
    } = req.body;

    const companyId = req.user.companyId;
    const addedBy = req.user.id;

    const requiredError = checkRequiredFields({ surname, otherNames, nationalId, accountNumber, kbaBranchCode });
    if (requiredError) {
        return res.status(400).json({ status: 'error', message: requiredError });
    }

    let resolvedBranchCode;
    try {
        resolvedBranchCode = await resolveKbaBranchCode(bankName, kbaBranchCode);
    } catch (err) {
        return res.status(err.status || 400).json({ status: 'error', message: err.message });
    }

    const lengthError = checkLengthLimits({ surname, otherNames, nationalId, kraPin, bankName, kbaBranchCode: resolvedBranchCode, accountNumber, employeeType, email });
    if (lengthError) {
        return res.status(400).json({ status: 'error', message: lengthError });
    }

    const fullName = `${otherNames.trim()} ${surname.trim()}`.trim();

    try {
        const countResult = await pool.query(
            `SELECT COUNT(*) FROM employees WHERE company_id = $1`,
            [companyId]
        );
        const nextNumber = parseInt(countResult.rows[0].count, 10) + 1;
        const payrollNumber = `EMP${String(nextNumber).padStart(3, '0')}`;

        const queryText = `
            INSERT INTO employees (
                company_id, employee_type, full_name, surname, other_names, national_id, kra_pin, payroll_number,
                gross_salary, basic_salary, nssf_number, email,
                bank_name, kba_branch_code, account_number, car_benefit_value,
                house_benefit_value, insurance_premium, mortgage_interest, is_resident,
                has_disability_exemption, registered_pension_contribution, is_primary_employment, added_by
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)
            RETURNING *;
        `;

        const queryValues = [
            companyId,
            employeeType || 'REGULAR',
            fullName,
            surname.trim(),
            otherNames.trim(),
            nationalId,
            kraPin || null,
            payrollNumber,
            basicSalary || 0.00,   // gross_salary — legacy NOT NULL column, kept in sync
            basicSalary || 0.00,   // basic_salary — the real column calculators/index.js and the UI read
            nssfNumber || null,
            email || null,
            bankName || 'Unknown Bank',
            resolvedBranchCode,
            accountNumber,
            carBenefitValue || 0.00,
            houseBenefitValue || 0.00,
            insurancePremium || 0.00,
            mortgageInterest || 0.00,
            isResident === false ? false : true,
            hasDisabilityExemption === true ? true : false,
            registeredPensionContribution || 0.00,
            isPrimaryEmployment === false ? false : true,
            addedBy
        ];

        const result = await pool.query(queryText, queryValues);

        res.status(201).json({
            status: 'success',
            message: 'Employee saved.',
            data: result.rows[0]
        });

    } catch (error) {
        if (error.code === '23505') {
            return res.status(400).json({
                status: 'error',
                message: 'Database conflict: An employee with this National ID already exists.'
            });
        }
        if (error.code === '22001') {
            return res.status(400).json({
                status: 'error',
                message: 'One of the fields is longer than the database allows. Double-check KRA PIN, National ID, Branch Code, and Account Number for extra characters or spaces.'
            });
        }
        next(error);
    }
});

/**
 * @route   PUT /api/employees/:id
 * @desc    Updates an existing employee. This is the write-path the
 *          click-to-expand settings panel needs — previously the only way to
 *          write an employee was POST /add at creation, with no way to ever
 *          change anything afterward (KRA PIN typo, added SHA number, marked
 *          non-resident, added a relief, etc).
 * @access  Private
 */
router.put('/:id', protect, async (req, res, next) => {
    const {
        employeeType, surname, otherNames, nationalId, kraPin, basicSalary,
        bankName, kbaBranchCode, accountNumber, carBenefitValue, nssfNumber,
        houseBenefitValue, insurancePremium, mortgageInterest, isResident,
        hasDisabilityExemption, registeredPensionContribution, isPrimaryEmployment,
        shaNumber, email
    } = req.body;

    const companyId = req.user.companyId;

    const requiredError = checkRequiredFields({ surname, otherNames, nationalId, accountNumber, kbaBranchCode });
    if (requiredError) {
        return res.status(400).json({ status: 'error', message: requiredError });
    }

    let resolvedBranchCode;
    try {
        resolvedBranchCode = await resolveKbaBranchCode(bankName, kbaBranchCode);
    } catch (err) {
        return res.status(err.status || 400).json({ status: 'error', message: err.message });
    }

    const lengthError = checkLengthLimits({ surname, otherNames, nationalId, kraPin, bankName, kbaBranchCode: resolvedBranchCode, accountNumber, employeeType, email });
    if (lengthError) {
        return res.status(400).json({ status: 'error', message: lengthError });
    }

    const fullName = `${otherNames.trim()} ${surname.trim()}`.trim();

    try {
        const queryText = `
            UPDATE employees SET
                employee_type = $1, full_name = $2, surname = $3, other_names = $4,
                national_id = $5, kra_pin = $6, gross_salary = $7, basic_salary = $7,
                nssf_number = $8, nhif_or_sha_number = $9, bank_name = $10,
                kba_branch_code = $11, account_number = $12, car_benefit_value = $13,
                house_benefit_value = $14, insurance_premium = $15, mortgage_interest = $16,
                is_resident = $17, has_disability_exemption = $18,
                registered_pension_contribution = $19, is_primary_employment = $20,
                email = $21
            WHERE id = $22 AND company_id = $23
            RETURNING *;
        `;

        const queryValues = [
            employeeType || 'REGULAR',
            fullName,
            surname.trim(),
            otherNames.trim(),
            nationalId,
            kraPin || null,
            basicSalary || 0.00,
            nssfNumber || null,
            shaNumber || null,
            bankName || 'Unknown Bank',
            resolvedBranchCode,
            accountNumber,
            carBenefitValue || 0.00,
            houseBenefitValue || 0.00,
            insurancePremium || 0.00,
            mortgageInterest || 0.00,
            isResident === false ? false : true,
            hasDisabilityExemption === true ? true : false,
            registeredPensionContribution || 0.00,
            isPrimaryEmployment === false ? false : true,
            email || null,
            req.params.id,
            companyId
        ];

        const result = await pool.query(queryText, queryValues);

        if (result.rows.length === 0) {
            return res.status(404).json({
                status: 'error',
                message: 'Employee not found, or does not belong to your company.'
            });
        }

        res.status(200).json({
            status: 'success',
            message: 'Employee updated.',
            data: result.rows[0]
        });

    } catch (error) {
        if (error.code === '23505') {
            return res.status(400).json({
                status: 'error',
                message: 'Database conflict: Another employee already has this National ID.'
            });
        }
        if (error.code === '22001') {
            return res.status(400).json({
                status: 'error',
                message: 'One of the fields is longer than the database allows. Double-check KRA PIN, National ID, Branch Code, and Account Number for extra characters or spaces.'
            });
        }
        next(error);
    }
});

/**
 * @route   POST /api/employees/:id/archive
 * @desc    "Deletes" an employee WITHOUT actually deleting anything — every
 *          payroll_runs row calculated for them references employee_id, so
 *          a real DELETE would either fail (foreign key) or silently erase
 *          real payroll history. This just hides them going forward; every
 *          past payslip, P10 entry, and NSSF/SHIF filing stays exactly as
 *          it was, byte for byte.
 * @access  Private
 */
router.post('/:id/archive', protect, async (req, res, next) => {
    try {
        const result = await pool.query(
            `UPDATE employees SET is_archived = TRUE WHERE id = $1 AND company_id = $2 RETURNING *`,
            [req.params.id, req.user.companyId]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ status: 'error', message: 'Employee not found.' });
        }
        res.status(200).json({ status: 'success', message: 'Employee archived — this can be undone any time.', data: result.rows[0] });
    } catch (error) {
        next(error);
    }
});

/**
 * @route   POST /api/employees/:id/restore
 * @desc    Undoes an archive. Nothing was ever deleted, so this is instant
 *          and complete — no data to recover, it was never gone.
 * @access  Private
 */
router.post('/:id/restore', protect, async (req, res, next) => {
    try {
        const result = await pool.query(
            `UPDATE employees SET is_archived = FALSE WHERE id = $1 AND company_id = $2 RETURNING *`,
            [req.params.id, req.user.companyId]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ status: 'error', message: 'Employee not found.' });
        }
        res.status(200).json({ status: 'success', message: 'Employee restored.', data: result.rows[0] });
    } catch (error) {
        next(error);
    }
});

module.exports = router;