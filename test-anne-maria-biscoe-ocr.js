const axios = require('axios');

const ocrText = `Title: Petition of Ann M. Biscoe, Angelica Chew, and Emma Biscoe, 26 May 1862
Date: May 26, 1862

Schedule A. M. B.
no.    Name    Sex    Age    Color    Value    Particular description
1.    Ezekl. Biscoe    Male    65.    Mulatto    $500:–    white washer at 1.25 a day
2.    Sam'l Wilson    "    52.    dark brown    $800:–    Driver—$11 a month, dear.
3.    John Bealle    "    32.    chestnut    $600:–    Laborer—blind in one eye. 8$ a month, dear.
4.    Nancy Grey    Female    42.    dark brown    $800:–    cook. 6$ a month.
5.    John Grey    male    17.    black    $800–    in grocery store. 8$ a month
6.    James Grey    "    14.    "    $600:–
7.    Horace Grey    "    12.    "    $400:–    Children of Nancy Grey Laborers.
8.    Eliza A Washington    Female    24.    chestnut    $1000:–    cook at 6$ a month
9.    Clara Washington    "    2.    light brown    100:–    her child
10.    Ellen Waring    "    23.    black    1000:–    house servt. 6$ a month
11.    Reba. Herbert    "    35.    chestnut    1000:–    cook washer &c
12.    Martha Herbert    " "    16.    light brown    800:–    nurse. house servant
13.    Henry Herbert    male    14.    "    600:–
14.    Levi Herbert    "    12.    black    400:–    Children of Reba. Herbert
15.    Margt. Coleman    Female    28.    light brown    1000:–    cook &c 6$ a month
16.    Sallie Coleman    "    15.    "    800:–    house servant
17.    Alice Coleman    "    13.    black    500:–    "
18.    Laura Coleman    "    8.    light brown    400:–
19.    Juliet Coleman    "    6.    "    300:–
20.    Fredk. Coleman    male    2    black    150:–
21.    Wm Coleman    "    1 month.    brown    25–    children of Margt. Coleman
22.    Maria Bealle    Female    32    light brown    1000–    cook &c
23.    Nichs. Bealle    male    9    chestnut    400–
24.    Geo. Bealle    male    3    light brown    200–    children of Maria Bealle
25.    Cecilia Bealle    Female    23    chestnut    1000:–    cook &c
26.    Ida Bealle    "    2    mulatto    100:–    her child

That your petitioners acquired their said claim to the aforesaid service or labor of said persons...
from her late father James Hopewell of St. Mary's County, Maryland, deceased...`;

async function testOCRUpload() {
  try {
    console.log('Testing pre-OCR text upload for Ann M. Biscoe petition...\n');

    const response = await axios.post('http://localhost:3000/api/upload-document-with-text', {
      ownerName: 'Ann M. Biscoe',
      documentType: 'other',
      textContent: ocrText,
      textSource: 'archive',
      location: 'Georgetown, District of Columbia',
      birthYear: 1799,
      deathYear: 1870,
      notes: 'Compensated Emancipation Petition - National Archives'
    });

    console.log('✓ Upload successful!\n');
    console.log('Document ID:', response.data.documentId);
    console.log('Enslaved people parsed:', response.data.parsed?.enslaved_count || 0);
    console.log('Parsing method:', response.data.parsed?.method);
    console.log('Confidence:', response.data.parsed?.confidence);

    if (response.data.result?.enslaved_people) {
      console.log('\nExtracted names:');
      response.data.result.enslaved_people.forEach((person, i) => {
        console.log(`  ${i + 1}. ${person.name}`);
      });
    }

    console.log('\n✓ Test complete - Should have found 26 enslaved people');

  } catch (error) {
    console.error('✗ Test failed:', error.response?.data || error.message);
  }
}

testOCRUpload();
