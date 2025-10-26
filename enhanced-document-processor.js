/**
 * Enhanced Document Processor
 * Handles: Upload → OCR → Parse → Calculate Reparations → Store → Blockchain
 * Storage: Local (for now) → S3 (future) → Glacier (archive)
 * Immutability: IPFS hashing for blockchain verification
 */

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

class EnhancedDocumentProcessor {
    constructor(config = {}) {
        // Storage paths
        this.storageRoot = config.storageRoot || './storage';
        this.ownersPath = path.join(this.storageRoot, 'owners');
        this.tempPath = path.join(this.storageRoot, 'temp');
        
        // OCR services
        this.googleVisionApiKey = config.googleVisionApiKey || null;
        this.awsCredentials = config.awsCredentials || null;
        
        // IPFS (simulated for now, can add real IPFS later)
        this.ipfsEnabled = config.ipfsEnabled || false;
        this.ipfsGateway = config.ipfsGateway || 'https://ipfs.io/ipfs/';
        
        // Reparations calculator integration
        this.reparationsCalculator = config.reparationsCalculator || null;
        
        // Database connection (for metadata)
        this.db = config.database || null;
        
        // Processing stats
        this.stats = {
            totalProcessed: 0,
            totalBytes: 0,
            totalSlavesCounted: 0,
            totalReparationsCalculated: 0
        };
        
        this.initializeStorage();
    }
    
    /**
     * Initialize storage directories
     */
    async initializeStorage() {
        try {
            await fs.mkdir(this.storageRoot, { recursive: true });
            await fs.mkdir(this.ownersPath, { recursive: true });
            await fs.mkdir(this.tempPath, { recursive: true });
            console.log('✓ Storage initialized');
        } catch (error) {
            console.error('Storage initialization error:', error);
        }
    }
    
    /**
     * MAIN PROCESSING PIPELINE
     * Upload → Store → OCR → Parse → Calculate → Metadata → Blockchain
     */
    async processDocument(uploadedFile, metadata) {
        console.log(`\n═══════════════════════════════════════`);
        console.log(`📄 Processing: ${uploadedFile.originalname}`);
        console.log(`═══════════════════════════════════════\n`);
        
        const startTime = Date.now();
        const result = {
            success: false,
            documentId: this.generateDocumentId(),
            stages: {}
        };
        
        try {
            // STAGE 1: Store file locally
            result.stages.storage = await this.storeFile(uploadedFile, metadata);
            console.log('✓ Stage 1: File stored');
            
            // STAGE 2: Generate IPFS hash for blockchain immutability
            result.stages.ipfs = await this.generateIPFSHash(result.stages.storage.filePath);
            console.log('✓ Stage 2: IPFS hash generated');
            
            // STAGE 3: OCR extraction
            result.stages.ocr = await this.performOCR(result.stages.storage.filePath, metadata.documentType);
            console.log('✓ Stage 3: OCR completed');
            
            // STAGE 4: Parse enslaved people from text
            result.stages.parsing = await this.parseEnslavedPeople(
                result.stages.ocr.text, 
                metadata.documentType,
                metadata.ownerName
            );
            console.log(`✓ Stage 4: Parsed ${result.stages.parsing.enslavedPeople.length} enslaved people`);
            
            // STAGE 5: Calculate reparations
            result.stages.reparations = await this.calculateReparations(
                result.stages.parsing.enslavedPeople,
                metadata
            );
            console.log(`✓ Stage 5: Calculated $${result.stages.reparations.total.toLocaleString()} in reparations`);
            
            // STAGE 6: Save metadata to database
            result.stages.metadata = await this.saveMetadata({
                documentId: result.documentId,
                owner: metadata.ownerName,
                ...result.stages
            });
            console.log('✓ Stage 6: Metadata saved');
            
            // STAGE 7: Prepare for blockchain submission
            result.stages.blockchain = await this.prepareBlockchainSubmission(result);
            console.log('✓ Stage 7: Blockchain payload prepared');
            
            // Update stats
            this.stats.totalProcessed++;
            this.stats.totalBytes += uploadedFile.size;
            this.stats.totalSlavesCounted += result.stages.parsing.enslavedPeople.length;
            this.stats.totalReparationsCalculated += result.stages.reparations.total;
            
            result.success = true;
            result.processingTime = Date.now() - startTime;
            
            console.log(`\n✅ Processing complete in ${result.processingTime}ms`);
            console.log(`📊 Total reparations: $${result.stages.reparations.total.toLocaleString()}`);
            console.log(`👥 Enslaved people identified: ${result.stages.parsing.enslavedPeople.length}`);
            
            return result;
            
        } catch (error) {
            console.error('❌ Processing failed:', error);
            result.error = error.message;
            return result;
        }
    }
    
