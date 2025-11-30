# 🌳 Conversational Tree Builder - User Guide

**Phase 2 of Genealogy AI is LIVE!**

Build multi-generation family trees through simple conversation - no coding required!

---

## 🚀 Quick Start

### **On Your Website:**

1. Go to your site: https://reparations-platform.onrender.com (or GitHub Pages)
2. Open the chat/research assistant
3. Type: **"build tree"**
4. Follow the prompts!

---

## 💬 Example Conversation

```
You: build tree

AI: 🌳 Family Tree Builder Started!

    Let's build a family tree together. I'll guide you through each step.

    Who is the ancestor? (the person at the root of this tree)

    Example: "James Hopewell" or "Nancy D'Wolf"

You: James Hopewell

AI: ✓ Root person: James Hopewell

    What are their birth and death years?

    Format: "BIRTH-DEATH" or "born YEAR died YEAR"

    Examples:
    - "1764-1837"
    - "born 1764 died 1837"
    - "1764-unknown" (if death year unknown)
    - "unknown" (if both unknown)

You: 1780-1825

AI: ✓ James Hopewell (1780-1825)

    How many children did James Hopewell have?

    Just type a number (e.g., "5" or "0" if none)

You: 3

AI: ✓ 3 children

    Let's add them one by one.

    Child #1 - What is their name, birth year, death year, and gender?

    Format: "NAME, BIRTH-DEATH, GENDER"

    Examples:
    - "Mary Ann DeWolf Sumner, 1795-1834, Female"
    - "Mark Antony D'Wolf, 1799-1851, Male"
    - "John Smith, 1800-unknown, Male"

You: Anne Maria Hopewell, 1805-1870, Female

AI: ✓ Added: Anne Maria Hopewell (1805-1870, Female)

    Did Anne Maria Hopewell have children? (grandchildren of James Hopewell)

    Type: "yes" or "no"

You: yes

AI: How many children did Anne Maria Hopewell have?

    Just type a number:

You: 2

AI: ✓ 2 grandchildren

    Grandchild #1 (child of Anne Maria Hopewell) - What is their name, birth year, death year, and gender?

    Format: "NAME, BIRTH-DEATH, GENDER"

You: John Hopewell Jr, 1830-1900, Male

AI: ✓ Added: John Hopewell Jr

    Grandchild #2 (child of Anne Maria Hopewell)

    Format: "NAME, BIRTH-DEATH, GENDER"

You: Sarah Hopewell, 1832-1905, Female

AI: ✓ Added: Sarah Hopewell

    Child #2 - What is their name, birth year, death year, and gender?

    Format: "NAME, BIRTH-DEATH, GENDER"

You: Robert Hopewell, 1810-1875, Male

AI: ✓ Added: Robert Hopewell (1810-1875, Male)

    Did Robert Hopewell have children?

You: no

AI: ✓ No grandchildren for Robert Hopewell

    Child #3 - What is their name, birth year, death year, and gender?

You: Elizabeth Hopewell, 1812-1880, Female

AI: ✓ Added: Elizabeth Hopewell (1812-1880, Female)

    Did Elizabeth Hopewell have children?

You: no

AI: ✓ No grandchildren

    📋 Family Tree Preview:

    James Hopewell (1780-1825)
    ├─ Anne Maria Hopewell (1805-1870, Female)
    │  ├─ John Hopewell Jr (1830-1900, Male)
    │  └─ Sarah Hopewell (1832-1905, Female)
    ├─ Robert Hopewell (1810-1875, Male)
    └─ Elizabeth Hopewell (1812-1880, Female)

    Save this tree? Type "yes" to save or "no" to cancel.

You: yes

AI: ✅ Tree Saved Successfully!

    Imported:
    • 1 root person (James Hopewell)
    • 3 children
    • 2 grandchildren
    • Total: 6 people

    You can now:
    - View it in the carousel (refresh page)
    - Click on James Hopewell to see descendants
    - Type "build another tree" to start a new one
```

---

## 📝 Supported Formats

### **Names:**
- Simple: "John Smith"
- With middle name: "Mary Ann Smith"
- With quotes/nicknames: "Mark 'Don Marcos' D'Wolf"
- Married names: "Mary Ann DeWolf Sumner"

### **Dates:**
- Full: "1795-1834"
- Unknown death: "1795-unknown"
- Unknown birth: "unknown-1834"
- Both unknown: "unknown"
- Alternative format: "born 1795 died 1834"

### **Gender:**
- "Male" or "M" or "male"
- "Female" or "F" or "female"
- Leave blank if unknown

### **Child Info Format:**
Always: `NAME, DATES, GENDER`

Examples:
- `Mary Ann Sumner, 1795-1834, Female`
- `John Smith, 1800-unknown, M`
- `Jane Doe, unknown-1850, Female`

---

