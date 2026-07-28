-- 1. Create Companies Table
CREATE TABLE IF NOT EXISTS companies (
    id SERIAL PRIMARY KEY,
    company_name VARCHAR(100) NOT NULL,
    kra_pin VARCHAR(11) UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Create Users Table (Multi-Admin & Roles)
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    company_id INT REFERENCES companies(id) ON DELETE CASCADE,
    full_name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) DEFAULT 'Manager', -- 'Owner' or 'Manager'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Create Employees Table (Banking & Tracking)
CREATE TABLE IF NOT EXISTS employees (
    id SERIAL PRIMARY KEY,
    company_id INT REFERENCES companies(id) ON DELETE CASCADE,
    full_name VARCHAR(100) NOT NULL,
    national_id VARCHAR(20) UNIQUE NOT NULL,
    gross_salary DECIMAL(12, 2) NOT NULL,
    bank_name VARCHAR(50) NOT NULL,       -- Selected from your UI dropdown
    kba_branch_code VARCHAR(5) NOT NULL,   -- The 5-digit bank clearing code
    account_number VARCHAR(30) NOT NULL,
    added_by INT REFERENCES users(id) ON DELETE SET NULL, -- Track who added them
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. Create Payroll Runs Table
CREATE TABLE IF NOT EXISTS payroll_runs (
    id SERIAL PRIMARY KEY,
    employee_id INT REFERENCES employees(id) ON DELETE CASCADE,
    payroll_month INT NOT NULL,  -- e.g., 7 for July
    payroll_year INT NOT NULL,   -- e.g., 2026
    gross_pay DECIMAL(12, 2) NOT NULL,
    nssf_deduction DECIMAL(12, 2) NOT NULL,
    shif_deduction DECIMAL(12, 2) NOT NULL,
    housing_levy DECIMAL(12, 2) NOT NULL,
    paye_tax DECIMAL(12, 2) NOT NULL,
    net_pay DECIMAL(12, 2) NOT NULL,
    payment_status VARCHAR(20) DEFAULT 'PENDING', -- 'PENDING', 'PAID'
    calculated_by INT REFERENCES users(id) ON DELETE SET NULL, -- Track who ran payroll
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 5. Create Audit Logs Table (The Security Black Box)
CREATE TABLE IF NOT EXISTS audit_logs (
    id SERIAL PRIMARY KEY,
    company_id INT REFERENCES companies(id) ON DELETE CASCADE,
    user_id INT REFERENCES users(id) ON DELETE SET NULL,
    action_performed VARCHAR(100) NOT NULL, -- e.g., 'CREATED_EMPLOYEE'
    details TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
