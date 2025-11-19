const message1 = "who is James Hopewell's wife?";
const message2 = "who is James Hopewell's son?";
const message3 = "who are James Hopewell's children?";

function testPattern(message) {
  const lower = message.toLowerCase();
  console.log('\nTesting:', message);
  console.log('Lower:', lower);

  const match = lower.match(/who (is|are|was|were) .*('s|'s).*(wife|spouse|husband|children|son|daughter|parent)/i);
  console.log('Regex match:', match ? 'YES' : 'NO');
  if (match) {
    console.log('Match result:', match[0]);
  }
}

testPattern(message1);
testPattern(message2);
testPattern(message3);
