#!/bin/bash

echo "🧹 Cleaning up git repository..."
echo "This will remove .chrome-profile from git history to reduce repo size"
echo ""

# Remove .chrome-profile from all commits
echo "Step 1: Removing .chrome-profile from git history..."
git filter-branch --force --index-filter \
  "git rm -rf --cached --ignore-unmatch .chrome-profile" \
  --prune-empty --tag-name-filter cat -- --all

# Force garbage collection
echo ""
echo "Step 2: Running garbage collection..."
git reflog expire --expire=now --all
git gc --prune=now --aggressive

# Show new size
echo ""
echo "Step 3: Checking new repository size..."
du -sh .git

# Push to GitHub
echo ""
echo "Step 4: Pushing to GitHub..."
git push origin main --force

echo ""
echo "✅ Done! Render will auto-deploy in 2-3 minutes."
echo "Your backend changes will be live shortly."
