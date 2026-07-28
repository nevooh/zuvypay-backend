-- Add a residency flag to the employees table to differentiate tax rules
ALTER TABLE employees 
    ADD COLUMN is_resident BOOLEAN DEFAULT TRUE;
