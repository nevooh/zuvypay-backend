-- =====================================================================
-- ZuvyPay / Kenya Payroll — FULL DATABASE SCHEMA (rebuilt from the code)
-- PostgreSQL. Safe to run more than once (IF NOT EXISTS everywhere).
--
-- Rebuilt by reading every query in zuvypay-backend-main/src and
-- server.js. It replaces: init.sql, enterprise_setup.sql,
-- add_residency.sql, add_sheet_name.sql, add_company_nssf_number.sql,
-- add_employee_nssf_number.sql and ai_mapping_setup.sql — plus all
-- columns/tables added straight in the database and never saved to a file.
--
-- Run order: 1) this file 2) seed_kenya_banks.sql
-- =====================================================================

CREATE TABLE IF NOT EXISTS companies (
    id SERIAL PRIMARY KEY,
    company_name VARCHAR(100) NOT NULL,
    kra_pin VARCHAR(11) UNIQUE,
    nssf_number VARCHAR(30),
    sha_number VARCHAR(30),
    selected_bank VARCHAR(100),
    bank_branch_code VARCHAR(10),
    bank_account_number VARCHAR(30),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    company_id INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    full_name VARCHAR(100) NOT NULL,
    email VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'Staff',
    otp_code VARCHAR(6),
    otp_expires_at TIMESTAMPTZ,
    is_verified BOOLEAN NOT NULL DEFAULT FALSE,
    failed_login_attempts INT NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS kenya_banks (
    id SERIAL PRIMARY KEY,
    bank_name VARCHAR(50) NOT NULL UNIQUE,
    bank_code VARCHAR(2) NOT NULL CHECK (bank_code ~ '^[0-9]{2}$')
);

CREATE TABLE IF NOT EXISTS employees (
    id SERIAL PRIMARY KEY,
    company_id INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    employee_type VARCHAR(30) NOT NULL DEFAULT 'REGULAR',
    full_name VARCHAR(255) NOT NULL,
    surname VARCHAR(100) NOT NULL,
    other_names VARCHAR(100) NOT NULL,
    national_id VARCHAR(20) NOT NULL,
    identity_type VARCHAR(30) DEFAULT 'National ID',
    kra_pin VARCHAR(11),
    payroll_number VARCHAR(20),
    nssf_number VARCHAR(20),
    nhif_or_sha_number VARCHAR(30),
    email VARCHAR(100),
    phone VARCHAR(20),
    gross_salary DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    basic_salary DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    car_benefit_value DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    house_benefit_value DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    insurance_premium DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    mortgage_interest DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    registered_pension_contribution DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    is_resident BOOLEAN NOT NULL DEFAULT TRUE,
    has_disability_exemption BOOLEAN NOT NULL DEFAULT FALSE,
    is_primary_employment BOOLEAN NOT NULL DEFAULT TRUE,
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    bank_name VARCHAR(50) NOT NULL,
    kba_branch_code VARCHAR(5) NOT NULL,
    account_number VARCHAR(30) NOT NULL,
    added_by INT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS company_payment_types (
    id SERIAL PRIMARY KEY,
    company_id INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    type_category VARCHAR(20) NOT NULL CHECK (type_category IN ('ALLOWANCE', 'DEDUCTION')),
    is_taxable BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS employee_recurring_payments (
    id SERIAL PRIMARY KEY,
    employee_id INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    payment_type_id INT NOT NULL REFERENCES company_payment_types(id) ON DELETE RESTRICT,
    amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS payroll_periods (
    id SERIAL PRIMARY KEY,
    company_id INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    payroll_month INT NOT NULL CHECK (payroll_month BETWEEN 1 AND 12),
    payroll_year INT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PAID', 'EXPIRED')),
    is_correction BOOLEAN NOT NULL DEFAULT FALSE,
    correction_of INT REFERENCES payroll_periods(id) ON DELETE SET NULL,
    confirmed_by INT REFERENCES users(id) ON DELETE SET NULL,
    confirmed_at TIMESTAMPTZ,
    paid_at TIMESTAMPTZ,
    paid_by INT REFERENCES users(id) ON DELETE SET NULL,
    amount_due DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    employee_count INT NOT NULL DEFAULT 0,
    intasend_invoice_id VARCHAR(100),
    phone_number VARCHAR(20),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS payroll_runs (
    id SERIAL PRIMARY KEY,
    period_id INT REFERENCES payroll_periods(id) ON DELETE CASCADE,
    employee_id INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    payroll_month INT NOT NULL,
    payroll_year INT NOT NULL,
    gross_pay DECIMAL(12,2) NOT NULL,
    nssf_deduction DECIMAL(12,2) NOT NULL,
    shif_deduction DECIMAL(12,2) NOT NULL,
    housing_levy DECIMAL(12,2) NOT NULL,
    paye_tax DECIMAL(12,2) NOT NULL,
    net_pay DECIMAL(12,2) NOT NULL,
    basic_pay_snapshot DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    allowances_snapshot DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    non_cash_benefits_snapshot DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    insurance_relief_applied DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    withholding_tax_applied DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    mortgage_relief_applied DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    pension_relief_applied DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    taxable_income DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    payment_status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (payment_status IN ('PENDING', 'PAID')),
    calculated_by INT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (period_id, employee_id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id SERIAL PRIMARY KEY,
    company_id INT REFERENCES companies(id) ON DELETE CASCADE,
    user_id INT REFERENCES users(id) ON DELETE SET NULL,
    action_performed VARCHAR(100) NOT NULL,
    details TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bank_layout_submissions (
    id SERIAL PRIMARY KEY,
    bank_name VARCHAR(100) NOT NULL,
    submitted_by_company_id INT REFERENCES companies(id) ON DELETE SET NULL,
    file_fingerprint VARCHAR(64) NOT NULL,
    file_storage_key VARCHAR(255) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reviewed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS company_bank_layouts (
    id SERIAL PRIMARY KEY,
    company_id INT REFERENCES companies(id) ON DELETE CASCADE,
    bank_name VARCHAR(100) NOT NULL,
    file_fingerprint VARCHAR(64) UNIQUE NOT NULL,
    name_column_index INT NOT NULL,
    account_column_index INT NOT NULL,
    amount_column_index INT NOT NULL,
    kba_code_column_index INT DEFAULT -1,
    bank_name_column_index INT DEFAULT -1,
    national_id_column_index INT DEFAULT -1,
    sheet_name VARCHAR(150) NOT NULL DEFAULT 'Sheet1',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Heal older databases where CREATE TABLE IF NOT EXISTS would skip missing columns.
ALTER TABLE users ADD COLUMN IF NOT EXISTS otp_code VARCHAR(6);
ALTER TABLE users ADD COLUMN IF NOT EXISTS otp_expires_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_attempts INT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;

ALTER TABLE companies ADD COLUMN IF NOT EXISTS nssf_number VARCHAR(30);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS sha_number VARCHAR(30);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS selected_bank VARCHAR(100);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS bank_branch_code VARCHAR(10);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS bank_account_number VARCHAR(30);

ALTER TABLE employees ADD COLUMN IF NOT EXISTS employee_type VARCHAR(30) NOT NULL DEFAULT 'REGULAR';
ALTER TABLE employees ADD COLUMN IF NOT EXISTS surname VARCHAR(100);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS other_names VARCHAR(100);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS identity_type VARCHAR(30) DEFAULT 'National ID';
ALTER TABLE employees ADD COLUMN IF NOT EXISTS kra_pin VARCHAR(11);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS payroll_number VARCHAR(20);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS nssf_number VARCHAR(20);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS nhif_or_sha_number VARCHAR(30);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS email VARCHAR(100);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS phone VARCHAR(20);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS basic_salary DECIMAL(12,2) NOT NULL DEFAULT 0.00;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS car_benefit_value DECIMAL(12,2) NOT NULL DEFAULT 0.00;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS house_benefit_value DECIMAL(12,2) NOT NULL DEFAULT 0.00;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS insurance_premium DECIMAL(12,2) NOT NULL DEFAULT 0.00;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS mortgage_interest DECIMAL(12,2) NOT NULL DEFAULT 0.00;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS registered_pension_contribution DECIMAL(12,2) NOT NULL DEFAULT 0.00;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS is_resident BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS has_disability_exemption BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS is_primary_employment BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS period_id INT REFERENCES payroll_periods(id) ON DELETE CASCADE;
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS basic_pay_snapshot DECIMAL(12,2) NOT NULL DEFAULT 0.00;
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS allowances_snapshot DECIMAL(12,2) NOT NULL DEFAULT 0.00;
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS non_cash_benefits_snapshot DECIMAL(12,2) NOT NULL DEFAULT 0.00;
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS insurance_relief_applied DECIMAL(12,2) NOT NULL DEFAULT 0.00;
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS withholding_tax_applied DECIMAL(12,2) NOT NULL DEFAULT 0.00;
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS mortgage_relief_applied DECIMAL(12,2) NOT NULL DEFAULT 0.00;
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS pension_relief_applied DECIMAL(12,2) NOT NULL DEFAULT 0.00;
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS taxable_income DECIMAL(12,2) NOT NULL DEFAULT 0.00;

ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_national_id_key;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employees_company_national_id_key') THEN
        ALTER TABLE employees
            ADD CONSTRAINT employees_company_national_id_key UNIQUE (company_id, national_id);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_users_company ON users (company_id);
CREATE INDEX IF NOT EXISTS idx_employees_company ON employees (company_id, is_archived);
CREATE INDEX IF NOT EXISTS idx_payment_types_company ON company_payment_types (company_id);
CREATE INDEX IF NOT EXISTS idx_recurring_employee ON employee_recurring_payments (employee_id);
CREATE INDEX IF NOT EXISTS idx_recurring_type ON employee_recurring_payments (payment_type_id);
CREATE INDEX IF NOT EXISTS idx_periods_company_month ON payroll_periods (company_id, payroll_year, payroll_month, status);
CREATE INDEX IF NOT EXISTS idx_periods_invoice ON payroll_periods (intasend_invoice_id);
CREATE INDEX IF NOT EXISTS idx_runs_period ON payroll_runs (period_id);
CREATE INDEX IF NOT EXISTS idx_runs_employee ON payroll_runs (employee_id);
CREATE INDEX IF NOT EXISTS idx_audit_company ON audit_logs (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bank_subs_bank_status ON bank_layout_submissions (bank_name, status);
