// ===================================================================
// RENDER COLD START FIX FOR RESEARCH ASSISTANT
// ===================================================================
// This script fixes the "network connection was lost" error caused by
// Render's free tier spinning down after 15 minutes of inactivity.
//
// INSTRUCTIONS:
// 1. Add this script to your index.html BEFORE the closing </body> tag:
//    <script src="render-cold-start-fix.js"></script>
//
// 2. Or copy the sendChatMessage function below and replace the existing
//    sendChatMessage function in your index.html
// ===================================================================

async function sendChatMessage() {
    const input = document.getElementById('chatInput');
    const messagesDiv = document.getElementById('chatMessages');
    const query = input.value.trim();

    if (!query) return;

    // Add user message
    addChatMessage('user', query);
    input.value = '';

    // Add loading indicator with helpful message
    const loadingId = 'loading-' + Date.now();
    addChatMessage('assistant', 'Searching database... (If backend is sleeping, this may take 60 seconds)', loadingId);

    try {
        // IMPORTANT: Extended timeout for Render cold starts (free tier)
        // Render spins down after 15 minutes and takes 30-60 seconds to wake up
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 90000); // 90 second timeout

        const response = await fetch(`${API_BASE_URL}/api/llm-query`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                query: query,
                context: { currentDatabase: 'reparations' }
            }),
            signal: controller.signal  // Add abort controller signal
        });

        clearTimeout(timeoutId);

        const data = await response.json();

        // Remove loading message
        const loadingMsg = document.getElementById(loadingId);
        if (loadingMsg) loadingMsg.remove();

        if (data.success) {
            addChatMessage('assistant', data.response);

            // Update the big window with evidence if provided
            if (data.evidence) {
                updateEvidenceDisplay(data.evidence);
            }
        } else {
            addChatMessage('assistant', 'Error: ' + data.error);
        }

    } catch (error) {
        // Remove loading message
        const loadingMsg = document.getElementById(loadingId);
        if (loadingMsg) loadingMsg.remove();

        // Provide helpful error messages based on error type
        if (error.name === 'AbortError') {
            // Request timed out after 90 seconds
            addChatMessage('assistant',
                'Request timed out after 90 seconds. The backend may still be waking up. ' +
                'Please wait another 30 seconds and try again. ' +
                '(Render free tier takes 30-60 seconds to wake from sleep)'
            );
        } else if (error.message &&
                   (error.message.includes('Failed to fetch') ||
                    error.message.includes('network') ||
                    error.message.includes('connection was lost'))) {
            // Network error - likely Render cold start
            addChatMessage('assistant',
                'Backend is waking up from sleep (Render free tier cold start). ' +
                'This typically takes 30-60 seconds on first request. ' +
                'Please wait 60 seconds and retry your query.'
            );
        } else {
            // Other errors
            addChatMessage('assistant',
                `Connection error: ${error.message || 'Unable to reach backend'}. ` +
                `If this persists, the backend at ${API_BASE_URL} may be down.`
            );
        }
    }
}

// Wake-up ping function - call this on page load to wake up Render
async function pingBackendToWakeUp() {
    try {
        console.log('Pinging backend to wake it up...');
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

        await fetch(`${API_BASE_URL}/health`, {
            method: 'GET',
            signal: controller.signal
        });

        clearTimeout(timeoutId);
        console.log('Backend is awake!');
    } catch (error) {
        console.log('Backend may be waking up (this is normal):', error.message);
    }
}

// Auto-ping backend when page loads to reduce cold start delay
if (typeof API_BASE_URL !== 'undefined') {
    pingBackendToWakeUp();
}
