@echo off
REM =============================================================================
REM CHECK SCRAPER PROGRESS (Windows)
REM =============================================================================

echo.
echo ========================================================================
echo   CHECKING SCRAPER PROGRESS
echo ========================================================================
echo.

node -e "const{neon}=require('@neondatabase/serverless');require('dotenv').config();const sql=neon(process.env.DATABASE_URL);(async()=>{const r=await sql`SELECT DATE(created_at) as date, COUNT(*) as records FROM unconfirmed_persons WHERE source_url LIKE '%%1860%%Slave%%' AND created_at > NOW() - INTERVAL '7 days' GROUP BY DATE(created_at) ORDER BY date DESC`;console.log('Records extracted per day:');console.table(r);const t=await sql`SELECT COUNT(*) as total FROM unconfirmed_persons WHERE source_url LIKE '%%1860%%Slave%%'`;console.log('Total 1860 Slave Schedule records:',t[0].total);})().catch(console.error);"

echo.
pause