    /**
     * STAGE 1: Store file in organized directory structure
     * /storage/owners/{owner-name}/{document-type}/{filename}
     */
    async storeFile(uploadedFile, metadata) {
        const ownerName = this.sanitizeFilename(metadata.ownerName);
        const docType = metadata.documentType || 'unknown';
        
        // Create owner directory structure
        const ownerDir = path.join(this.ownersPath, ownerName);
        const docTypeDir = path.join(ownerDir, docType);
        
        await fs.mkdir(ownerDir, { recursive: true });
        await fs.mkdir(docTypeDir, { recursive: true });
        
        // Generate unique filename with timestamp
        const timestamp = Date.now();
        const ext = path.extname(uploadedFile.originalname);
        const filename = `${ownerName}-${docType}-${timestamp}${ext}`;
        const filePath = path.join(docTypeDir, filename);
        
        // Copy file to storage
        await fs.copyFile(uploadedFile.path, filePath);
        
        // Get file stats
        const stats = await fs.stat(filePath);
        
        return {
            filePath: filePath,
            relativePath: path.relative(this.storageRoot, filePath),
            filename: filename,
            originalName: uploadedFile.originalname,
            fileSize: stats.size,
            mimeType: uploadedFile.mimetype,
            storedAt: new Date().toISOString(),
            ownerDirectory: ownerName,
            documentType: docType
        };
    }
    
    /**
     * STAGE 2: Generate IPFS hash (content-addressable)
     * This hash can be stored on blockchain for immutable proof
     */
    async generateIPFSHash(filePath) {
        // Read file content
        const fileBuffer = await fs.readFile(filePath);
        
        // Generate SHA-256 hash (simulates IPFS CIDv1)
        const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
        
        // Format as IPFS-style CID (simplified)
        const ipfsCID = `Qm${hash.substring(0, 44)}`;
        
        return {
            ipfsHash: ipfsCID,
            sha256: hash,
            hashAlgorithm: 'sha256',
            contentSize: fileBuffer.length,
            ipfsGatewayUrl: this.ipfsEnabled ? `${this.ipfsGateway}${ipfsCID}` : null,
            note: this.ipfsEnabled ? 'Real IPFS' : 'Simulated IPFS hash (can pin to real IPFS later)'
        };
    }
    
    /**
     * STAGE 3: OCR text extraction
     */
    async performOCR(filePath, documentType) {
        console.log('   → Running OCR...');
        
        // For now, simulate OCR (you'll integrate Google Vision API here)
        // Based on the James Hopewell will you uploaded, here's what we'd extract:
        
        // TODO: Replace with actual OCR call
        const mockOCRResult = await this.mockOCR(filePath, documentType);
        
        return {
            text: mockOCRResult.text,
            confidence: mockOCRResult.confidence,
            pageCount: mockOCRResult.pageCount,
            ocrService: 'google-vision', // or 'aws-textract'
            processedAt: new Date().toISOString()
        };
    }
    
    /**
     * Mock OCR for development (replace with real OCR)
     */
    async mockOCR(filePath, documentType) {
        // Simulate processing time
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Based on your James Hopewell will
        const exampleText = `
        Will and Testament of James Hopewell
        St. Mary's County, Maryland
        September 9th, 1811
        
        I give unto my Daughter Henrietta Rebecca one negro woman named Minna 
        and her seven children namely John, Harriet, Sandy, Henry, George, Charlotte and Isaac.
        
        I give unto my Daughter Olivia Caroline one negro man named Jim, his wife Rachel 
        and their five children namely Jane, Allison, Sophy, Sally and Peggy.
        
        I give unto my Daughter Ann Maria Biscoe one negro man Medley, one Adam, 
        one Lloyd, one negro woman Sarah and her three children Mary, Nancy and Louisa, 
        also one negro woman Esther and her child Ally.
        
        I give unto my beloved wife Angelica one negro man Lewis and his son Peter 
        and his daughter Henny, one more named Jess, one Frank, one Joe and his wife Sarah, 
        and one fellow man named Zekiel.
        `;
        
        return {
            text: exampleText,
            confidence: 0.85,
            pageCount: 2
        };
    }
    
