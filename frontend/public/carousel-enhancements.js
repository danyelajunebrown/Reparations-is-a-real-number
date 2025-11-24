/**
 * Carousel Enhancements for Reparations Platform
 * - Load data from database
 * - Display both owners and enslaved people
 * - Click interaction for descendants
 * - Auto-trigger queue processing
 */

// ============================================
// CAROUSEL DATA LOADING
// ============================================

/**
 * Load carousel data from API
 */
async function loadCarouselData() {
    try {
        console.log('🎠 Loading carousel data from database...');
        const response = await fetch(`${API_BASE_URL}/api/carousel-data?limit=50`);
        const data = await response.json();

        if (data.success && data.cards) {
            window.ownersData = data.cards; // Update global ownersData
            console.log(`✅ Loaded ${window.ownersData.length} cards (${data.breakdown.owners} owners, ${data.breakdown.enslaved} enslaved)`);

            // Re-initialize carousel with new data
            if (typeof initializeCarouselEnhanced === 'function') {
                initializeCarouselEnhanced();
            } else if (typeof initializeCarousel === 'function') {
                initializeCarousel();
            }

            if (typeof updateStatsDisplay === 'function') {
                updateStatsDisplay();
            }
        } else {
            console.error('Failed to load carousel data:', data);
        }
    } catch (error) {
        console.error('Error loading carousel data:', error);
    }
}

/**
 * Enhanced carousel initialization
 * Shows both slave owners and enslaved people with click interactions
 */
function initializeCarouselEnhanced() {
    const carousel = document.getElementById('carousel');
    if (!carousel) return;

    carousel.innerHTML = '';

    if (!window.ownersData || window.ownersData.length === 0) {
        carousel.innerHTML = '<div style="color: #9aa5b1; text-align: center; padding: 40px; max-width: 400px; margin: 0 auto;">No data loaded yet. Upload documents to populate the carousel.</div>';
        return;
    }

    const angleStep = 360 / window.ownersData.length;

    window.ownersData.forEach((card, index) => {
        const domCard = document.createElement('div');
        domCard.className = 'tree-card';

        const angle = angleStep * index;
        const radius = 700; // Increased from 500 for wider display
        domCard.style.transform = `rotateY(${angle}deg) translateZ(${radius}px)`;
        domCard.dataset.personName = card.name;
        domCard.dataset.personType = card.type;
        domCard.dataset.cardIndex = index;

        // Card header - different colors for owner vs enslaved
        const headerColor = card.type === 'owner' ? '#ff6464' : '#64c8ff';
        const typeLabel = card.type === 'owner' ? '⚖️ Slave Owner' : '🕊️ Enslaved Person';

        let content = `
            <div class="owner-name" style="color: ${headerColor};">
                ${card.name}
                <div style="font-size: 0.7em; color: #9aa5b1; font-weight: normal; margin-top: 3px;">${typeLabel}</div>
            </div>
            <div class="tree-content">
                <div style="color: #9aa5b1; font-size: 0.85em; margin-bottom: 10px;">
                    ${card.location || 'Location unknown'}<br>
                    ${card.birthYear && card.deathYear ? `${card.birthYear}-${card.deathYear}` :
                      card.birthYear ? `Born: ${card.birthYear}` :
                      card.deathYear ? `Died: ${card.deathYear}` : ''}
                </div>
        `;

        // Type-specific content
        if (card.type === 'owner') {
            content += `
                <div style="margin-bottom: 10px;">
                    <div style="color: #ffaa00; font-weight: bold; font-size: 1.1em;">
                        ${card.enslavedCount || 0} people enslaved
                    </div>
                    <div style="color: #ff6464; font-weight: bold; font-size: 1em; margin-top: 5px;">
                        Debt: $${((card.debt || 0) / 1000000).toFixed(2)}M
                    </div>
                </div>
            `;

            if (card.documentTypes && card.documentTypes.length > 0) {
                content += '<div style="margin-bottom: 10px;">';
                card.documentTypes.forEach(type => {
                    if (type) content += `<span class="document-badge">${type.toUpperCase()}</span>`;
                });
                content += '</div>';
            }
        } else {
            // Enslaved person
            content += `
                <div style="margin-bottom: 10px;">
                    ${card.enslavedBy ? `<div style="color: #9aa5b1; font-size: 0.85em;">Enslaved by: ${card.enslavedBy}</div>` : ''}
                    <div style="color: #64ff64; font-weight: bold; font-size: 1em; margin-top: 5px;">
                        Credit: $${((card.credit || 0) / 1000000).toFixed(2)}M
                    </div>
                    ${card.verified ? '<div style="color: #64ff64; font-size: 0.75em; margin-top: 3px;">✓ Verified</div>' : ''}
                </div>
            `;
        }

        // Click to expand descendants (collapsible area)
        content += `
            <div id="descendants-${index}" style="display: none; margin-top: 10px; padding-top: 10px; border-top: 1px solid rgba(100, 200, 255, 0.3);">
                <div style="text-align: center; color: #64c8ff; font-size: 0.85em;">Loading descendants...</div>
            </div>
            <button onclick="toggleDescendants('${escapeQuotes(card.name)}', '${card.type}', ${index})"
                    id="btn-${index}"
                    style="margin-top: 10px; padding: 8px 12px; background: rgba(100, 200, 255, 0.2);
                           border: 1px solid #64c8ff; color: #64c8ff; border-radius: 5px;
                           cursor: pointer; width: 100%; font-size: 0.85em;">
                <span id="btn-text-${index}">👥 Show Descendants (1-2 gen)</span>
            </button>
        `;

        content += '</div>';
        domCard.innerHTML = content;
        carousel.appendChild(domCard);
    });
}

