/**
 * Conversational Family Tree Builder
 * Guides users through building multi-generation family trees
 * No coding required - just answer questions!
 */

class TreeBuilderConversation {
    constructor(database) {
        this.database = database;

        // Conversation steps
        this.STEPS = {
            START: 'start',
            AWAITING_ROOT_PERSON: 'awaiting_root_person',
            AWAITING_ROOT_DATES: 'awaiting_root_dates',
            AWAITING_CHILD_COUNT: 'awaiting_child_count',
            AWAITING_CHILD_INFO: 'awaiting_child_info',
            AWAITING_GRANDCHILD_DECISION: 'awaiting_grandchild_decision',
            AWAITING_GRANDCHILD_COUNT: 'awaiting_grandchild_count',
            AWAITING_GRANDCHILD_INFO: 'awaiting_grandchild_info',
            CONFIRM_TREE: 'confirm_tree',
            COMPLETE: 'complete'
        };
    }

    /**
     * Initialize a new tree building session
     */
    initializeSession(sessionId) {
        return {
            mode: 'tree_builder',
            step: this.STEPS.START,
            treeData: {
                root: null,
                children: []
            },
            currentChild: null,
            childIndex: 0,
            totalChildren: 0,
            grandchildIndex: 0,
            totalGrandchildren: 0,
            history: []
        };
    }

    /**
     * Process user input based on current step
     */
    async processInput(input, state) {
        const step = state.step;

        // Add to history
        state.history.push({ step, input, timestamp: new Date() });

        switch (step) {
            case this.STEPS.START:
                return this.handleStart(input, state);

            case this.STEPS.AWAITING_ROOT_PERSON:
                return this.handleRootPerson(input, state);

            case this.STEPS.AWAITING_ROOT_DATES:
                return this.handleRootDates(input, state);

            case this.STEPS.AWAITING_CHILD_COUNT:
                return this.handleChildCount(input, state);

            case this.STEPS.AWAITING_CHILD_INFO:
                return this.handleChildInfo(input, state);

            case this.STEPS.AWAITING_GRANDCHILD_DECISION:
                return this.handleGrandchildDecision(input, state);

            case this.STEPS.AWAITING_GRANDCHILD_COUNT:
                return this.handleGrandchildCount(input, state);

            case this.STEPS.AWAITING_GRANDCHILD_INFO:
                return this.handleGrandchildInfo(input, state);

            case this.STEPS.CONFIRM_TREE:
                return this.handleConfirmTree(input, state);

            default:
                return {
                    message: 'Something went wrong. Type "restart" to start over.',
                    state
                };
        }
    }

    // ============================================
    // STEP HANDLERS
    // ============================================

    handleStart(input, state) {
        state.step = this.STEPS.AWAITING_ROOT_PERSON;
        return {
            message: `🌳 **Family Tree Builder Started!**\n\nLet's build a family tree together. I'll guide you through each step.\n\n**Who is the ancestor?** (the person at the root of this tree)\n\nExample: "James Hopewell" or "Nancy D'Wolf"`,
            state
        };
    }

    handleRootPerson(input, state) {
        // Extract name from input
        const name = this.extractName(input);

        if (!name) {
            return {
                message: `❌ I couldn't understand that name. Please provide the full name.\n\nExample: "James Hopewell"`,
                state
            };
        }

        state.treeData.root = { fullName: name };
        state.step = this.STEPS.AWAITING_ROOT_DATES;

        return {
            message: `✓ Root person: **${name}**\n\n**What are their birth and death years?**\n\nFormat: "BIRTH-DEATH" or "born YEAR died YEAR"\n\nExamples:\n- "1764-1837"\n- "born 1764 died 1837"\n- "1764-unknown" (if death year unknown)\n- "unknown" (if both unknown)`,
            state
        };
    }

    handleRootDates(input, state) {
        const dates = this.extractDates(input);

        state.treeData.root.birthYear = dates.birthYear;
        state.treeData.root.deathYear = dates.deathYear;
        state.step = this.STEPS.AWAITING_CHILD_COUNT;

        const dateStr = `${dates.birthYear || '?'}-${dates.deathYear || '?'}`;

        return {
            message: `✓ **${state.treeData.root.fullName}** (${dateStr})\n\n**How many children did ${state.treeData.root.fullName} have?**\n\nJust type a number (e.g., "5" or "0" if none)`,
            state
        };
    }

