# Remote Scraper Setup Guide (macOS)

## Overview
This guide sets up the 1860 Slave Schedule scraper to run autonomously on a remote macOS machine.

**Estimated setup time:** 15-20 minutes
**Estimated runtime:** Days to weeks (15 states, ~100k+ images)

---

## Prerequisites

### 1. Install Homebrew (if not installed)
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

### 2. Install Node.js 18+
```bash
brew install node@18
```

Verify:
```bash
node --version  # Should be v18.x or higher
npm --version   # Should be v9.x or higher
```

### 3. Install Google Chrome
Download from https://www.google.com/chrome/ or:
```bash
brew install --cask google-chrome
```

---

## Project Setup

### 1. Transfer the Project
**Option A: Git clone (recommended)**
```bash
cd ~/Desktop
git clone https://github.com/danyelajunebrown/Reparations-is-a-real-number.git
cd Reparations-is-a-real-number
```

**Option B: USB drive / AirDrop**
Copy the entire project folder to `~/Desktop/Reparations-is-a-real-number`

### 2. Install Dependencies
```bash
cd ~/Desktop/Reparations-is-a-real-number
npm install
```

### 3. Configure Environment
Create `.env` file with database credentials:
```bash
cat > .env << 'EOF'
# Database (Neon PostgreSQL)
DATABASE_URL=postgresql://neondb_owner:npg_2S8LrhzkZmad@ep-still-glade-ad8qq83f-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require

# Google Cloud Vision (for OCR)
GOOGLE_APPLICATION_CREDENTIALS=./google-vision-key.json

# FamilySearch (session managed via browser)
FAMILYSEARCH_INTERACTIVE=true
EOF
```

### 4. Copy Google Vision Key
Copy `google-vision-key.json` from the original machine to the project root.

---

## FamilySearch Authentication

### First-Time Login
The scraper needs FamilySearch authentication. On first run:

1. Run the scraper with visible browser:
```bash
FAMILYSEARCH_INTERACTIVE=true node scripts/extract-census-ocr.js --state Delaware --year 1860 --limit 1
```

2. A Chrome window will open to FamilySearch
3. Log in with your FamilySearch account
4. Complete any 2FA if prompted
5. The scraper will detect login and continue
6. Cookies are saved to `.chrome-profile/` for future sessions

### Session Refresh
If the session expires (you'll see 403 errors), just re-run with `FAMILYSEARCH_INTERACTIVE=true` and log in again.

---

## Running the Scraper

### Option 1: Full Autonomous Run (All States)
```bash
cd ~/Desktop/Reparations-is-a-real-number
./scripts/run-all-1860-slave-schedules.sh
```

This will:
- Process all 15 states alphabetically
- Auto-retry on crashes (5 attempts per state)
- Log to `logs/1860-slave-schedules/`
- Track progress and resume if interrupted

### Option 2: Single State
```bash
FAMILYSEARCH_INTERACTIVE=true node scripts/extract-census-ocr.js --state "Virginia" --year 1860
```

### Option 3: Background with nohup
Run without needing terminal open:
```bash
nohup ./scripts/run-all-1860-slave-schedules.sh > logs/master-scraper.log 2>&1 &
```

Check progress:
```bash
tail -f logs/master-scraper.log
```

### Option 4: Screen session (recommended for remote)
```bash
# Start screen session
screen -S scraper

# Run the scraper
./scripts/run-all-1860-slave-schedules.sh

# Detach: Press Ctrl+A, then D
# Reattach later: screen -r scraper
```

---

## Preventing Sleep/Shutdown

### Prevent Sleep While Running
```bash
caffeinate -i ./scripts/run-all-1860-slave-schedules.sh
```

### Disable Sleep in System Settings
1. System Settings → Battery → Options
2. Set "Prevent automatic sleeping when display is off" to ON
3. Set "Wake for network access" to ON

### Keep Display On (if needed for visible browser)
1. System Settings → Lock Screen
2. Set "Turn display off" to Never (while plugged in)

---

## Monitoring Progress

### Check Logs
```bash
# Current state log
ls -la logs/1860-slave-schedules/

# Tail latest log
tail -f logs/1860-slave-schedules/$(ls -t logs/1860-slave-schedules/*.log | head -1)
```

### Check Master Progress
```bash
cat logs/1860-slave-schedules/.master-progress
# Output: number = states completed (0-15)
```

### Check Database Records
```bash
node -e "
const { neon } = require('@neondatabase/serverless');
require('dotenv').config();
const sql = neon(process.env.DATABASE_URL);
sql\`SELECT source_url, COUNT(*) as records FROM unconfirmed_persons WHERE source_url LIKE '%1860%Slave%' GROUP BY source_url ORDER BY records DESC LIMIT 20\`.then(r => console.table(r));
"
```

---

## Troubleshooting

### "Detached Frame" Errors
FamilySearch session expired. Re-run with `FAMILYSEARCH_INTERACTIVE=true` and log in again.

### "ENOTFOUND" Database Errors
Network connectivity issue. Check internet connection.

### Chrome Crashes
Delete the Chrome profile and re-authenticate:
```bash
rm -rf .chrome-profile
FAMILYSEARCH_INTERACTIVE=true node scripts/extract-census-ocr.js --state Delaware --year 1860 --limit 1
```

### Disk Space
Check available space (OCR creates temp files):
```bash
df -h
```

---

## State Progress Checklist

| # | State | Status | Records | Notes |
|---|-------|--------|---------|-------|
| 1 | Alabama | ⏳ Queued | - | |
| 2 | Arkansas | 🔄 In Progress | ~43k | Started Dec 2024 |
| 3 | Delaware | ⏳ Queued | - | Small state |
| 4 | Florida | ⏳ Queued | - | |
| 5 | Georgia | ⏳ Queued | - | Large state |
| 6 | Kentucky | ⏳ Queued | - | |
| 7 | Louisiana | ⏳ Queued | - | |
| 8 | Maryland | ⏳ Queued | - | |
| 9 | Mississippi | ⏳ Queued | - | Large state |
| 10 | Missouri | ⏳ Queued | - | |
| 11 | North Carolina | ⏳ Queued | - | |
| 12 | South Carolina | ⏳ Queued | - | |
| 13 | Tennessee | ⏳ Queued | - | |
| 14 | Texas | ⏳ Queued | - | |
| 15 | Virginia | ⏳ Queued | - | Largest state |

---

## Support

If issues persist, check:
1. `logs/1860-slave-schedules/` for detailed error logs
2. Network connectivity to FamilySearch and Neon database
3. Available disk space and memory
