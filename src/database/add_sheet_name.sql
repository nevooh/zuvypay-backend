-- Run this once against your existing database — adds the sheet_name column
-- needed now that templates can have multiple sheets (not just sheet 0).
ALTER TABLE company_bank_layouts
ADD COLUMN IF NOT EXISTS sheet_name VARCHAR(150) NOT NULL DEFAULT 'Sheet1';