/**
 * Escape quotes in strings for HTML attributes
 */
function escapeQuotes(str) {
    return str.replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

// ============================================
// DESCENDANTS INTERACTION
// ============================================

// Track which cards have descendants loaded
const descendantsCache = {};

/**
 * Toggle descendants display for a person
 */
async function toggleDescendants(personName, personType, cardIndex) {
    const descendantsDiv = document.getElementById(`descendants-${cardIndex}`);
    const btnText = document.getElementById(`btn-text-${cardIndex}`);

    if (!descendantsDiv) return;

    // If already showing, hide
    if (descendantsDiv.style.display !== 'none') {
        descendantsDiv.style.display = 'none';
        btnText.textContent = '👥 Show Descendants (1-2 gen)';
        return;
    }

    // Show and load if not cached
    descendantsDiv.style.display = 'block';
    btnText.textContent = '🔽 Hide Descendants';

    // Check cache
    const cacheKey = `${personType}-${personName}`;
    if (descendantsCache[cacheKey]) {
        renderDescendants(descendantsDiv, descendantsCache[cacheKey], personType);
        return;
    }

    // Load from API
    try {
        descendantsDiv.innerHTML = '<div style="text-align: center; color: #64c8ff; font-size: 0.85em;">Loading...</div>';

        const response = await fetch(`${API_BASE_URL}/api/get-descendants`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                personName,
                personType,
                generations: 2
            })
        });

        const data = await response.json();

        if (data.success) {
            descendantsCache[cacheKey] = data.descendants;
            renderDescendants(descendantsDiv, data.descendants, personType);
        } else {
            descendantsDiv.innerHTML = '<div style="color: #ff6464; font-size: 0.8em; text-align: center;">Failed to load descendants</div>';
        }
    } catch (error) {
        console.error('Error loading descendants:', error);
        descendantsDiv.innerHTML = '<div style="color: #ff6464; font-size: 0.8em; text-align: center;">Error loading descendants</div>';
    }
}

/**
 * Render descendants in the descendants div
 */
function renderDescendants(container, descendants, personType) {
    if (!descendants || descendants.length === 0) {
        container.innerHTML = '<div style="color: #9aa5b1; font-size: 0.8em; text-align: center; font-style: italic;">No descendants found in database</div>';
        return;
    }

    // Group by generation
    const byGeneration = {};
    descendants.forEach(d => {
        if (!byGeneration[d.generation]) {
            byGeneration[d.generation] = [];
        }
        byGeneration[d.generation].push(d);
    });

    let html = '';
    Object.keys(byGeneration).sort().forEach(gen => {
        const genNum = parseInt(gen);
        const genLabel = genNum === 1 ? 'Children' : genNum === 2 ? 'Grandchildren' : `Gen ${genNum}`;

        html += `<div style="margin-bottom: 8px;">`;
        html += `<div style="color: #64c8ff; font-size: 0.75em; font-weight: bold; margin-bottom: 4px;">${genLabel}:</div>`;

        byGeneration[gen].forEach(person => {
            const amountField = personType === 'owner' ? 'inheritedDebt' : 'inheritedCredit';
            const amount = person[amountField] || 0;
            const amountColor = personType === 'owner' ? '#ff6464' : '#64ff64';
            const amountLabel = personType === 'owner' ? 'Debt' : 'Credit';

            html += `
                <div style="background: rgba(100, 200, 255, 0.1); margin: 3px 0; padding: 5px; border-radius: 3px; border-left: 2px solid #64c8ff;">
                    <div style="font-size: 0.85em; color: #e0e0e0;">${person.name}</div>
                    ${person.birthYear || person.deathYear ? `<div style="font-size: 0.7em; color: #9aa5b1;">
                        ${person.birthYear || '?'} - ${person.deathYear || '?'}
                    </div>` : ''}
                    ${amount > 0 ? `<div style="font-size: 0.75em; color: ${amountColor}; font-weight: bold;">
                        ${amountLabel}: $${(amount / 1000000).toFixed(2)}M
                    </div>` : ''}
                </div>
            `;
        });

        html += `</div>`;
    });

    container.innerHTML = html;
}

// ============================================
// QUEUE AUTO-TRIGGER
// ============================================

/**
 * Trigger queue processing in background
 */
async function triggerQueueProcessing(batchSize = 3) {
    try {
        console.log(`🔧 Triggering queue processing (batch size: ${batchSize})...`);

        const response = await fetch(`${API_BASE_URL}/api/trigger-queue-processing`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ batchSize })
        });

        const data = await response.json();

        if (data.success) {
            console.log(`✅ Queue trigger: ${data.message}`);

            // Optionally show notification to user
            if (data.queuedCount > 0 && typeof addConsoleMessage === 'function') {
                addConsoleMessage(`🤖 Processing ${data.queuedCount} URLs in background...`, 'info');
            }
        } else {
            console.warn('Queue trigger failed:', data);
        }
    } catch (error) {
        console.error('Error triggering queue:', error);
    }
}

// ============================================
// AUTO-INITIALIZATION
// ============================================

// Run when page loads
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCarouselEnhancements);
} else {
    initCarouselEnhancements();
}

async function initCarouselEnhancements() {
    console.log('🚀 Initializing carousel enhancements...');

    // Load data from database
    await loadCarouselData();

    // Trigger queue processing (3 URLs per page load)
    await triggerQueueProcessing(3);

    console.log('✅ Carousel enhancements initialized');
}

// Export functions to global scope
window.loadCarouselData = loadCarouselData;
window.initializeCarouselEnhanced = initializeCarouselEnhanced;
window.toggleDescendants = toggleDescendants;
window.triggerQueueProcessing = triggerQueueProcessing;
