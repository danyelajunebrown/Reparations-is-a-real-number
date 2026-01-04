/**
 * Debug WikiTree search
 */
const https = require('https');

const query = new URLSearchParams({
    'FirstName': 'James',
    'LastName': 'Hopewell'
});

const url = 'https://www.wikitree.com/wiki/Special:SearchPerson?' + query.toString();
console.log('URL:', url);
console.log('');

https.get(url, {
    headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html'
    }
}, (res) => {
    let data = '';
    res.on('data', chunk => { data += chunk; });
    res.on('end', () => {
        // Look for WikiTree ID patterns
        const idPattern = /href="\/wiki\/([A-Za-z]+-\d+)"/g;
        let match;
        const ids = [];
        while ((match = idPattern.exec(data)) !== null) {
            ids.push(match[1]);
        }
        console.log('Found WikiTree IDs:', [...new Set(ids)].slice(0, 15));

        // Check if redirected or blocked
        console.log('Response status:', res.statusCode);
        console.log('Content length:', data.length);

        // Check for Hopewell in response
        const hopewellCount = (data.match(/Hopewell/gi) || []).length;
        console.log('Mentions of Hopewell:', hopewellCount);

        // Look for the actual search results table
        if (data.includes('No matching people found')) {
            console.log('\nSearch returned: No matching people found');
        }

        // Look for Hopewell-183 specifically
        if (data.includes('Hopewell-183')) {
            console.log('\n✓ Found Hopewell-183 in response!');
        }

        // Sample of result area
        const resultStart = data.indexOf('searchResultsTable');
        if (resultStart > -1) {
            console.log('\nSearch results table found at position:', resultStart);
            console.log('Sample:', data.substring(resultStart, resultStart + 500));
        } else {
            console.log('\nNo searchResultsTable found');

            // Check what we got
            const titles = data.match(/<title>([^<]+)<\/title>/);
            if (titles) {
                console.log('Page title:', titles[1]);
            }
        }
    });
}).on('error', console.error);
