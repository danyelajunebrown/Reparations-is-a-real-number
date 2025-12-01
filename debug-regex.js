// Debug: Test regex pattern directly on sample rows

const sampleRows = `1.    Ezekl. Biscoe    Male    65.    Mulatto    $500:–
2.    Sam'l Wilson    "    52.    dark brown    $800:–
3.    John Bealle    "    32.    chestnut    $600:–
4.    Nancy Grey    Female    42.    dark brown    $800:–
8.    Eliza A Washington    Female    24.    chestnut    $1000:–`;

console.log('Testing numbered row pattern:\n');

// Improved pattern - more flexible for variable spacing and ditto marks
const pattern = /^(\d+)\.\s+([A-Z][\w'\.\s]+?)\s{2,}[\w"\s]*?\s+(\d+)\./gm;

const matches = [...sampleRows.matchAll(pattern)];

console.log(`Found ${matches.length} matches:\n`);

matches.forEach((match, i) => {
  console.log(`Match ${i + 1}:`);
  console.log(`  Row: ${match[1]}`);
  console.log(`  Name: "${match[2]}"`);
  console.log(`  Age: ${match[3]}`);
  console.log(`  Full match: "${match[0]}"\n`);
});

// Test what each row looks like
console.log('\nDebugging individual rows:');
const rows = sampleRows.split('\n');
rows.forEach((row, i) => {
  console.log(`Row ${i + 1}: "${row}"`);
  const match = row.match(pattern);
  console.log(`  Matches: ${match ? 'YES' : 'NO'}`);
  if (match) {
    console.log(`  Name captured: "${match[2]}"`);
  }
  console.log();
});
