const calculateNSSF = require('./nssfCalculator');
const calculateSHIF = require('./shifCalculator');
const calculateHousingLevy = require('./housingLevyCalculator');
const calculatePAYE = require('./payeCalculator');

/**
 * Enterprise Payroll Engine for Kenya.
 * Calculates employee taxes, employer matches, reliefs, and total cost of employment.
 */
function calculateEnterprisePayroll(employee, customPayments = []) {
    const isDirector = employee.employee_type === 'NON_EXECUTIVE_DIRECTOR';
    const isResident = employee.is_resident !== false;
    const hasDisabilityExemption = employee.has_disability_exemption === true;
    const basicPay = Number(employee.basic_salary) || 0;

    // 1. Process Custom Payments (Allowances vs Deductions)
    let totalTaxableAllowances = 0;
    let totalNonTaxableAllowances = 0;
    let postTaxDeductions = 0;

    customPayments.forEach(item => {
        const amount = Number(item.amount) || 0;
        if (item.type_category === 'ALLOWANCE') {
            if (item.is_taxable) {
                totalTaxableAllowances += amount;
            } else {
                totalNonTaxableAllowances += amount;
            }
        } else if (item.type_category === 'DEDUCTION') {
            postTaxDeductions += amount;
        }
    });

    const totalCashAllowances = totalTaxableAllowances + totalNonTaxableAllowances;
    const grossSalary = basicPay + totalCashAllowances;

    // --- CASE A: NON-EXECUTIVE DIRECTORS (Flat Withholding Tax) ---
    if (isDirector) {
        const whtRate = isResident ? 0.05 : 0.20;
        const totalDirectorFees = basicPay + totalTaxableAllowances;
        const withholdingTax = Math.round((totalDirectorFees * whtRate) * 100) / 100;
        const totalDeductions = withholdingTax + postTaxDeductions;
        const netPay = Math.round((grossSalary - totalDeductions) * 100) / 100;

        // Same key shape as the regular-employee return below, on purpose —
        // anything reading this (the save logic, the employee detail modal)
        // shouldn't need to special-case directors just to find a number.
        return {
            employeeType: 'NON_EXECUTIVE_DIRECTOR',
            isResident,
            isPrimaryEmployment: employee.is_primary_employment !== false,
            metrics: {
                basicPaySnapshot: basicPay,
                allowancesSnapshot: totalCashAllowances,
                nonCashBenefitsSnapshot: 0,
                grossSalary,
                taxableIncomeBeforeBrackets: totalDirectorFees,
                netPay
            },
            employeeDeductions: {
                nssf: 0,
                shif: 0,
                housingLevy: 0,
                mortgageReliefApplied: 0,
                pensionReliefApplied: 0,
                insuranceReliefApplied: 0,
                payeTax: 0,
                withholdingTaxApplied: withholdingTax,
                postTaxDeductions,
                totalDeductions
            },
            employerContributions: { matchedNssf: 0, matchedHousingLevy: 0, totalEmployerContribution: 0 },
            totalCostToCompany: grossSalary
        };
    }

    // --- CASE B: REGULAR EMPLOYEES (Full Comprehensive Framework) ---
    const nssf = calculateNSSF(grossSalary);
    const shif = calculateSHIF(grossSalary);
    const housingLevy = calculateHousingLevy(grossSalary);

    // Employer Matching Obligations
    const employerNssfMatch = nssf; // Matches employee token dollar for dollar
    const employerHousingLevyMatch = housingLevy; // Matches employee 1.5%

    const carBenefit = Number(employee.car_benefit_value) || 0;
    const houseBenefit = Number(employee.house_benefit_value) || 0;
    const nonCashBenefits = carBenefit + houseBenefit;

    // KRA Pre-Tax Statutory Shield Calculation
    let taxableIncome = (grossSalary + nonCashBenefits) - nssf - shif - housingLevy;

    // Apply Mortgage Interest Relief (Upgraded KES 30,000 cap)
    const mortgageInterest = Number(employee.mortgage_interest) || 0;
    const appliedMortgageRelief = Math.min(mortgageInterest, 30000);
    taxableIncome = Math.max(0, taxableIncome - appliedMortgageRelief);

    // Apply Registered Pension Scheme Contribs if present (KRA cap raised to KES 30,000/month
    // effective 27 December 2024, per the Tax Laws (Amendment) Act, 2024)
    const registeredPension = Number(employee.registered_pension_contribution) || 0;
    const appliedPensionDeduction = Math.min(registeredPension, 30000);
    taxableIncome = Math.max(0, taxableIncome - appliedPensionDeduction);

    // Personal Relief applies only to RESIDENT employees in their PRIMARY employment.
    // Non-residents and secondary-job employees get neither.
    const isPrimaryEmployment = employee.is_primary_employment !== false;
    const reliefEligible = isResident && isPrimaryEmployment;

    // Calculate base progressive PAYE
    let basePAYE = calculatePAYE(taxableIncome, reliefEligible);

    // Apply Disability Tax Exemption Rule (First KES 150,000/month is tax-free)
    if (hasDisabilityExemption) {
        // Recalculate tax ONLY on the portion exceeding KES 150,000
        const exemptTaxableIncome = Math.max(0, taxableIncome - 150000);
        basePAYE = calculatePAYE(exemptTaxableIncome, reliefEligible);
    }

    // Apply Insurance Relief (15% of premium, capped at KES 5,000/month)
    let appliedInsuranceRelief = 0;
    if (isResident && !hasDisabilityExemption) {
        const insurancePremium = Number(employee.insurance_premium) || 0;
        const calculatedInsuranceRelief = Math.round((insurancePremium * 0.15) * 100) / 100;
        appliedInsuranceRelief = Math.min(calculatedInsuranceRelief, 5000);
    }

    const finalPAYE = Math.max(0, basePAYE - appliedInsuranceRelief);

    // Totals Compile
    const totalDeductions = Math.round((nssf + shif + housingLevy + finalPAYE + postTaxDeductions) * 100) / 100;
    const netPay = Math.round((grossSalary - totalDeductions) * 100) / 100;

    const totalEmployerContribution = Math.round((employerNssfMatch + employerHousingLevyMatch) * 100) / 100;
    const totalCostToCompany = Math.round((grossSalary + totalEmployerContribution) * 100) / 100;

    return {
        employeeType: 'REGULAR',
        isResident,
        isPrimaryEmployment,
        metrics: {
            basicPaySnapshot: basicPay,
            allowancesSnapshot: totalCashAllowances,
            nonCashBenefitsSnapshot: nonCashBenefits,
            grossSalary,
            taxableIncomeBeforeBrackets: taxableIncome,
            netPay
        },
        employeeDeductions: {
            nssf,
            shif,
            housingLevy,
            mortgageReliefApplied: appliedMortgageRelief,
            pensionReliefApplied: appliedPensionDeduction,
            insuranceReliefApplied: appliedInsuranceRelief,
            payeTax: finalPAYE,
            withholdingTaxApplied: 0,
            postTaxDeductions,
            totalDeductions
        },
        employerContributions: {
            matchedNssf: employerNssfMatch,
            matchedHousingLevy: employerHousingLevyMatch,
            totalEmployerContribution
        },
        totalCostToCompany
    };
}

module.exports = calculateEnterprisePayroll;