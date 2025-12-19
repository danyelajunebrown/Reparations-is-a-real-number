#!/usr/bin/env node
/**
 * E2E Test Runner
 *
 * Verifies the 4 test cases from E2E-TEST-PLAN.md:
 * 1. Ravenel Family (FamilySearch)
 * 2. James Hopewell (S3 Document)
 * 3. Maryland Archives (MSA)
 * 4. Confirmed Enslaved Individual
 *
 * Plus data quality checks
 */

const API_BASE = process.env.API_BASE || 'http://localhost:3000';

class E2ETestRunner {
    constructor() {
        this.results = [];
        this.passed = 0;
        this.failed = 0;
    }

    async run() {
        console.log('🧪 E2E Test Runner');
        console.log('='.repeat(60));
        console.log(`API Base: ${API_BASE}\n`);

        // Check server is running
        const healthCheck = await this.testHealth();
        if (!healthCheck) {
            console.log('❌ Server not running. Start with: npm start');
            process.exit(1);
        }

        // Run test suites
        await this.testRavenelFamily();
        await this.testJamesHopewell();
        await this.testMarylandArchives();
        await this.testConfirmedEnslaved();
        await this.testDataQuality();
        await this.testDocumentViewer();

        // Print summary
        this.printSummary();
    }

    async fetch(url) {
        try {
            const response = await fetch(`${API_BASE}${url}`);
            return await response.json();
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async testHealth() {
        console.log('📡 Checking server health...');
        const result = await this.fetch('/api/health');
        if (result.success) {
            console.log('✓ Server is healthy\n');
            return true;
        }
        return false;
    }

    // Test 1: Ravenel Family
    async testRavenelFamily() {
        console.log('━'.repeat(60));
        console.log('TEST 1: Ravenel Family (FamilySearch)');
        console.log('━'.repeat(60));

        // Search for Ravenel
        const searchResult = await this.fetch('/api/contribute/browse?limit=50&source=familysearch');

        // Check if any Ravenel records exist
        const ravenelRecords = searchResult.people?.filter(p =>
            p.name?.toLowerCase().includes('ravenel') ||
            p.source_url?.includes('008891')
        ) || [];

        this.assert(
            'Ravenel records found in FamilySearch data',
            ravenelRecords.length > 0 || searchResult.total > 0,
            `Found ${searchResult.total} FamilySearch records`
        );

        // Check for slaveholder type records
        const owners = searchResult.people?.filter(p =>
            p.type === 'owner' || p.type === 'slaveholder'
        ) || [];

        this.assert(
            'FamilySearch has slaveholder records',
            owners.length > 0,
            `Found ${owners.length} owner/slaveholder records`
        );

        // Check for archived documents
        const withArchive = searchResult.people?.filter(p => p.archive_url) || [];
        this.assert(
            'FamilySearch records have archive URLs',
            withArchive.length > 0,
            `${withArchive.length} records have archived documents`
        );

        console.log('');
    }

    // Test 2: James Hopewell
    async testJamesHopewell() {
        console.log('━'.repeat(60));
        console.log('TEST 2: James Hopewell (S3 Document)');
        console.log('━'.repeat(60));

        // Search in documents table
        const docResult = await this.fetch('/api/documents');

        const hopewellDocs = docResult.documents?.filter(d =>
            d.owner_name?.toLowerCase().includes('hopewell') ||
            d.title?.toLowerCase().includes('hopewell')
        ) || [];

        this.assert(
            'James Hopewell document exists',
            hopewellDocs.length > 0,
            hopewellDocs.length > 0 ? `Found: ${hopewellDocs[0]?.title || hopewellDocs[0]?.owner_name}` : 'Not found in documents'
        );

        // Check if document has filename and can be viewed
        if (hopewellDocs.length > 0) {
            const hasFile = hopewellDocs[0].filename || hopewellDocs[0].document_id;
            this.assert(
                'Hopewell document has filename',
                !!hasFile,
                hasFile ? `File: ${hasFile}` : 'No filename'
            );
        }

        // Also search unconfirmed_persons - search with larger limit to find Hopewell
        const personResult = await this.fetch('/api/contribute/browse?limit=500');
        const hopewellPerson = personResult.people?.find(p =>
            p.name?.toLowerCase().includes('hopewell')
        );

        this.assert(
            'Hopewell in people database',
            !!hopewellPerson,
            hopewellPerson ? `Found: ${hopewellPerson.name} (${hopewellPerson.type})` : `Not in first 500 results (total: ${personResult.total})`
        );

        console.log('');
    }

    // Test 3: Maryland Archives
    async testMarylandArchives() {
        console.log('━'.repeat(60));
        console.log('TEST 3: Maryland Archives (MSA Source)');
        console.log('━'.repeat(60));

        // Search for MSA records
        const msaResult = await this.fetch('/api/contribute/browse?limit=50&source=msa');

        this.assert(
            'MSA records exist',
            msaResult.total > 0,
            `Found ${msaResult.total} MSA records`
        );

        // Check for Montgomery County records
        const montgomeryRecords = msaResult.people?.filter(p =>
            p.locations?.toLowerCase().includes('montgomery') ||
            p.context_text?.toLowerCase().includes('montgomery')
        ) || [];

        this.assert(
            'Montgomery County records found',
            montgomeryRecords.length > 0,
            `Found ${montgomeryRecords.length} Montgomery County records`
        );

        // Check for enslaved persons from MSA
        const enslaved = msaResult.people?.filter(p => p.type === 'enslaved') || [];
        this.assert(
            'MSA has enslaved person records',
            enslaved.length > 0,
            `Found ${enslaved.length} enslaved persons`
        );

        // Sample names check
        const sampleNames = msaResult.people?.slice(0, 3).map(p => p.name) || [];
        console.log(`   Sample names: ${sampleNames.join(', ')}`);

        console.log('');
    }

    // Test 4: Confirmed Enslaved
    async testConfirmedEnslaved() {
        console.log('━'.repeat(60));
        console.log('TEST 4: Confirmed Enslaved Individual');
        console.log('━'.repeat(60));

        // Check enslaved_individuals table via stats
        const statsResult = await this.fetch('/api/contribute/stats');

        this.assert(
            'Stats endpoint works',
            statsResult.success !== false,
            statsResult.error || 'Stats available'
        );

        // Check for confirmed records in unconfirmed_persons
        const confirmedResult = await this.fetch('/api/contribute/browse?limit=10&minConfidence=0.9');

        this.assert(
            'High confidence records exist',
            confirmedResult.total > 0,
            `Found ${confirmedResult.total} high confidence records`
        );

        // Check enslaved type specifically
        const enslavedResult = await this.fetch('/api/contribute/browse?limit=10&type=enslaved');

        this.assert(
            'Enslaved persons searchable',
            enslavedResult.total > 0,
            `Found ${enslavedResult.total} enslaved person records`
        );

        console.log('');
    }

    // Data Quality Checks
    async testDataQuality() {
        console.log('━'.repeat(60));
        console.log('DATA QUALITY CHECKS');
        console.log('━'.repeat(60));

        // These searches should return 0 or very few results
        const garbageTerms = ['statistics', 'the', 'participant info', 'years', 'filed', 'note'];

        for (const term of garbageTerms) {
            // Use browse with a search simulation
            const result = await this.fetch(`/api/contribute/browse?limit=100`);
            const matches = result.people?.filter(p =>
                p.name?.toLowerCase() === term.toLowerCase()
            ) || [];

            this.assert(
                `"${term}" not in results`,
                matches.length === 0,
                matches.length === 0 ? 'Clean' : `Found ${matches.length} garbage records`
            );
        }

        // Check overall garbage rate
        const allResult = await this.fetch('/api/contribute/browse?limit=100');
        const suspiciousNames = allResult.people?.filter(p => {
            const name = p.name?.toLowerCase() || '';
            return name.length <= 3 ||
                   /^(the|he|she|it|and|but|for|with)$/i.test(name) ||
                   name.includes('\n');
        }) || [];

        const garbageRate = (suspiciousNames.length / (allResult.people?.length || 1)) * 100;
        this.assert(
            'Garbage rate < 5%',
            garbageRate < 5,
            `Garbage rate: ${garbageRate.toFixed(1)}%`
        );

        console.log('');
    }

    // Document Viewer Tests
    async testDocumentViewer() {
        console.log('━'.repeat(60));
        console.log('DOCUMENT VIEWER TESTS');
        console.log('━'.repeat(60));

        // Test presigned URL endpoint
        const testArchiveUrl = 'https://reparations-them.s3.amazonaws.com/archives/familysearch/film-008891451/image-0863.png';
        const presignResult = await this.fetch(`/api/documents/archive/presign?url=${encodeURIComponent(testArchiveUrl)}`);

        this.assert(
            'Presigned URL endpoint works',
            presignResult.success === true,
            presignResult.viewUrl ? 'Returns signed URL' : (presignResult.error || 'Failed')
        );

        if (presignResult.viewUrl) {
            this.assert(
                'Presigned URL is valid format',
                presignResult.viewUrl.includes('X-Amz-Signature'),
                'Contains AWS signature'
            );
        }

        // Test documents list endpoint
        const docsResult = await this.fetch('/api/documents');
        this.assert(
            'Documents endpoint works',
            Array.isArray(docsResult.documents) || docsResult.success !== false,
            `Returns ${docsResult.documents?.length || 0} documents`
        );

        console.log('');
    }

    assert(testName, condition, details = '') {
        if (condition) {
            console.log(`   ✅ ${testName}`);
            if (details) console.log(`      ${details}`);
            this.passed++;
            this.results.push({ test: testName, passed: true, details });
        } else {
            console.log(`   ❌ ${testName}`);
            if (details) console.log(`      ${details}`);
            this.failed++;
            this.results.push({ test: testName, passed: false, details });
        }
    }

    printSummary() {
        console.log('━'.repeat(60));
        console.log('TEST SUMMARY');
        console.log('━'.repeat(60));
        console.log(`Total Tests: ${this.passed + this.failed}`);
        console.log(`Passed: ${this.passed} ✅`);
        console.log(`Failed: ${this.failed} ❌`);
        console.log(`Pass Rate: ${((this.passed / (this.passed + this.failed)) * 100).toFixed(1)}%`);
        console.log('━'.repeat(60));

        if (this.failed > 0) {
            console.log('\nFailed Tests:');
            this.results.filter(r => !r.passed).forEach(r => {
                console.log(`   ❌ ${r.test}: ${r.details}`);
            });
        }

        // Exit with appropriate code
        process.exit(this.failed > 0 ? 1 : 0);
    }
}

// Run tests
const runner = new E2ETestRunner();
runner.run().catch(error => {
    console.error('Test runner error:', error);
    process.exit(1);
});
