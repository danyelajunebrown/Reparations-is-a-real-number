/**
 * Descendant Calculator
 * Calculates debt inheritance for slaveowner descendants
 * and reparations credit for enslaved person descendants
 */

const crypto = require('crypto');

class DescendantCalculator {
    constructor(database, maxDepth = 10) {
        this.db = database;
        this.MAX_RECURSION_DEPTH = maxDepth; // FIXED: Prevent stack overflow
    }

    /**
     * Generate a unique enslaved individual ID
     */
    generateEnslavedId(fullName, birthYear = null) {
        const normalized = fullName.trim().toUpperCase().replace(/[^A-Z\s]/g, '');
        const parts = normalized.split(/\s+/);

        if (parts.length >= 2 && birthYear) {
            const firstName = parts[0].substring(0, 10);
            const lastName = parts[parts.length - 1].substring(0, 10);
            return `ENS_${firstName}_${lastName}_${birthYear}`;
        } else if (parts.length >= 1) {
            const firstName = parts[0].substring(0, 10);
            const hash = crypto.createHash('md5').update(fullName).digest('hex').substring(0, 6);
            return `ENS_${firstName}_${hash}`;
        } else {
            const hash = crypto.createHash('md5').update(fullName + Date.now()).digest('hex').substring(0, 12);
            return `ENS_${hash}`;
        }
    }

    /**
     * Create or find enslaved individual
     */
    async findOrCreateEnslavedIndividual(metadata) {
        const {
            fullName,
            birthYear,
            deathYear,
            gender,
            enslavedBy,
            freedomYear,
            directReparations,
            notes
        } = metadata;

        if (!fullName) {
            throw new Error('fullName is required');
        }

        // Try to find existing
        let existing = null;

        if (birthYear) {
            const result = await this.db.query(
                `SELECT enslaved_id FROM enslaved_individuals
                 WHERE full_name ILIKE $1 AND birth_year = $2
                 LIMIT 1`,
                [fullName, birthYear]
            );
            if (result.rows && result.rows.length > 0) {
                existing = result.rows[0];
            }
        }

        if (!existing) {
            const result = await this.db.query(
                `SELECT enslaved_id FROM enslaved_individuals
                 WHERE full_name ILIKE $1
                 LIMIT 1`,
                [fullName]
            );
            if (result.rows && result.rows.length > 0) {
                existing = result.rows[0];
            }
        }

        if (existing) {
            return existing.enslaved_id;
        }

        // Create new
        const enslavedId = this.generateEnslavedId(fullName, birthYear);

        await this.db.query(
            `INSERT INTO enslaved_individuals (
                enslaved_id, full_name, birth_year, death_year, gender,
                enslaved_by_individual_id, freedom_year, direct_reparations, notes
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (enslaved_id) DO NOTHING`,
            [
                enslavedId,
                fullName,
                birthYear || null,
                deathYear || null,
                gender || null,
                enslavedBy || null,
                freedomYear || null,
                directReparations || 0,
                notes || null
            ]
        );

        return enslavedId;
    }

    /**
     * Calculate debt for all descendants of a slaveowner
     * Recursively traverses the descendant tree
     */
    async calculateDescendantDebt(perpetratorId, originalDebt) {
        console.log(`Calculating debt for descendants of ${perpetratorId}, original debt: $${originalDebt}`);

        // Get all children of the perpetrator
        const children = await this.db.query(
            `SELECT individual_id_2 as child_id
             FROM individual_relationships
             WHERE individual_id_1 = $1
               AND relationship_type = 'parent-child'
               AND is_directed = true`,
            [perpetratorId]
        );

        if (!children.rows || children.rows.length === 0) {
            console.log(`No descendants found for ${perpetratorId}`);
            return [];
        }

        const childCount = children.rows.length;

        // FIXED: Check for division by zero
        if (childCount === 0) {
            return [];
        }

        const debtPerChild = originalDebt / childCount;

        const debtRecords = [];

        for (const child of children.rows) {
            const childId = child.child_id;

            // Create debt record for this child
            await this.db.query(
                `INSERT INTO descendant_debt (
                    descendant_individual_id,
                    perpetrator_individual_id,
                    generation_distance,
                    original_debt,
                    inherited_portion,
                    inheritance_factor,
                    amount_outstanding
                ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT DO NOTHING`,
                [
                    childId,
                    perpetratorId,
                    1, // first generation
                    originalDebt,
                    debtPerChild,
                    1.0 / childCount,
                    debtPerChild
                ]
            );

            debtRecords.push({
                descendantId: childId,
                generation: 1,
                debt: debtPerChild
            });

            // FIXED: Check depth limit before recursing
            if (1 < this.MAX_RECURSION_DEPTH) {
                // Recursively calculate for grandchildren
                const grandchildrenDebt = await this.calculateDescendantDebtRecursive(
                    childId,
                    perpetratorId,
                    debtPerChild,
                    2
                );

                debtRecords.push(...grandchildrenDebt);
            } else {
                console.warn(`Max recursion depth reached at generation 1 for ${childId}`);
            }
        }

        return debtRecords;
    }