## 🎯 Commands

| Command | What It Does |
|---------|-------------|
| `build tree` | Start tree builder |
| `add tree` | Start tree builder |
| `create family tree` | Start tree builder |
| `add descendants for [name]` | Start tree for specific person |
| `build another tree` | Start a new tree (after finishing one) |
| `yes` | Confirm save or indicate person had children |
| `no` | Cancel or indicate person had no children |
| `restart` | Restart tree building from beginning |

---

## ⚡ Tips

### **Speed Tips:**
1. **Have your data ready** before starting (names, dates, relationships)
2. **Use consistent format** for all children (speeds up typing)
3. **Type "no" quickly** if person has no children
4. **Copy-paste is allowed** for long names or multiple similar entries

### **Accuracy Tips:**
1. **Double-check dates** before confirming
2. **Verify parent-child relationships** as you go
3. **Use "unknown" for uncertain dates** rather than guessing
4. **Review the preview** carefully before typing "yes"

### **Complex Families:**
- **Multiple spouses**: Build separate trees for each spouse's line
- **Adopted children**: Add note in name (e.g., "John Smith (adopted)")
- **Step-children**: Build separate tree or note in name
- **Unknown children**: Use "Child of [Parent] (name unknown)" if you know they existed

---

## 🐛 Troubleshooting

### **"I couldn't parse that" error:**
- **Fix**: Use exact format `NAME, BIRTH-DEATH, GENDER`
- **Example**: `Mary Ann, 1795-1834, Female`

### **Wrong number of children:**
- **Fix**: Can't go back mid-tree, but you can cancel and restart
- Type `no` to cancel, then `build tree` to start over

### **Accidentally said "yes" when they had no children:**
- Just type `0` when asked how many children

### **Want to add more generations (great-grandchildren):**
- **Current limitation**: Tree builder only goes 2 generations (children + grandchildren)
- **Workaround**: Build separate tree starting with grandchild as root person

### **Need to edit a tree after saving:**
- Use the research assistant commands:
  - `[Person]'s daughter is [Name]`
  - `Add child [Name] to [Parent]`

---

## 🔄 What Happens After Saving

When you type "yes" to save:

1. ✅ Root person added to `individuals` table
2. ✅ All children added with parent-child relationships
3. ✅ All grandchildren added with correct parent linkage
4. ✅ Relationships table updated
5. ✅ Ready to view in carousel
6. ✅ Ready for debt/credit calculations

**To view:**
- Refresh your website
- Go to carousel
- Click on the root person's card
- See "Show Descendants" button
- Click to expand full tree!

---

## 📊 Current Limitations

| Feature | Status |
|---------|--------|
| Children + Grandchildren (2 generations) | ✅ Supported |
| Great-grandchildren (3+ generations) | ❌ Not yet (use separate trees) |
| Multiple spouses | ❌ Not yet (build separate trees) |
| Edit mid-tree (backtrack) | ❌ Not yet (must restart) |
| Import from text | ❌ Not yet (Phase 3) |
| Dates with ranges (1795-1800) | ❌ Not yet (use earliest year) |
| Sibling relationships | ✅ Implicit (same parent) |
| Cousin relationships | ✅ Implicit (via grandparents) |

---

## 🚀 Coming in Phase 3 (Future)

**Intelligent Text Parsing:**

Instead of step-by-step, you'll be able to paste:

```
James DeWolf (1764-1837) had 5 children:
1. Mary Ann (1795-1834) who had 3 kids: James Perry (1815-1876), Nancy (1819-1883), Alexander (1822-1888)
2. Mark Antony "Don Marcos" (1799-1851) who had 1 child: Francis (1826-1861)
...
```

And the AI will parse it automatically! 🤖

---

## 💡 Pro Tips

### **For Large Families:**
1. Build the tree in multiple sessions
2. Start with direct line (parent → oldest child → their children)
3. Then add siblings in separate conversations
4. Use spreadsheet to organize data before starting

### **For Research:**
1. Use tree builder for **verified** relationships only
2. For unconfirmed leads, use the URL submission (contribute page)
3. Add sources in notes field when building
4. Review carousel after saving to verify structure

### **For Collaboration:**
1. One person gathers data (spreadsheet)
2. Another person builds tree (via conversation)
3. Third person verifies in carousel
4. Everyone reviews before publishing

---

## 🎉 Success Stories

After Render deploys (~3 min), you can:

1. Build James Hopewell's family
2. Build Nancy D'Wolf's family
3. Build any historical figure's descendants
4. Use for your own family tree!

---

## 🆘 Need Help?

If you get stuck:
1. Type `restart` to start over
2. Type `build another tree` to skip current tree
3. Check format examples above
4. Make sure dates are in YYYY format
5. Use "unknown" for missing data

---

**Ready to build your first tree?** 🌳

Just type: `build tree`