    handleChildCount(input, state) {
        const count = parseInt(input.trim());

        if (isNaN(count) || count < 0 || count > 50) {
            return {
                message: `❌ Please provide a valid number between 0 and 50.\n\nHow many children? (just the number)`,
                state
            };
        }

        state.totalChildren = count;
        state.childIndex = 0;

        if (count === 0) {
            state.step = this.STEPS.CONFIRM_TREE;
            return {
                message: `✓ No children recorded.\n\n` + this.generateTreePreview(state),
                state
            };
        }

        state.step = this.STEPS.AWAITING_CHILD_INFO;
        return {
            message: `✓ ${count} children\n\nLet's add them one by one.\n\n**Child #1 - What is their name, birth year, death year, and gender?**\n\nFormat: "NAME, BIRTH-DEATH, GENDER"\n\nExamples:\n- "Mary Ann DeWolf Sumner, 1795-1834, Female"\n- "Mark Antony D'Wolf, 1799-1851, Male"\n- "John Smith, 1800-unknown, Male"`,
            state
        };
    }

    handleChildInfo(input, state) {
        const childData = this.parsePersonInfo(input);

        if (!childData.fullName) {
            return {
                message: `❌ I couldn't parse that. Please use this format:\n\n"NAME, BIRTH-DEATH, GENDER"\n\nExample: "Mary Ann Sumner, 1795-1834, Female"`,
                state
            };
        }

        // Add child to tree
        childData.grandchildren = [];
        state.treeData.children.push(childData);
        state.childIndex++;

        const childNum = state.childIndex;
        const totalChildren = state.totalChildren;

        // Ask about grandchildren for this child
        state.currentChild = childData;
        state.step = this.STEPS.AWAITING_GRANDCHILD_DECISION;

        return {
            message: `✓ Added: **${childData.fullName}** (${childData.birthYear || '?'}-${childData.deathYear || '?'}, ${childData.gender || 'Unknown'})\n\n**Did ${childData.fullName} have children?** (grandchildren of ${state.treeData.root.fullName})\n\nType: "yes" or "no"`,
            state
        };
    }

    handleGrandchildDecision(input, state) {
        const lower = input.toLowerCase().trim();

        if (lower.includes('no') || lower === 'n') {
            // No grandchildren, move to next child or confirm
            if (state.childIndex < state.totalChildren) {
                state.step = this.STEPS.AWAITING_CHILD_INFO;
                return {
                    message: `✓ No grandchildren for ${state.currentChild.fullName}\n\n**Child #${state.childIndex + 1} - What is their name, birth year, death year, and gender?**\n\nFormat: "NAME, BIRTH-DEATH, GENDER"`,
                    state
                };
            } else {
                state.step = this.STEPS.CONFIRM_TREE;
                return {
                    message: `✓ No grandchildren\n\n` + this.generateTreePreview(state),
                    state
                };
            }
        } else if (lower.includes('yes') || lower === 'y') {
            state.step = this.STEPS.AWAITING_GRANDCHILD_COUNT;
            return {
                message: `**How many children did ${state.currentChild.fullName} have?**\n\nJust type a number:`,
                state
            };
        } else {
            return {
                message: `Please type "yes" or "no".\n\nDid ${state.currentChild.fullName} have children?`,
                state
            };
        }
    }

    handleGrandchildCount(input, state) {
        const count = parseInt(input.trim());

        if (isNaN(count) || count < 0 || count > 50) {
            return {
                message: `❌ Please provide a valid number between 0 and 50.`,
                state
            };
        }

        state.totalGrandchildren = count;
        state.grandchildIndex = 0;
        state.step = this.STEPS.AWAITING_GRANDCHILD_INFO;

        return {
            message: `✓ ${count} grandchildren\n\n**Grandchild #1 (child of ${state.currentChild.fullName}) - What is their name, birth year, death year, and gender?**\n\nFormat: "NAME, BIRTH-DEATH, GENDER"`,
            state
        };
    }

