# Project Brief: Reparations Is A Real Number

## Project Vision

A blockchain-based reparations platform that transforms historical injustice into quantifiable, actionable restitution by processing historical documents, identifying enslaved ancestors, calculating descendant reparations, and managing payments through Ethereum smart contracts.

## Core Mission

To provide a transparent, immutable, and mathematically rigorous system for:
1. **Document Processing:** OCR and extraction of enslaved persons' data from historical records
2. **Genealogical Tracking:** Integration with FamilySearch and Ancestry APIs to identify descendants
3. **Economic Calculation:** Inflation-adjusted reparations calculations with compound interest
4. **Payment Distribution:** Blockchain-based escrow and distribution to verified descendants

## Project Goals

### Primary Goals
- Process historical documents (wills, bills of sale, census records) to extract enslaved persons' names
- Calculate fair reparations based on economic models (wage theft, damages, compound interest)
- Track slaveowner debts across inheritance chains
- Distribute payments to verified descendants via Ethereum smart contracts

### Success Metrics
- Number of historical documents processed
- Number of enslaved ancestors identified
- Number of descendants verified and connected
- Total reparations calculated
- Successful blockchain transactions completed

## Target Users

1. **Descendants of Enslaved Persons:** Primary beneficiaries seeking reparations
2. **Genealogical Researchers:** Accessing historical records and building family trees
3. **Historians:** Contributing documents and verifying data
4. **Legal Advocates:** Building cases for institutional reparations

## Key Constraints

- **Historical Data Quality:** OCR accuracy varies with document condition (1700s-1800s handwriting)
- **Genealogical Verification:** Requires integration with third-party APIs (FamilySearch, Ancestry)
- **Blockchain Costs:** Ethereum gas fees for transactions
- **Legal Complexity:** Reparations calculations must be defensible and transparent
- **Data Sensitivity:** Handling personal information and family histories with care

## Critical Decisions

1. **Storage Architecture:** Migrated from ephemeral Render filesystem to AWS S3 for persistence
2. **File Type Detection:** Implemented content-based detection (magic numbers) vs extension-based
3. **Database:** PostgreSQL with complex schema for relationships and calculations
4. **Smart Contracts:** Ethereum with escrow pattern for payment distribution
5. **OCR Strategy:** Google Vision API (preferred) with Tesseract.js fallback

## Non-Goals

- This is NOT a political advocacy platform
- This is NOT a social media platform
- This is NOT focused on legislative reparations (focuses on individual restitution)
- This is NOT a general genealogy platform (reparations-specific)

## Project Status

**Current Phase:** Production Deployment & Document Processing
**Last Major Update:** November 29, 2025 - Fixed deployment issues, implemented S3 storage, file type detection

---

*This document is the source of truth for the Reparations Platform project.*