    /**
     * STAGE 4: Parse enslaved people from OCR text
     * This is the critical genealogy extraction
     */
    async parseEnslavedPeople(ocrText, documentType, ownerName) {
        console.log('   → Parsing enslaved people...');
        
        const enslavedPeople = [];
        const text = ocrText.toLowerCase();
        
        // Pattern 1: "negro [man/woman/boy/girl] named [Name]"
        const namedPattern = /negro\s+(man|woman|boy|girl|child)\s+named\s+(\w+)/gi;
        let match;
        
        while ((match = namedPattern.exec(text)) !== null) {
            const gender = this.inferGender(match[1]);
            const name = this.capitalizeName(match[2]);
            
            enslavedPeople.push({
                name: name,
                gender: gender,
                age: null,
                source: 'named_in_will',
                owner: ownerName,
                familyRelationship: this.extractFamilyRelationship(text, name)
            });
        }
        
        // Pattern 2: Family relationships "his wife [Name]"
        const spousePattern = /(his|her)\s+wife\s+(\w+)/gi;
        while ((match = spousePattern.exec(text)) !== null) {
            const name = this.capitalizeName(match[2]);
            if (!enslavedPeople.find(p => p.name === name)) {
                enslavedPeople.push({
                    name: name,
                    gender: 'Female',
                    age: null,
                    source: 'spouse_mentioned',
                    owner: ownerName,
                    familyRelationship: 'wife'
                });
            }
        }
        
        // Pattern 3: Children lists "and their [number] children namely [names]"
        const childrenPattern = /(their|her|his)\s+(\w+)\s+children\s+namely\s+([^.]+)/gi;
        while ((match = childrenPattern.exec(text)) !== null) {
            const childrenNames = match[3].split(/,|\sand\s/).map(n => n.trim());
            childrenNames.forEach(childName => {
                const name = this.capitalizeName(childName);
                if (!enslavedPeople.find(p => p.name === name)) {
                    enslavedPeople.push({
                        name: name,
                        gender: null,
                        age: 'child',
                        source: 'child_of_family',
                        owner: ownerName,
                        familyRelationship: 'child'
                    });
                }
            });
        }
        
        // Pattern 4: Bequeathed to (inheritance tracking)
        const bequestPattern = /give\s+unto\s+(?:my\s+)?(?:daughter|son|wife|beloved)\s+(\w+(?:\s+\w+)*)/gi;
        const bequests = {};
        while ((match = bequestPattern.exec(text)) !== null) {
            const heir = this.capitalizeName(match[1]);
            bequests[heir] = heir;
        }
        
        // Attach heirs to enslaved people
        enslavedPeople.forEach(person => {
            person.bequeathedTo = this.findHeir(text, person.name, bequests);
        });
        
        // Deduplicate
        const uniquePeople = this.deduplicateEnslavedPeople(enslavedPeople);
        
        // Build family trees
        const withFamilies = this.buildFamilyRelationships(uniquePeople, text);
        
        return {
            enslavedPeople: withFamilies,
            totalCount: withFamilies.length,
            namedIndividuals: withFamilies.filter(p => p.name && !p.name.startsWith('Unnamed')).length,
            families: this.groupByFamily(withFamilies),
            parsingMethod: 'nlp_pattern_matching',
            parsedAt: new Date().toISOString()
        };
    }
    