    handleGrandchildInfo(input, state) {
        const grandchildData = this.parsePersonInfo(input);

        if (!grandchildData.fullName) {
            return {
                message: `❌ I couldn't parse that. Please use this format:\n\n"NAME, BIRTH-DEATH, GENDER"`,
                state
            };
        }

        // Add grandchild to current child
        state.currentChild.grandchildren.push(grandchildData);
        state.grandchildIndex++;

        if (state.grandchildIndex < state.totalGrandchildren) {
            // More grandchildren for this child
            return {
                message: `✓ Added: **${grandchildData.fullName}**\n\n**Grandchild #${state.grandchildIndex + 1} (child of ${state.currentChild.fullName})**\n\nFormat: "NAME, BIRTH-DEATH, GENDER"`,
                state
            };
        } else {
            // Done with grandchildren for this child
            if (state.childIndex < state.totalChildren) {
                // More children to process
                state.step = this.STEPS.AWAITING_CHILD_INFO;
                return {
                    message: `✓ Added: **${grandchildData.fullName}**\n\n**Child #${state.childIndex + 1} - What is their name, birth year, death year, and gender?**\n\nFormat: "NAME, BIRTH-DEATH, GENDER"`,
                    state
                };
            } else {
                // All done - confirm tree
                state.step = this.STEPS.CONFIRM_TREE;
                return {
                    message: `✓ Added: **${grandchildData.fullName}**\n\n` + this.generateTreePreview(state),
                    state
                };
            }
        }
    }

    async handleConfirmTree(input, state) {
        const lower = input.toLowerCase().trim();

        if (lower.includes('yes') || lower === 'y' || lower === 'save' || lower === 'import') {
            // Save to database
            const result = await this.saveTreeToDatabase(state.treeData);

            state.step = this.STEPS.COMPLETE;

            return {
                message: `✅ **Tree Saved Successfully!**\n\n${result.message}\n\nYou can now:\n- View it in the carousel (refresh page)\n- Click on ${state.treeData.root.fullName} to see descendants\n- Type "build another tree" to start a new one`,
                state,
                complete: true
            };
        } else if (lower.includes('no') || lower === 'n' || lower === 'cancel') {
            return {
                message: `❌ Tree cancelled. Type "build tree" to start over.`,
                state: this.initializeSession(),
                complete: true
            };
        } else {
            return {
                message: `Please type "yes" to save or "no" to cancel.\n\nSave this tree?`,
                state
            };
        }
    }

    // ============================================
    // HELPER FUNCTIONS
    // ============================================

    extractName(input) {
        // Remove common words and extract name
        const cleaned = input
            .replace(/^(the|my|our|his|her|their)\s+/i, '')
            .replace(/\s+(is|was|born|died).*$/i, '')
            .trim();

        return cleaned.length > 1 ? cleaned : null;
    }

    extractDates(input) {
        const result = { birthYear: null, deathYear: null };

        // Pattern 1: YYYY-YYYY
        const dashPattern = /(\d{4}|unknown)\s*[-–—]\s*(\d{4}|unknown)/i;
        const dashMatch = input.match(dashPattern);

        if (dashMatch) {
            result.birthYear = dashMatch[1] !== 'unknown' ? parseInt(dashMatch[1]) : null;
            result.deathYear = dashMatch[2] !== 'unknown' ? parseInt(dashMatch[2]) : null;
            return result;
        }

        // Pattern 2: born YYYY died YYYY
        const bornPattern = /born\s+(\d{4}|unknown)/i;
        const diedPattern = /died\s+(\d{4}|unknown)/i;

        const bornMatch = input.match(bornPattern);
        const diedMatch = input.match(diedPattern);

        if (bornMatch) {
            result.birthYear = bornMatch[1] !== 'unknown' ? parseInt(bornMatch[1]) : null;
        }
        if (diedMatch) {
            result.deathYear = diedMatch[1] !== 'unknown' ? parseInt(diedMatch[1]) : null;
        }

        return result;
    }

    parsePersonInfo(input) {
        const result = {
            fullName: null,
            birthYear: null,
            deathYear: null,
            gender: null
        };

        // Split by comma
        const parts = input.split(',').map(p => p.trim());

        if (parts.length < 2) {
            return result; // Invalid format
        }

        // Part 1: Name
        result.fullName = parts[0];

        // Part 2: Dates (YYYY-YYYY)
        const dates = this.extractDates(parts[1]);
        result.birthYear = dates.birthYear;
        result.deathYear = dates.deathYear;

        // Part 3: Gender (if provided)
        if (parts.length >= 3) {
            const gender = parts[2].toLowerCase().trim();
            if (gender.includes('male')) {
                result.gender = gender.includes('female') ? 'Female' : 'Male';
            } else if (gender.includes('f')) {
                result.gender = 'Female';
            } else if (gender.includes('m')) {
                result.gender = 'Male';
            }
        }

        return result;
    }

