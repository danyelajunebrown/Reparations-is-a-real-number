#!/usr/bin/env node
/**
 * Codebase Audit - Find orphaned and obsolete files
 */
const fs = require('fs');
const path = require('path');

const ROOT = '/Users/danyelabrown/Desktop/danyelajunebrown GITHUB/Reparations-is-a-real-number-main';

// Get all JS files (excluding node_modules)
function getAllFiles(dir, ext, files = []) {
    const items = fs.readdirSync(dir);
    for (const item of items) {
        if (item === 'node_modules' || item === '.git' || item === '.chrome-profile') continue;
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
            getAllFiles(fullPath, ext, files);
        } else if (item.endsWith(ext)) {
            files.push(fullPath);
        }
    }
    return files;
}

// Check if a file is imported anywhere
function isFileImported(targetFile, allJsFiles) {
    const basename = path.basename(targetFile, '.js');
    const relativePath = targetFile.replace(ROOT + '/', '');

    for (const jsFile of allJsFiles) {
        if (jsFile === targetFile) continue;
        try {
            const content = fs.readFileSync(jsFile, 'utf8');
            // Check various require patterns
            if (content.includes(`require('./${basename}')`) ||
                content.includes(`require("./${basename}")`) ||
                content.includes(`require('${relativePath}')`) ||
                content.includes(`require("${relativePath}")`) ||
                content.includes(`from './${basename}'`) ||
                content.includes(`from "./${basename}"`) ||
                content.includes(`/${basename}'`) ||
                content.includes(`/${basename}"`) ||
                content.includes(`require('./${basename}.js')`) ||
                content.includes(`require("./${basename}.js")`)) {
                return true;
            }
        } catch (e) {}
    }
    return false;
}

// Check if HTML is linked from anywhere
function isHtmlLinked(htmlFile, allFiles) {
    const basename = path.basename(htmlFile);
    for (const file of allFiles) {
        if (file === htmlFile) continue;
        try {
            const content = fs.readFileSync(file, 'utf8');
            if (content.includes(basename) || content.includes(basename.replace('.html', ''))) {
                return true;
            }
        } catch (e) {}
    }
    return false;
}

async function audit() {
    console.log('CODEBASE AUDIT REPORT');
    console.log('='.repeat(80));

    const jsFiles = getAllFiles(ROOT, '.js');
    const htmlFiles = getAllFiles(ROOT, '.html');
    const mdFiles = getAllFiles(ROOT, '.md');
    const allFiles = [...jsFiles, ...htmlFiles, ...mdFiles];

    // 1. ROOT-LEVEL JS FILES
    console.log('\n\n### 1. ROOT-LEVEL JS FILES ###\n');
    console.log('These JS files in root may be orphaned one-off scripts:\n');

    const rootJsFiles = jsFiles.filter(f => {
        const rel = f.replace(ROOT + '/', '');
        return !rel.includes('/');
    });

    for (const file of rootJsFiles) {
        const basename = path.basename(file);
        const imported = isFileImported(file, jsFiles);
        const status = imported ? '✅ IMPORTED' : '❓ ORPHAN';
        console.log(`  ${status}: ${basename}`);
    }

    // 2. ROOT-LEVEL HTML FILES
    console.log('\n\n### 2. HTML FILES ###\n');

    const htmlInRoot = htmlFiles.filter(f => {
        const rel = f.replace(ROOT + '/', '');
        return !rel.includes('/') || rel.startsWith('contribute');
    });

    console.log('HTML files that may be duplicates or obsolete:\n');
    for (const file of htmlInRoot) {
        const basename = path.basename(file);
        console.log(`  - ${basename}`);
    }

    // 3. ROOT-LEVEL MARKDOWN FILES
    console.log('\n\n### 3. ROOT-LEVEL MARKDOWN FILES ###\n');
    console.log('Documentation in root (may be outdated):\n');

    const rootMd = mdFiles.filter(f => {
        const rel = f.replace(ROOT + '/', '');
        return !rel.includes('/');
    });

    for (const file of rootMd) {
        const basename = path.basename(file);
        const stat = fs.statSync(file);
        const mtime = stat.mtime.toISOString().split('T')[0];
        console.log(`  - ${basename} (modified: ${mtime})`);
    }

    // 4. TEST FILES
    console.log('\n\n### 4. TEST FILES ###\n');
    const testFiles = jsFiles.filter(f => path.basename(f).startsWith('test-'));
    console.log(`Found ${testFiles.length} test files:\n`);
    testFiles.forEach(f => {
        const rel = f.replace(ROOT + '/', '');
        console.log(`  - ${rel}`);
    });

    // 5. DUPLICATE SERVER FILES
    console.log('\n\n### 5. POTENTIAL DUPLICATES ###\n');

    const serverFiles = jsFiles.filter(f => f.includes('server'));
    console.log('Server files:');
    serverFiles.forEach(f => console.log(`  - ${f.replace(ROOT + '/', '')}`));

    const databaseFiles = jsFiles.filter(f => f.includes('database') || f.includes('connection'));
    console.log('\nDatabase files:');
    databaseFiles.forEach(f => console.log(`  - ${f.replace(ROOT + '/', '')}`));

    // 6. SRC SERVICES THAT MAY BE UNUSED
    console.log('\n\n### 6. SRC/SERVICES IMPORT CHECK ###\n');

    const serviceFiles = jsFiles.filter(f => f.includes('/src/services/'));
    let unusedServices = [];

    for (const file of serviceFiles) {
        const imported = isFileImported(file, jsFiles);
        if (!imported) {
            unusedServices.push(file.replace(ROOT + '/', ''));
        }
    }

    if (unusedServices.length > 0) {
        console.log('Services that appear to be unused:\n');
        unusedServices.forEach(f => console.log(`  ❓ ${f}`));
    } else {
        console.log('All services appear to be imported somewhere.');
    }

    // 7. FRONTEND/PUBLIC
    console.log('\n\n### 7. FRONTEND/PUBLIC FILES ###\n');
    const frontendFiles = allFiles.filter(f => f.includes('/frontend/'));
    if (frontendFiles.length > 0) {
        console.log('Frontend folder exists - may be obsolete (index.html is in root):\n');
        frontendFiles.forEach(f => console.log(`  - ${f.replace(ROOT + '/', '')}`));
    }

    // 8. SUMMARY
    console.log('\n\n' + '='.repeat(80));
    console.log('SUMMARY');
    console.log('='.repeat(80));
    console.log(`\nTotal files analyzed: ${allFiles.length}`);
    console.log(`  - JS files: ${jsFiles.length}`);
    console.log(`  - HTML files: ${htmlFiles.length}`);
    console.log(`  - MD files: ${mdFiles.length}`);
    console.log(`\nRoot-level JS files: ${rootJsFiles.length}`);
    console.log(`Test files: ${testFiles.length}`);
    console.log(`Potentially unused services: ${unusedServices.length}`);

    console.log('\n\nRECOMMENDATIONS:');
    console.log('1. Review root-level JS files - most appear to be one-off scripts');
    console.log('2. Consolidate HTML files - multiple contribute*.html variants');
    console.log('3. Move root-level docs to /docs or delete if outdated');
    console.log('4. Archive or delete test-*.js files');
    console.log('5. Remove frontend/public/ if not used');
    console.log('6. Check for duplicate server.js and database.js');
}

audit().catch(console.error);