    /**
     * STAGE 5: Calculate reparations using the ReparationsCalculator
     */
    async calculateReparations(enslavedPeople, metadata) {
        console.log('   → Calculating reparations...');
        
        const slaveCount = enslavedPeople.length;
        const estimatedYears = this.estimateYearsEnslaved(metadata);
        
        // Use the ReparationsCalculator from your existing code
        let calculation;
        if (this.reparationsCalculator) {
            calculation = this.reparationsCalculator.calculateComprehensiveReparations(
                slaveCount,
                estimatedYears
            );
        } else {
            // Fallback calculation
            const perPersonReparations = 2200000; // ~$2.2M average per person
            calculation = {
                total: slaveCount * perPersonReparations,
                perPerson: perPersonReparations,
                breakdown: {
                    wageTheft: slaveCount * perPersonReparations * 0.35,
                    damages: slaveCount * perPersonReparations * 0.45,
                    interest: slaveCount * perPersonReparations * 0.20
                }
            };
        }
        
        // Calculate per-person amounts
        const perPersonBreakdown = enslavedPeople.map(person => ({
            name: person.name,
            individualReparations: calculation.total / slaveCount,
            bequeathedTo: person.bequeathedTo,
            familyRelationship: person.familyRelationship
        }));
        
        // Group by heir (for descendant distribution)
        const byHeir = this.groupReparationsByHeir(perPersonBreakdown);
        
        return {
            total: calculation.total,
            perPerson: calculation.total / slaveCount,
            slaveCount: slaveCount,
            estimatedYears: estimatedYears,
            breakdown: calculation.breakdown || calculation,
            perPersonBreakdown: perPersonBreakdown,
            byHeir: byHeir,
            calculatedAt: new Date().toISOString()
        };
    }
    
    /**
     * STAGE 6: Save metadata to database
     */
    async saveMetadata(data) {
        console.log('   → Saving metadata...');
        
        const metadata = {
            documentId: data.documentId,
            owner: {
                name: data.owner,
                birthYear: data.metadata?.birthYear || null,
                deathYear: data.metadata?.deathYear || null,
                location: data.metadata?.location || null
            },
            document: {
                type: data.storage.documentType,
                filename: data.storage.filename,
                filePath: data.storage.filePath,
                fileSize: data.storage.fileSize,
                mimeType: data.storage.mimeType,
                storedAt: data.storage.storedAt
            },
            ipfs: {
                hash: data.ipfs.ipfsHash,
                sha256: data.ipfs.sha256,
                gatewayUrl: data.ipfs.ipfsGatewayUrl
            },
            enslaved: {
                people: data.parsing.enslavedPeople,
                totalCount: data.parsing.totalCount,
                namedCount: data.parsing.namedIndividuals,
                families: data.parsing.families
            },
            reparations: {
                total: data.reparations.total,
                perPerson: data.reparations.perPerson,
                breakdown: data.reparations.breakdown,
                byHeir: data.reparations.byHeir
            },
            verification: {
                status: 'pending',
                confidence: data.ocr.confidence,
                needsHumanReview: true
            },
            timestamps: {
                created: new Date().toISOString(),
                updated: new Date().toISOString()
            }
        };
        
        // Save to database (if connected)
        if (this.db) {
            await this.db.collection('documents').insertOne(metadata);
        } else {
            // Save to JSON file as backup
            const jsonPath = path.join(
                path.dirname(data.storage.filePath),
                `${data.documentId}-metadata.json`
            );
            await fs.writeFile(jsonPath, JSON.stringify(metadata, null, 2));
        }
        
        return metadata;
    }
    
    /**
     * STAGE 7: Prepare blockchain submission payload
     */
    async prepareBlockchainSubmission(result) {
        console.log('   → Preparing blockchain payload...');
        
        const storage = result.stages.storage;
        const ipfs = result.stages.ipfs;
        const parsing = result.stages.parsing;
        const reparations = result.stages.reparations;
        
        return {
            ancestorName: result.stages.metadata.owner.name,
            genealogyHash: ipfs.ipfsHash, // IPFS hash for verification
            totalReparationsOwed: reparations.total,
            slaveCount: parsing.totalCount,
            namedIndividuals: parsing.namedIndividuals,
            documentSource: storage.relativePath,
            documentType: storage.documentType,
            verificationLevel: this.calculateVerificationLevel(result),
            submittedBy: 'document-processor',
            timestamp: new Date().toISOString(),
            
            // For smart contract submission
            contractArgs: {
                ancestorName: result.stages.metadata.owner.name,
                genealogyHash: ipfs.ipfsHash,
                totalReparationsWei: this.toWei(reparations.total), // Convert to Wei for Ethereum
                notes: `Processed from ${storage.documentType} - ${parsing.totalCount} enslaved people identified`
            },
            
            // Descendant distribution (for later assignment)
            descendants: reparations.byHeir
        };
    }
    
