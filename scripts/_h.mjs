import 'dotenv/config'; import pg from 'pg';
const p=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false},statement_timeout:120000});
const embed=async(t)=>{const r=await fetch('http://127.0.0.1:11434/api/embeddings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:'nomic-embed-text',prompt:t})});return (await r.json()).embedding;};
const q='enslaved person branded with a hot iron by the man who owned them';
const v='['+(await embed(q)).join(',')+']';
const r=await p.query(`SELECT 1-(e.embedding <=> $1::vector) sim, h.harm_type, h.victim_name, h.perpetrator_name, h.location
   FROM embeddings e JOIN harm_events h ON h.id = e.subject_id::int
  WHERE e.content_kind = 'harm_narrative' ORDER BY e.embedding <=> $1::vector LIMIT 5`,[v]);
console.log('  BEST HARM MATCHES for: '+q);
for(const x of r.rows) console.log('   '+x.sim.toFixed(3)+'  '+x.harm_type+' / '+x.victim_name+(x.perpetrator_name?' · perp '+x.perpetrator_name:'')+' · '+(x.location||''));
const rank=await p.query(`SELECT content_kind, count(*)::int n FROM (SELECT content_kind FROM embeddings ORDER BY embedding <=> $1::vector LIMIT 50) t GROUP BY 1 ORDER BY 2 DESC`,[v]);
console.log('  top-50 overall by kind: '+rank.rows.map(x=>x.content_kind+'='+x.n).join(' · '));
await p.end();
