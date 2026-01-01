@echo off
REM =============================================================================
REM FIRST TIME SETUP - DOUBLE-CLICK THIS FIRST (Windows)
REM =============================================================================

echo.
echo ========================================================================
echo   FIRST TIME SETUP
echo ========================================================================
echo.

REM Check for Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo X Node.js not installed!
    echo.
    echo    Please install Node.js first:
    echo    1. Go to https://nodejs.org
    echo    2. Download the LTS version
    echo    3. Run the installer
    echo    4. Restart this script
    echo.
    pause
    exit /b 1
)

echo OK Node.js found
node --version
echo.

REM Install dependencies
echo Installing dependencies (this may take a few minutes)...
call npm install

echo.
echo ========================================================================
echo   FAMILYSEARCH LOGIN
echo ========================================================================
echo.
echo A browser window will open.
echo Please log into FamilySearch, then come back here.
echo.
pause

REM Run a quick test to trigger login
set FAMILYSEARCH_INTERACTIVE=true
node scripts/extract-census-ocr.js --state Delaware --year 1860 --limit 1

echo.
echo ========================================================================
echo   SETUP COMPLETE!
echo ========================================================================
echo.
echo   Now double-click START-SCRAPER.bat each day to run.
echo.
pause
