import 'dotenv/config';
import pg from 'pg';
import { ROSTER } from './_audit_roster.mjs';

const p = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized:false} });

// name -> {first token, last "real" token}. Strip suffixes/roman numerals/titles.
const STOP = new Set(['jr','jr.','sr','sr.','ii','iii','iv','v','1st','2nd','3rd','4th','baron','baronet','earl','sir','of','the','de','da','dos','von','del','la','le','ibn','al','di']);
function tokens(name){
  return name.replace(/[".,]/g,' ').split(/\s+/).filter(Boolean);
}
function firstLast(name){
  const t = tokens(name);
  const first = t[0];
  // last real token = last token not in STOP
  let last = null;
  for (let i=t.length-1;i>=0;i--){ if(!STOP.has(t[i].toLowerCase())){ last=t[i]; break; } }
  return { first, last: last||first };
}
const sigOK = (rowY, targetY) => targetY!=null && rowY!=null && Math.abs(rowY-targetY)<=3;

async function probe(name,b,d){
  const {first,last}=firstLast(name);
  // canonical: name must contain BOTH first and last token (order-agnostic)
  const canon = await p.query(
    `select id, canonical_name nm, person_type pt, birth_year_estimate b, death_year_estimate d,
            primary_state st, created_by cb, assertable_slaveowner aso, assertable_enslaved ae
       from canonical_persons
      where canonical_name ILIKE $1 and canonical_name ILIKE $2
      limit 60`, [`%${first}%`,`%${last}%`]);
  const leads = await p.query(
    `select lead_id id, full_name nm, person_type pt, birth_year b, death_year d,
            array_to_string(locations,',') loc, source_url su
       from unconfirmed_persons
      where full_name ILIKE $1 and full_name ILIKE $2
      limit 60`, [`%${first}%`,`%${last}%`]);

  const canonRows = canon.rows, leadRows = leads.rows;
  const canonSig = canonRows.filter(r=>sigOK(r.b,b)||sigOK(r.d,d));
  const leadSig  = leadRows.filter(r=>sigOK(r.b,b)||sigOK(r.d,d));
  const anyName = canonRows.length+leadRows.length>0;
  const knowsYear = b!=null||d!=null;
  const servedRow = canonSig.find(r=>r.aso||r.ae);

  let tier;
  if(canonSig.length && servedRow) tier='CANDIDATE (sig+assertable — verify identity!)';
  else if(canonSig.length) tier='CANDIDATE (canonical sig-match, gated)';
  else if(leadSig.length) tier='CANDIDATE (lead sig-match)';
  else if(!anyName) tier='NO_TRACE';
  else if(knowsYear) tier='NAMESAKES_ONLY (absent for intended)';
  else tier='NAME_HIT_UNRESOLVED (no year to disambiguate)';

  return { name,b,d,tier,
    nCanon:canonRows.length,nCanonSig:canonSig.length,
    nLeads:leadRows.length,nLeadSig:leadSig.length,
    sigIds: canonSig.slice(0,3).map(r=>`${r.id}:${r.nm}[${r.b||''}-${r.d||''}]${r.aso?'*ASO':''}`),
  };
}

const out=[];
for(const [n,b,d,c] of ROSTER){
  const r = await probe(n,b,d);
  r.c=c;
  out.push(r);
  console.error(`${r.tier.padEnd(42)} | ${n} (${b||'?'}-${d||'?'}) [${c}] canon=${r.nCanon}/${r.nCanonSig} lead=${r.nLeads}/${r.nLeadSig}`);
}
console.log(JSON.stringify(out));
await p.end();