    generateTreePreview(state) {
        let preview = `\n**📋 Family Tree Preview:**\n\n`;

        const root = state.treeData.root;
        preview += `**${root.fullName}** (${root.birthYear || '?'}-${root.deathYear || '?'})\n`;

        if (state.treeData.children.length === 0) {
            preview += `└─ No children\n`;
        } else {
            state.treeData.children.forEach((child, i) => {
                const isLast = i === state.treeData.children.length - 1;
                const prefix = isLast ? '└─' : '├─';

                preview += `${prefix} **${child.fullName}** (${child.birthYear || '?'}-${child.deathYear || '?'}, ${child.gender || '?'})\n`;

                if (child.grandchildren && child.grandchildren.length > 0) {
                    child.grandchildren.forEach((gc, j) => {
                        const gcIsLast = j === child.grandchildren.length - 1;
                        const gcPrefix = isLast ? '   ' : '│  ';
                        const gcBranch = gcIsLast ? '└─' : '├─';

                        preview += `${gcPrefix}${gcBranch} ${gc.fullName} (${gc.birthYear || '?'}-${gc.deathYear || '?'}, ${gc.gender || '?'})\n`;
                    });
                }
            });
        }

        preview += `\n**Save this tree?** Type "yes" to save or "no" to cancel.`;

        return preview;
    }

    async saveTreeToDatabase(treeData) {
        try {
            // Add root person
            const rootId = `tree_root_${treeData.root.fullName.replace(/[^a-zA-Z]/g, '_').toLowerCase()}_${Date.now()}`;

            await this.database.query(`
                INSERT INTO individuals (
                    individual_id, full_name, birth_year, death_year, notes
                ) VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT (individual_id) DO UPDATE
                SET full_name = EXCLUDED.full_name
            `, [
                rootId,
                treeData.root.fullName,
                treeData.root.birthYear,
                treeData.root.deathYear,
                'Added via conversational tree builder'
            ]);

            let childCount = 0;
            let grandchildCount = 0;

            // Add children
            for (const child of treeData.children) {
                const childId = `tree_child_${child.fullName.replace(/[^a-zA-Z]/g, '_').toLowerCase()}_${Date.now()}_${Math.random().toString(36).substring(7)}`;

                await this.database.query(`
                    INSERT INTO individuals (
                        individual_id, full_name, birth_year, death_year, gender, notes
                    ) VALUES ($1, $2, $3, $4, $5, $6)
                    ON CONFLICT (individual_id) DO UPDATE
                    SET full_name = EXCLUDED.full_name
                `, [
                    childId,
                    child.fullName,
                    child.birthYear,
                    child.deathYear,
                    child.gender,
                    `Child of ${treeData.root.fullName}`
                ]);

                // Create relationship
                await this.database.query(`
                    INSERT INTO relationships (
                        individual_id_1, individual_id_2, relationship_type, is_directed
                    ) VALUES ($1, $2, 'parent-child', true)
                    ON CONFLICT DO NOTHING
                `, [rootId, childId]);

                childCount++;

                // Add grandchildren
                if (child.grandchildren && child.grandchildren.length > 0) {
                    for (const gc of child.grandchildren) {
                        const gcId = `tree_grandchild_${gc.fullName.replace(/[^a-zA-Z]/g, '_').toLowerCase()}_${Date.now()}_${Math.random().toString(36).substring(7)}`;

                        await this.database.query(`
                            INSERT INTO individuals (
                                individual_id, full_name, birth_year, death_year, gender, notes
                            ) VALUES ($1, $2, $3, $4, $5, $6)
                            ON CONFLICT (individual_id) DO UPDATE
                            SET full_name = EXCLUDED.full_name
                        `, [
                            gcId,
                            gc.fullName,
                            gc.birthYear,
                            gc.deathYear,
                            gc.gender,
                            `Grandchild of ${treeData.root.fullName}, child of ${child.fullName}`
                        ]);

                        // Create relationship
                        await this.database.query(`
                            INSERT INTO relationships (
                                individual_id_1, individual_id_2, relationship_type, is_directed
                            ) VALUES ($1, $2, 'parent-child', true)
                            ON CONFLICT DO NOTHING
                        `, [childId, gcId]);

                        grandchildCount++;
                    }
                }
            }

            return {
                success: true,
                message: `Imported:\n• 1 root person (${treeData.root.fullName})\n• ${childCount} children\n• ${grandchildCount} grandchildren\n• Total: ${1 + childCount + grandchildCount} people`
            };

        } catch (error) {
            console.error('Save tree error:', error);
            return {
                success: false,
                message: `Error saving tree: ${error.message}`
            };
        }
    }
}

module.exports = TreeBuilderConversation;
