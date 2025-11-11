# FREE Natural Language Research Assistant - Setup Guide

## What You're Getting

A **100% FREE** natural language processing system that understands your questions and maintains conversation context - NO API KEYS, NO SUBSCRIPTIONS!

## Features

✅ **Natural Language Understanding**
- "Do you have James Hopewell?"
- "How many enslaved people did he own?"
- "What does he owe?"

✅ **Context Awareness**
- Remembers who you're talking about
- Handles follow-up questions
- "How many did **he** own?" (knows who "he" is)

✅ **Pronoun Resolution**
- Automatically replaces he/she/they with the actual person name
- Works across multiple questions

✅ **Intent Classification**
- Understands what you're asking for
- Search person, count enslaved, get reparations, show stats

✅ **Session Memory**
- Each user gets their own conversation context
- History persists during the session

## Files to Upload

1. **free-nlp-assistant.js** - The core NLP engine (NEW FILE)
2. **server.js** - Updated to use NLP system
3. **package.json** - No new dependencies needed!
4. **CLAUDE.md** - Updated documentation

## Installation Steps

### Step 1: Upload New File
1. Go to your GitHub repository
2. Click "Add file" → "Upload files"
3. Upload: `free-nlp-assistant.js`

### Step 2: Replace Existing Files
1. Replace `server.js` with the new version
2. Replace `package.json` with the new version
3. Replace `CLAUDE.md` with the new version

### Step 3: Deploy
- Render will auto-deploy when you push to GitHub
- No new environment variables needed!
- No npm install needed (uses existing dependencies)

## How It Works

### Example Conversation

```
You: "Do you have James Hopewell?"

Bot: "Yes, I found James Hopewell in the records.

📍 Location: Maryland
📅 Life: 1780 - 1825
📄 Documents: 3
⛓️ Enslaved: 32 people
💰 Reparations Owed: $70.4M"

---

You: "How many did he own?"

Bot: "James Hopewell enslaved 32 people according to the documents we have."

---

You: "What does he owe?"

Bot: "James Hopewell owes $70.4 million in reparations.

This is calculated based on 32 enslaved people documented in 3 document(s)."
```

## Supported Question Patterns

### Find a Person
- "Do you have [name]?"
- "Tell me about [name]"
- "Who is [name]?"
- "Find [name]"
- "Search for [name]"

### Count Enslaved People
- "How many enslaved people did [name] own?"
- "How many did [name] have?"
- "How many did he/she/they own?" (follow-up)

### Reparations Amount
- "How much does [name] owe?"
- "What reparations does [name] owe?"
- "What does he/she/they owe?" (follow-up)

### Get Statistics
- "Show me statistics"
- "How many total?"
- "What's in the database?"

### Follow-up Questions
After asking about a person, the system remembers them:
- "How many did **he** own?"
- "What does **she** owe?"
- "Tell me more about **them**"

## Technical Details

### How NLP Works

1. **Pattern Matching**
   - Uses regex to identify question types
   - Extracts person names using capitalization
   
2. **Intent Classification**
   - Categorizes: find_person, count_enslaved, reparations, statistics
   - High confidence scoring
   
3. **Entity Extraction**
   - Finds names: "James Hopewell"
   - Handles partial matches: "Hopewell"
   
4. **Context Management**
   - Stores last person mentioned
   - Tracks last intent
   - Maintains conversation history
   
5. **Pronoun Resolution**
   - Replaces pronouns with actual names
   - Works for: he, she, they, them, his, her, their
   
6. **Database Queries**
   - Searches: documents, enslaved_people, individuals tables
   - Returns formatted natural language responses

### Session Management

Each user gets a unique session:
- Tracked by sessionId (sent from frontend)
- Stores: last person, last intent, conversation history
- Persists until cleared or server restart

### No Dependencies!

This system uses:
- Pure JavaScript
- Regular expressions
- In-memory storage
- Existing PostgreSQL database

**NO external APIs, NO subscriptions, NO cost!**

## API Usage

### Send Query
```javascript
POST /api/llm-query
Body: {
  query: "How many did James Hopewell own?",
  sessionId: "user-12345"  // Optional, defaults to "default"
}

Response: {
  success: true,
  response: "James Hopewell enslaved 32 people...",
  intent: "count_enslaved",
  personName: "James Hopewell",
  resolved: false,
  source: "free-nlp"
}
```

### Clear History
```javascript
POST /api/clear-chat
Body: {
  sessionId: "user-12345"
}

Response: {
  success: true,
  message: "Chat history cleared"
}
```

## Limitations

**What it CAN do:**
- Answer specific factual questions
- Find people in database
- Count enslaved people
- Calculate reparations
- Show statistics
- Handle follow-up questions
- Remember conversation context

**What it CAN'T do:**
- Generate creative content
- Answer questions outside the database
- Understand very complex queries
- Handle multiple people in one question
- Provide historical analysis beyond facts

## Extending the System

Want to add more question types? Edit `intentPatterns` in `free-nlp-assistant.js`:

```javascript
new_question_type: [
    /your regex pattern here/i,
    /another pattern/i
]
```

## Troubleshooting

**"I couldn't find [person]"**
- Check spelling
- Try just last name
- Person might not be in database yet

**Follow-ups not working**
- Make sure sessionId stays the same
- Clear chat and start over if needed

**Pronouns resolving incorrectly**
- Clear chat history
- Be more specific with names

## Cost Comparison

**This System: $0/month** ✅
- No API keys
- No subscriptions  
- Unlimited queries
- Full conversation context

**Claude API: ~$15-50/month** ❌
**OpenAI GPT-4: ~$20-100/month** ❌

## Support

Your NLP system is now ready to use! Upload the files and test it out.

Questions to try:
1. "Do you have James Hopewell?"
2. "How many did he own?"
3. "What does he owe?"
4. "Show me statistics"

Enjoy your free, intelligent Research Assistant! 🎉
