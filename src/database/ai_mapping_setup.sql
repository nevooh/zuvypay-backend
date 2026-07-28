-- Create a table to cache the successful AI-discovered column arrangements for each bank layout
CREATE TABLE IF NOT EXISTS company_bank_layouts (
    id SERIAL PRIMARY KEY,
    company_id INT REFERENCES companies(id) ON DELETE CASCADE,
    bank_name VARCHAR(100) NOT NULL,
    file_fingerprint VARCHAR(64) UNIQUE NOT NULL, -- Unique hash of headers to detect if same file is used again
    name_column_index INT NOT NULL,
    account_column_index INT NOT NULL,
    amount_column_index INT NOT NULL,
    kba_code_column_index INT DEFAULT -1,
    bank_name_column_index INT DEFAULT -1,
    national_id_column_index INT DEFAULT -1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