    // ==================== HELPER FUNCTIONS ====================
    
    sanitizeFilename(name) {
        return name
            .toLowerCase()
            .replace(/[^a-z0-9-]/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');
    }
    
    generateDocumentId() {
        return `doc_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    }
    
    inferGender(descriptor) {
        const male = ['man', 'boy', 'father', 'husband', 'son'];
        const female = ['woman', 'girl', 'mother', 'wife', 'daughter'];
        
        if (male.includes(descriptor.toLowerCase())) return 'Male';
        if (female.includes(descriptor.toLowerCase())) return 'Female';
        return null;
    }
    
    capitalizeName(name) {
        return name
            .split(/\s+/)
            .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join(' ');
    }
    
    extractFamilyRelationship(text, name) {
        const nameLower = name.toLowerCase();
        const patterns = [
            { regex: new RegExp(`${nameLower}.*?mother`, 'i'), relation: 'mother' },
            { regex: new RegExp(`${nameLower}.*?father`, 'i'), relation: 'father' },
            { regex: new RegExp(`${nameLower}.*?wife`, 'i'), relation: 'wife' },
            { regex: new RegExp(`${nameLower}.*?husband`, 'i'), relation: 'husband' },
            { regex: new RegExp(`${nameLower}.*?child`, 'i'), relation: 'child' },
            { regex: new RegExp(`${nameLower}.*?son`, 'i'), relation: 'son' },
            { regex: new RegExp(`${nameLower}.*?daughter`, 'i'), relation: 'daughter' }
        ];
        
        for (const pattern of patterns) {
            if (pattern.regex.test(text)) {
                return pattern.relation;
            }
        }
        
        return null;
    }
    
    findHeir(text, slaveName, bequests) {
        // Find which heir received this enslaved person
        const section = this.extractRelevantSection(text, slaveName);
        
        for (const heir of Object.keys(bequests)) {
            if (section.includes(heir.toLowerCase())) {
                return heir;
            }
        }
        
        return null;
    }
    
    extractRelevantSection(text, name) {
        const index = text.toLowerCase().indexOf(name.toLowerCase());
        if (index === -1) return '';
        
        const start = Math.max(0, index - 200);
        const end = Math.min(text.length, index + 200);
        return text.substring(start, end);
    }
    
    deduplicateEnslavedPeople(people) {
        const unique = new Map();
        
        people.forEach(person => {
            const key = person.name.toLowerCase();
            if (!unique.has(key)) {
                unique.set(key, person);
            } else {
                // Merge information
                const existing = unique.get(key);
                unique.set(key, {
                    ...existing,
                    ...person,
                    gender: person.gender || existing.gender,
                    familyRelationship: person.familyRelationship || existing.familyRelationship
                });
            }
        });
        
        return Array.from(unique.values());
    }
    
    buildFamilyRelationships(people, text) {
        // Identify family units
        const families = [];
        
        people.forEach(person => {
            if (person.familyRelationship === 'wife' || person.familyRelationship === 'husband') {
                // Find their spouse
                const spouseName = this.findSpouse(text, person.name);
                if (spouseName) {
                    person.spouse = spouseName;
                }
            }
            
            if (person.familyRelationship === 'child') {
                // Find their parent
                const parentName = this.findParent(text, person.name);
                if (parentName) {
                    person.parent = parentName;
                }
            }
        });
        
        return people;
    }
    
    findSpouse(text, name) {
        const pattern1 = new RegExp(`${name}.*?(?:his|her)\\s+(?:wife|husband)\\s+(\\w+)`, 'i');
        const pattern2 = new RegExp(`(\\w+).*?(?:his|her)\\s+(?:wife|husband)\\s+${name}`, 'i');
        
        let match = pattern1.exec(text);
        if (match) return this.capitalizeName(match[1]);
        
        match = pattern2.exec(text);
        if (match) return this.capitalizeName(match[1]);
        
        return null;
    }
    
    findParent(text, childName) {
        const pattern = new RegExp(`(\\w+).*?child(?:ren)?.*?${childName}`, 'i');
        const match = pattern.exec(text);
        return match ? this.capitalizeName(match[1]) : null;
    }
    
    groupByFamily(people) {
        const families = {};
        
        people.forEach(person => {
            if (person.spouse) {
                const familyKey = [person.name, person.spouse].sort().join('_');
                if (!families[familyKey]) {
                    families[familyKey] = {
                        parents: [person.name, person.spouse],
                        children: []
                    };
                }
            }
            
            if (person.parent) {
                // Find family and add as child
                for (const family of Object.values(families)) {
                    if (family.parents.includes(person.parent)) {
                        family.children.push(person.name);
                    }
                }
            }
        });
        
        return Object.values(families);
    }
    
    groupReparationsByHeir(perPersonBreakdown) {
        const byHeir = {};
        
        perPersonBreakdown.forEach(person => {
            const heir = person.bequeathedTo || 'Estate';
            
            if (!byHeir[heir]) {
                byHeir[heir] = {
                    heir: heir,
                    count: 0,
                    total: 0,
                    individuals: []
                };
            }
            
            byHeir[heir].count++;
            byHeir[heir].total += person.individualReparations;
            byHeir[heir].individuals.push({
                name: person.name,
                amount: person.individualReparations
            });
        });
        
        return Object.values(byHeir);
    }
    
    estimateYearsEnslaved(metadata) {
        // Estimate based on owner's lifespan
        if (metadata.deathYear && metadata.birthYear) {
            return Math.min(metadata.deathYear - metadata.birthYear, 60);
        }
        
        // Default estimate: 25 years (average)
        return 25;
    }
    
    calculateVerificationLevel(result) {
        let score = 0;
        
        if (result.stages.ocr.confidence > 0.8) score += 3;
        if (result.stages.parsing.namedIndividuals > 5) score += 2;
        if (result.stages.ipfs.ipfsHash) score += 2;
        if (result.stages.parsing.families.length > 0) score += 1;
        
        if (score >= 7) return 'HIGH';
        if (score >= 4) return 'MEDIUM';
        return 'LOW';
    }
    
    toWei(dollars) {
        // Convert dollars to Wei (for Ethereum smart contracts)
        // 1 ETH = 10^18 Wei
        // Assuming 1 USD = 0.0005 ETH (example rate)
        const ethAmount = dollars * 0.0005;
        const wei = Math.floor(ethAmount * Math.pow(10, 18));
        return wei.toString();
    }
    
    /**
     * Get processing statistics
     */
    getStats() {
        return {
            ...this.stats,
            averageFileSize: this.stats.totalProcessed > 0 
                ? Math.round(this.stats.totalBytes / this.stats.totalProcessed) 
                : 0,
            averageSlavesPerDocument: this.stats.totalProcessed > 0
                ? Math.round(this.stats.totalSlavesCounted / this.stats.totalProcessed)
                : 0,
            averageReparationsPerDocument: this.stats.totalProcessed > 0
                ? Math.round(this.stats.totalReparationsCalculated / this.stats.totalProcessed)
                : 0
        };
    }
    
    /**
     * Export for blockchain batch submission
     */
    async exportForBlockchain(ownerName) {
        const ownerDir = path.join(this.ownersPath, this.sanitizeFilename(ownerName));
        const metadataFiles = await this.findMetadataFiles(ownerDir);
        
        const records = [];
        for (const file of metadataFiles) {
            const content = await fs.readFile(file, 'utf8');
            const metadata = JSON.parse(content);
            records.push(metadata);
        }
        
        return {
            owner: ownerName,
            documentCount: records.length,
            totalReparations: records.reduce((sum, r) => sum + r.reparations.total, 0),
            totalEnslaved: records.reduce((sum, r) => sum + r.enslaved.totalCount, 0),
            records: records.map(r => r.blockchain)
        };
    }
    
    async findMetadataFiles(dir) {
        const files = await fs.readdir(dir, { recursive: true });
        return files
            .filter(f => f.endsWith('-metadata.json'))
            .map(f => path.join(dir, f));
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = EnhancedDocumentProcessor;
} else if (typeof window !== 'undefined') {
    window.EnhancedDocumentProcessor = EnhancedDocumentProcessor;
}