    /**
     * Recursive helper for calculating descendant debt
     */
    async calculateDescendantDebtRecursive(parentId, originalPerpetratorId, parentDebt, generation) {
        // FIXED: Check depth limit
        if (generation > this.MAX_RECURSION_DEPTH) {
            console.warn(`Max recursion depth ${this.MAX_RECURSION_DEPTH} reached, stopping at generation ${generation}`);
            return [];
        }

        // Get children of this parent
        const children = await this.db.query(
            `SELECT individual_id_2 as child_id
             FROM individual_relationships
             WHERE individual_id_1 = $1
               AND relationship_type = 'parent-child'
               AND is_directed = true`,
            [parentId]
        );

        if (!children.rows || children.rows.length === 0) {
            return [];
        }

        const childCount = children.rows.length;

        // FIXED: Check for division by zero
        if (childCount === 0) {
            return [];
        }

        const debtPerChild = parentDebt / childCount;
        const debtRecords = [];

        for (const child of children.rows) {
            const childId = child.child_id;

            // Create debt record
            await this.db.query(
                `INSERT INTO descendant_debt (
                    descendant_individual_id,
                    perpetrator_individual_id,
                    generation_distance,
                    original_debt,
                    inherited_portion,
                    inheritance_factor,
                    amount_outstanding
                ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT DO NOTHING`,
                [
                    childId,
                    originalPerpetratorId,
                    generation,
                    parentDebt,
                    debtPerChild,
                    1.0 / childCount,
                    debtPerChild
                ]
            );

            debtRecords.push({
                descendantId: childId,
                generation,
                debt: debtPerChild
            });

            // FIXED: Check depth before continuing
            if (generation < this.MAX_RECURSION_DEPTH) {
                // Continue recursively
                const nextGenDebt = await this.calculateDescendantDebtRecursive(
                    childId,
                    originalPerpetratorId,
                    debtPerChild,
                    generation + 1
                );

                debtRecords.push(...nextGenDebt);
            }
        }

        return debtRecords;
    }

    /**
     * Calculate reparations credit for all descendants of an enslaved person
     */
    async calculateReparationsCredit(ancestorId, originalCredit) {
        console.log(`Calculating reparations for descendants of ${ancestorId}, original credit: $${originalCredit}`);

        // Get all children
        const children = await this.db.query(
            `SELECT enslaved_id_2 as child_id
             FROM enslaved_relationships
             WHERE enslaved_id_1 = $1
               AND relationship_type = 'parent-child'
               AND is_directed = true`,
            [ancestorId]
        );

        if (!children.rows || children.rows.length === 0) {
            console.log(`No descendants found for ${ancestorId}`);
            return [];
        }

        const childCount = children.rows.length;

        // FIXED: Check for division by zero
        if (childCount === 0) {
            return [];
        }

        const creditPerChild = originalCredit / childCount;
        const creditRecords = [];

        for (const child of children.rows) {
            const childId = child.child_id;

            // Create credit record
            await this.db.query(
                `INSERT INTO reparations_credit (
                    descendant_enslaved_id,
                    ancestor_enslaved_id,
                    generation_distance,
                    original_credit,
                    inherited_portion,
                    inheritance_factor,
                    amount_outstanding
                ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT DO NOTHING`,
                [
                    childId,
                    ancestorId,
                    1,
                    originalCredit,
                    creditPerChild,
                    1.0 / childCount,
                    creditPerChild
                ]
            );

            creditRecords.push({
                descendantId: childId,
                generation: 1,
                credit: creditPerChild
            });

            // FIXED: Check depth limit before recursing
            if (1 < this.MAX_RECURSION_DEPTH) {
                // Recursively calculate for grandchildren
                const grandchildrenCredit = await this.calculateReparationsCreditRecursive(
                    childId,
                    ancestorId,
                    creditPerChild,
                    2
                );

                creditRecords.push(...grandchildrenCredit);
            } else {
                console.warn(`Max recursion depth reached at generation 1 for ${childId}`);
            }
        }

        return creditRecords;
    }

