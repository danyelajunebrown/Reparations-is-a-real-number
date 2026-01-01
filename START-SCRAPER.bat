@echo off
REM =============================================================================
REM DOUBLE-CLICK TO START SCRAPER (Windows)
REM =============================================================================

echo.
echo ========================================================================
echo   1860 SLAVE SCHEDULE SCRAPER
echo ========================================================================
echo   Starting at: %date% %time%
echo   This will resume from where it left off.
echo.
echo   DO NOT CLOSE THIS WINDOW
echo   You can minimize it.
echo ========================================================================
echo.

set FAMILYSEARCH_INTERACTIVE=true

:loop
echo.
echo Starting scraper run at %time%...
echo.

node scripts/extract-census-ocr.js --year 1860 --limit 100

echo.
echo Run completed at %time%
echo Restarting in 30 seconds... (Press Ctrl+C to stop)
timeout /t 30

goto loop
