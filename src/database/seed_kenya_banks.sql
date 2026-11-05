-- =====================================================================
-- Seed: kenya_banks (bank name + 2-digit KBA bank code)
-- Run AFTER schema.sql. Safe to run again.
--
-- Source stated in the supplied draft: Kenya Bankers Association bank
-- branch-code sheet (2022). Verify each institution's current bank and
-- branch codes before using generated files for real salary payments.
-- =====================================================================

INSERT INTO kenya_banks (bank_name, bank_code) VALUES
    ('Kenya Commercial Bank (KCB)', '01'),
    ('Standard Chartered Bank', '02'),
    ('Absa Bank Kenya', '03'),
    ('Bank of India', '05'),
    ('Bank of Baroda', '06'),
    ('NCBA Bank', '07'),
    ('Prime Bank', '10'),
    ('Co-operative Bank of Kenya', '11'),
    ('National Bank of Kenya', '12'),
    ('M-Oriental Bank', '14'),
    ('Citibank', '16'),
    ('Habib Bank AG Zurich', '17'),
    ('Middle East Bank Kenya', '18'),
    ('Bank of Africa Kenya', '19'),
    ('Consolidated Bank of Kenya', '23'),
    ('Credit Bank', '25'),
    ('Access Bank Kenya', '26'),
    ('Stanbic Bank Kenya', '31'),
    ('African Banking Corporation (ABC)', '35'),
    ('Ecobank Kenya', '43'),
    ('Spire Bank', '49'),
    ('Paramount Bank', '50'),
    ('Kingdom Bank', '51'),
    ('Guaranty Trust Bank (GTBank)', '53'),
    ('Victoria Commercial Bank', '54'),
    ('Guardian Bank', '55'),
    ('I&M Bank', '57'),
    ('Development Bank of Kenya', '59'),
    ('SBM Bank Kenya', '60'),
    ('Housing Finance Bank', '61'),
    ('Kenya Post Office Savings Bank (Postbank)', '62'),
    ('Diamond Trust Bank (DTB)', '63'),
    ('Mayfair Bank', '65'),
    ('Sidian Bank', '66'),
    ('Equity Bank', '68'),
    ('Family Bank', '70'),
    ('Gulf African Bank', '72'),
    ('First Community Bank', '74'),
    ('DIB Bank Kenya', '75'),
    ('UBA Kenya Bank', '76'),
    ('Kenya Women Microfinance Bank (KWFT)', '78'),
    ('Faulu Microfinance Bank', '79')
ON CONFLICT (bank_name) DO NOTHING;