    /**
     * Recursive helper for calculating reparations credit
     */
    async calculateReparationsCreditRecursive(parentId, originalAncestorId, parentCredit, generation) {
        // FIXED: Check depth limit
        if (generation > this.MAX_RECURSION_DEPTH) {
            console.warn(`Max recursion depth ${this.MAX_RECURSION_DEPTH} reached, stopping at generation ${generation}`);
            return [];
        }

        const children = await this.db.query(
            `SELECT enslaved_id_2 as child_id
             FROM enslaved_relationships
             WHERE enslaved_id_1 = $1
               AND relationship_type = 'parent-child'
               AND is_directed = true`,
            [parentId]
        );

        if (!children.rows || children.rows.length === 0) {
            return [];
        }

        const childCount = children.rows.length;

        // FIXED: Check for division by zero
        if (childCount === 0) {
            return [];
        }

        const creditPerChild = parentCredit / childCount;
        const creditRecords = [];

        for (const child of children.rows) {
            const childId = child.child_id;

            await this.db.query(
                `INSERT INTO reparations_credit (
                    descendant_enslaved_id,
                    ancestor_enslaved_id,
                    generation_distance,
                    original_credit,
                    inherited_portion,
                    inheritance_factor,
                    amount_outstanding
                ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT DO NOTHING`,
                [
                    childId,
                    originalAncestorId,
                    generation,
                    parentCredit,
                    creditPerChild,
                    1.0 / childCount,
                    creditPerChild
                ]
            );

            creditRecords.push({
                descendantId: childId,
                generation,
                credit: creditPerChild
            });

            // FIXED: Check depth before continuing
            if (generation < this.MAX_RECURSION_DEPTH) {
                const nextGenCredit = await this.calculateReparationsCreditRecursive(
                    childId,
                    originalAncestorId,
                    creditPerChild,
                    generation + 1
                );

                creditRecords.push(...nextGenCredit);
            }
        }

        return creditRecords;
    }

    /**
     * Record a blockchain payment
     */
    async recordPayment(payerId, recipientId, amount, txHash, blockNumber, networkId) {
        // Find matching debt and credit records
        const debtResult = await this.db.query(
            `SELECT id FROM descendant_debt
             WHERE descendant_individual_id = $1
               AND amount_outstanding > 0
             ORDER BY amount_outstanding DESC
             LIMIT 1`,
            [payerId]
        );

        const creditResult = await this.db.query(
            `SELECT id FROM reparations_credit
             WHERE descendant_enslaved_id = $1
               AND amount_outstanding > 0
             ORDER BY amount_outstanding DESC
             LIMIT 1`,
            [recipientId]
        );

        const debtId = debtResult.rows && debtResult.rows.length > 0 ? debtResult.rows[0].id : null;
        const creditId = creditResult.rows && creditResult.rows.length > 0 ? creditResult.rows[0].id : null;

        // Record the payment
        const paymentResult = await this.db.query(
            `INSERT INTO payment_ledger (
                payment_type,
                amount,
                payer_individual_id,
                recipient_enslaved_id,
                descendant_debt_id,
                reparations_credit_id,
                blockchain_tx_hash,
                blockchain_block_number,
                blockchain_network_id
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING id`,
            [
                'reparations_payment',
                amount,
                payerId,
                recipientId,
                debtId,
                creditId,
                txHash,
                blockNumber,
                networkId
            ]
        );

        // Update debt and credit records
        if (debtId) {
            await this.db.query(
                `UPDATE descendant_debt
                 SET amount_paid = amount_paid + $1,
                     amount_outstanding = amount_outstanding - $1,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE id = $2`,
                [amount, debtId]
            );
        }

        if (creditId) {
            await this.db.query(
                `UPDATE reparations_credit
                 SET amount_received = amount_received + $1,
                     amount_outstanding = amount_outstanding - $1,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE id = $2`,
                [amount, creditId]
            );
        }

        return paymentResult.rows[0].id;
    }

    /**
     * Get total debt for an individual
     */
    async getTotalDebt(individualId) {
        const result = await this.db.query(
            `SELECT SUM(amount_outstanding) as total_debt
             FROM descendant_debt
             WHERE descendant_individual_id = $1`,
            [individualId]
        );

        return result.rows && result.rows.length > 0 ? parseFloat(result.rows[0].total_debt || 0) : 0;
    }

    /**
     * Get total credit for an enslaved individual descendant
     */
    async getTotalCredit(enslavedId) {
        const result = await this.db.query(
            `SELECT SUM(amount_outstanding) as total_credit
             FROM reparations_credit
             WHERE descendant_enslaved_id = $1`,
            [enslavedId]
        );

        return result.rows && result.rows.length > 0 ? parseFloat(result.rows[0].total_credit || 0) : 0;
    }
}

module.exports = DescendantCalculator;
