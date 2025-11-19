const message = "How many owners are documented?";
const lower = message.toLowerCase();

console.log('Testing message:', message);
console.log('Lower:', lower);

// Test pattern
const match1 = lower.match(/how many (slave )?owner/i);
const match2 = lower.match(/count (of )?(slave )?owner/i);
const match3 = lower.match(/number of (slave )?owner/i);

console.log('Match 1 (how many owner):', match1);
console.log('Match 2 (count owner):', match2);
console.log('Match 3 (number of owner):', match3);

if (match1 || match2 || match3) {
  console.log('✓ Should match!');
} else {
  console.log('✗ No match');
}
