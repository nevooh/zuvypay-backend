-- 1. Upgrade Employees Table with Core Structural Enterprise Fields
ALTER TABLE employees 
    ADD COLUMN employee_type VARCHAR(30) DEFAULT 'REGULAR',      -- 'REGULAR' or 'NON_EXECUTIVE_DIRECTOR'
    ADD COLUMN basic_salary DECIMAL(12, 2) DEFAULT 0.00,
    ADD COLUMN car_benefit_value DECIMAL(12, 2) DEFAULT 0.00,    -- Non-Cash Benefit
    ADD COLUMN house_benefit_value DECIMAL(12, 2) DEFAULT 0.00,  -- Non-Cash Benefit
    ADD COLUMN insurance_premium DECIMAL(12, 2) DEFAULT 0.00,    -- For Insurance Relief
    ADD COLUMN mortgage_interest DECIMAL(12, 2) DEFAULT 0.00;    -- For Mortgage Relief

-- 2. Create the Master Custom Payment Dictionary Table
CREATE TABLE IF NOT EXISTS company_payment_types (
    id SERIAL PRIMARY KEY,
    company_id INT REFERENCES companies(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,                                  -- e.g., 'Friday Tea Allowance', 'Uniform Fee'
    type_category VARCHAR(20) NOT NULL,                          -- 'ALLOWANCE' or 'DEDUCTION'
    is_taxable BOOLEAN DEFAULT TRUE,                             -- KRA tax status indicator
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Link Custom Payments Directly to Employees with Fixed Amounts
CREATE TABLE IF NOT EXISTS employee_recurring_payments (
    id SERIAL PRIMARY KEY,
    employee_id INT REFERENCES employees(id) ON DELETE CASCADE,
    payment_type_id INT REFERENCES company_payment_types(id) ON DELETE CASCADE,
    amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. Upgrade Payroll Runs Table to Hold Comprehensive Snapshots for Payslips & WHT
ALTER TABLE payroll_runs 
    ADD COLUMN basic_pay_snapshot DECIMAL(12, 2) DEFAULT 0.00,
    ADD COLUMN allowances_snapshot DECIMAL(12, 2) DEFAULT 0.00,
    ADD COLUMN non_cash_benefits_snapshot DECIMAL(12, 2) DEFAULT 0.00,
    ADD COLUMN insurance_relief_applied DECIMAL(12, 2) DEFAULT 0.00,
    ADD COLUMN withholding_tax_applied DECIMAL(12, 2) DEFAULT 0.00; -- For Non-Executive Directors (5% WHT)
