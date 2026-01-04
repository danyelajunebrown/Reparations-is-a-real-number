/**
 * Search Louisiana Slave Database for Reuters investigation ancestors
 * Focus on Louisiana-connected politicians and their slave-owning ancestors
 */
const { DBFFile } = require('dbffile');

async function searchReuters() {
    const dbf = await DBFFile.open('/Users/danyelabrown/Downloads/Slave/SLAVE.DBF');
    const records = await dbf.readRecords();

    // Louisiana-specific ancestors from Reuters investigation
    const louisianaCandidates = [
        { politician: 'John Bel Edwards (LA Governor)', ancestor: 'Daniel Edwards', enslaved: 57 },
        { politician: 'John Kennedy (LA Senator)', ancestor: 'Nathan Calhoun', enslaved: 65 },
        { politician: 'Amy Coney Barrett (SCOTUS)', ancestor: 'Joel J. Coney', enslaved: 21 },
        { politician: 'Mike Johnson (Speaker)', ancestor: 'Honore Fredieu', enslaved: 14 },
        { politician: 'Bill Cassidy (LA Senator)', ancestor: 'Pebles Hasty', enslaved: 4 },
        { politician: 'Garret Graves (LA Rep)', ancestor: 'Edmond Patin', enslaved: 4 },
        { politician: 'Julia Letlow (LA Rep)', ancestor: 'William N. Barnhill', enslaved: 2 }
    ];

    // Extract surnames for search
    const surnames = louisianaCandidates.map(c => {
        const parts = c.ancestor.split(' ');
        return parts[parts.length - 1].toLowerCase();
    });

    console.log('=== Louisiana Slave DB: Reuters Surname Search ===\n');

    const results = [];

    for (const surname of surnames) {
        const matches = [];
        for (const r of records) {
            const seller = (r.SELLER || '').toLowerCase();
            const buyer = (r.BUYER || '').toLowerCase();
            const estate = (r.ESTATE_OF || '').toLowerCase();

            if (seller.includes(surname) || buyer.includes(surname) || estate.includes(surname)) {
                const owner = r.SELLER || r.BUYER || ('Estate of ' + r.ESTATE_OF);
                const first = r.FIRST1 || r.FIRST2 || '';
                const fullName = first ? first + ' ' + owner : owner;
                const found = matches.find(m => m.name === fullName);
                if (!found) {
                    matches.push({ name: fullName.trim(), year: r.YEAR, location: r.LOCATION });
                }
            }
        }

        if (matches.length > 0) {
            console.log(`✅ ${surname.toUpperCase()}: ${matches.length} slaveholders FOUND`);
            matches.slice(0, 5).forEach(m => console.log(`   - ${m.name} (${m.year})`));
            if (matches.length > 5) console.log(`   ... and ${matches.length - 5} more`);
            results.push({ surname, count: matches.length, examples: matches.slice(0, 3) });
        } else {
            console.log(`❌ ${surname.toUpperCase()}: not found`);
        }
    }

    console.log('\n=== SUMMARY ===');
    console.log(`Found ${results.length} matching surnames out of ${surnames.length} searched`);
}

searchReuters().catch(console.error);
