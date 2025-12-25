/**
 * Reparations Platform - Main Application JavaScript
 */
        // ============================================
        // CONFIGURATION
        // ============================================
        const API_BASE_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
            ? 'http://localhost:3000'
            : 'https://reparations-platform.onrender.com';

        console.log('API Base URL:', API_BASE_URL);

        // ============================================
        // INITIALIZATION
        // ============================================
        let backendReady = false;

        document.addEventListener('DOMContentLoaded', () => {
            initializeApp();
        });

        async function initializeApp() {
            // Load stats immediately without waiting for health check
            loadStats();

            // Load data quality badge count
            loadDataQualityBadge();

            // Load extraction progress indicator (for the green dot)
            loadExtractionProgress();

            // Ping backend in background
            pingBackend();
        }

        async function loadDataQualityBadge() {
            try {
                const response = await fetch(`${API_BASE_URL}/api/contribute/data-quality`);
                if (response.ok) {
                    const data = await response.json();
                    if (data.success) {
                        const badge = document.getElementById('qualityBadge');
                        const count = data.summary.totalIssues;
                        if (count > 0) {
                            badge.textContent = count > 99 ? '99+' : count;
                            badge.style.display = 'block';
                        }
                    }
                }
            } catch (e) {
                console.log('Quality badge load deferred');
            }
        }

        async function pingBackend() {
            const maxRetries = 5; // Reduced from 20
            let retries = 0;

            while (retries < maxRetries && !backendReady) {
                try {
                    const response = await fetch(`${API_BASE_URL}/api/health`, {
                        method: 'GET',
                        mode: 'cors',
                        cache: 'no-cache',
                        timeout: 10000
                    });

                    if (response.ok) {
                        const data = await response.json();
                        if (data.success || data.status === 'ok' || data.health) {
                            backendReady = true;
                            document.getElementById('systemStatus').textContent = 'System Online';
                            showToast('Connected to backend', 'success');
                            return;
                        }
                    }
                } catch (error) {
                    console.log(`Backend connection attempt ${retries + 1}: ${error.message}`);
                }

                retries++;
                document.getElementById('systemStatus').textContent = `Connecting (${retries}/${maxRetries})...`;
                await new Promise(resolve => setTimeout(resolve, 3000)); // Reduced from 6000
            }

            if (!backendReady) {
                document.getElementById('systemStatus').textContent = 'Checking...';
                // Still try to load stats even if health check failed
                loadStats();
            }
        }

        // ============================================
        // STATS
        // ============================================
        async function loadStats() {
            try {
                const response = await fetch(`${API_BASE_URL}/api/contribute/stats`);
                if (response.ok) {
                    const data = await response.json();
                    const stats = data.stats || data; // Handle both nested and flat response

                    document.getElementById('statRecords').textContent = formatNumber(stats.total_records || 0);
                    document.getElementById('statSlaveholders').textContent = formatNumber(stats.slaveholders || 0);
                    document.getElementById('statEnslaved').textContent = formatNumber(stats.enslaved || 0);
                    document.getElementById('statSources').textContent = formatNumber(stats.unique_sources || 0);
                }
            } catch (error) {
                console.error('Failed to load stats:', error);
            }
        }

        function formatNumber(num) {
            if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
            if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
            return num.toString();
        }

        // ============================================
        // NAME VALIDATION (Frontend filter for garbage data)
        // ============================================
        const GARBAGE_WORDS = new Set([
            'the', 'a', 'an', 'he', 'she', 'it', 'they', 'them', 'their', 'we', 'us',
            'me', 'my', 'your', 'you', 'his', 'her', 'its', 'our', 'who', 'what',
            'where', 'when', 'how', 'why', 'which', 'that', 'this', 'these', 'those',
            'with', 'from', 'for', 'and', 'but', 'not', 'or', 'nor', 'yet', 'so',
            'to', 'of', 'in', 'on', 'at', 'by', 'as', 'into', 'onto', 'upon',
            'be', 'is', 'are', 'was', 'were', 'been', 'being', 'have', 'has', 'had',
            'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might',
            'no', 'yes', 'so', 'if', 'than', 'then', 'now', 'up', 'out', 'only',
            'participant info', 'researcher location', 'comments', 'beyond kin researcher',
            'research record', 'your petitioner', 'slave statistics', 'slaveholder',
            'enslaved', 'owner', 'descendant', 'locations', 'researcher',
            'year', 'month', 'day', 'compensation', 'received', 'drafted', 'enlisted',
            'paid', 'owed', 'amount', 'total', 'number', 'none', 'male', 'female', 'mole',
            'federal census', 'baptist church', 'statistics', 'records', 'index'
        ]);

        function isValidSearchResult(name) {
            if (!name || name.length < 3) return false;
            const normalized = name.trim().toLowerCase();
            if (GARBAGE_WORDS.has(normalized)) return false;
            if (name === name.toUpperCase() && name.length > 3) return false; // ALL CAPS headers
            if (/^(by the |the |a |an )/.test(normalized)) return false;
            if (/@/.test(name)) return false; // Email addresses
            if (/^\d+$/.test(name)) return false; // Just numbers
            return true;
        }

        // ============================================
        // SEARCH
        // ============================================
        async function performSearch() {
            const query = document.getElementById('searchInput').value.trim();
            if (!query) {
                showToast('Please enter a search term', 'info');
                return;
            }

            const resultsList = document.getElementById('resultsList');
            resultsList.innerHTML = '<div style="text-align: center; padding: 30px;"><div class="spinner" style="margin: 0 auto;"></div></div>';
            document.getElementById('searchResultsPanel').classList.add('active');

            try {
                // Search both documents and unconfirmed_persons in parallel
                const [docResponse, peopleResponse] = await Promise.all([
                    fetch(`${API_BASE_URL}/api/documents/owner/${encodeURIComponent(query)}`).catch(() => ({ ok: false })),
                    fetch(`${API_BASE_URL}/api/contribute/search/${encodeURIComponent(query)}`).catch(() => ({ ok: false }))
                ]);

                let allResults = [];

                // Process document results
                if (docResponse.ok) {
                    const docData = await docResponse.json();
                    if (docData.success && docData.documents) {
                        docData.documents.forEach(doc => {
                            allResults.push({
                                type: 'document',
                                name: doc.owner_name || doc.title,
                                source: 'Uploaded Documents',
                                confidence: 1.0,
                                id: doc.id
                            });
                        });
                    }
                }

                // Process people results
                if (peopleResponse.ok) {
                    const peopleData = await peopleResponse.json();
                    if (peopleData.success && peopleData.results) {
                        peopleData.results.forEach(person => {
                            // FILTER OUT GARBAGE DATA
                            if (!isValidSearchResult(person.name)) {
                                console.log(`Filtered garbage result: "${person.name}"`);
                                return;
                            }
                            allResults.push({
                                type: person.type || 'unknown',
                                name: person.name,
                                source: new URL(person.source_url || 'https://unknown').hostname,
                                confidence: person.confidence_score || 0,
                                sourceUrl: person.source_url,
                                archiveUrl: person.archive_url,
                                contextText: person.context_text,
                                id: person.id,
                                tableSource: person.table_source
                            });
                        });
                    }
                }

                // Display results (garbage filtered)
                const filteredCount = allResults.length;
                document.getElementById('resultsTitle').textContent = `Found ${filteredCount} results for "${query}"`;

                if (allResults.length === 0) {
                    resultsList.innerHTML = '<div style="text-align: center; padding: 40px; color: #9aa5b1;">No results found. Try a different search term.</div>';
                } else {
                    resultsList.innerHTML = allResults.map((r, idx) => `
                        <div class="result-item ${r.type}" onclick="viewResult(${idx})" data-result-index="${idx}">
                            <div class="result-name">
                                ${r.archiveUrl ? '<span style="color: #64c8ff; margin-right: 8px;">📄</span>' : ''}
                                ${escapeHtml(r.name)}
                            </div>
                            <div class="result-meta">
                                <span class="result-type ${r.type}">${r.type}</span>
                                <span class="result-source">${r.source}</span>
                                ${r.confidence ? `<span class="result-confidence">${Math.round(r.confidence * 100)}%</span>` : ''}
                                ${r.archiveUrl ? '<span style="color: #64ff64; font-size: 0.75em; margin-left: 8px;">📁 Archive</span>' : ''}
                            </div>
                        </div>
                    `).join('');

                    // Store results globally for viewResult function
                    window.searchResults = allResults;
                }

            } catch (error) {
                console.error('Search error:', error);
                resultsList.innerHTML = '<div style="text-align: center; padding: 40px; color: #ff6464;">Search failed. Please try again.</div>';
            }
        }

        function closeSearchResults() {
            document.getElementById('searchResultsPanel').classList.remove('active');
        }

        function viewResult(resultIndex) {
            const result = window.searchResults[resultIndex];
            if (!result) return;

            // Always open person profile modal first
            openPersonModal(result);
        }

        // Open person profile modal
        async function openPersonModal(result) {
            const overlay = document.getElementById('personModalOverlay');
            const nameEl = document.getElementById('modalPersonName');
            const typeEl = document.getElementById('modalPersonType');
            const bodyEl = document.getElementById('modalPersonBody');

            // Show modal with loading state
            overlay.classList.add('active');
            nameEl.textContent = result.name || 'Loading...';
            typeEl.textContent = result.type || 'unknown';
            typeEl.className = `person-type-badge ${getTypeClass(result.type)}`;
            bodyEl.innerHTML = '<div style="text-align: center; padding: 40px;"><div class="spinner" style="margin: 0 auto;"></div></div>';

            try {
                // Fetch full person details
                const response = await fetch(`${API_BASE_URL}/api/contribute/person/${result.id}?table=${result.tableSource || ''}`);
                const data = await response.json();

                if (data.success) {
                    renderPersonProfile(data, result);
                } else {
                    // Fallback to basic display from search result
                    renderBasicProfile(result);
                }
            } catch (error) {
                console.error('Failed to load person profile:', error);
                renderBasicProfile(result);
            }
        }

        function getTypeClass(type) {
            if (!type) return 'unknown';
            if (type.includes('enslaved')) return 'enslaved';
            if (type.includes('owner') || type.includes('slaveholder')) return 'owner';
            return 'unknown';
        }

        function renderPersonProfile(data, result) {
            const { person, reparations, owner, documents, ownerDocuments, enslavedPersons, descendants, links } = data;
            const bodyEl = document.getElementById('modalPersonBody');

            // Determine status
            let statusClass = 'unconfirmed';
            let statusText = 'Unconfirmed Record';
            if (person.tableSource === 'enslaved_individuals') {
                statusClass = 'confirmed';
                statusText = 'Confirmed Record';
            }
            if (person.tableSource === 'canonical_persons' && person.verification_status === 'human_verified') {
                statusClass = 'confirmed';
                statusText = 'Verified Slaveholder';
            }
            if (person.status === 'needs_document') {
                statusClass = 'needs-document';
                statusText = 'Needs Documentation';
            }

            // Check if this is a slaveholder
            const isSlaveholder = person.person_type === 'slaveholder' || person.person_type === 'owner';

            // Check if source URL is a database homepage (not an actual document)
            const sourceUrl = result.sourceUrl || person.source_url;
            const isDbHomepage = isDatabaseHomepage(sourceUrl);
            const hasRealDocument = (sourceUrl && !isDbHomepage) || result.archiveUrl;

            bodyEl.innerHTML = `
                <div class="person-status-banner ${statusClass}">
                    <span>${statusClass === 'confirmed' ? '✓' : statusClass === 'needs-document' ? '⚠' : '○'}</span>
                    <span>${statusText}</span>
                </div>

                <!-- DATA SOURCE (for database homepages) or EVIDENTIARY DOCUMENT (for actual docs) -->
                ${isDbHomepage ? `
                <div class="person-section" style="background: rgba(100, 100, 200, 0.1); border: 1px solid rgba(100, 100, 200, 0.3); border-radius: 12px; padding: 15px; margin-bottom: 15px;">
                    <div class="person-section-title" style="color: #9aa5b1; font-size: 0.95em; display: flex; align-items: center; gap: 8px;">
                        <span style="font-size: 1.2em;">🗃️</span> Data Source
                    </div>
                    <div style="margin-top: 10px; color: #9aa5b1; font-size: 0.85em;">
                        Record from: <a href="${sourceUrl}" target="_blank" style="color: #64b5f6;">${getSourceDescription(sourceUrl)}</a>
                    </div>
                    <div style="margin-top: 8px; padding: 10px; background: rgba(255, 200, 100, 0.1); border-radius: 8px; border: 1px solid rgba(255, 200, 100, 0.3);">
                        <div style="color: #ffb74d; font-size: 0.85em;">⚠ Primary source document needed</div>
                        <div style="color: #9aa5b1; font-size: 0.8em; margin-top: 3px;">This record is from a compiled database. Link to original census/deed record to verify.</div>
                    </div>
                </div>
                ` : (result.sourceUrl || result.archiveUrl || person.source_url) ? `
                <div class="person-section" style="background: linear-gradient(135deg, rgba(100, 200, 255, 0.15), rgba(100, 255, 100, 0.1)); border: 2px solid rgba(100, 200, 255, 0.4); border-radius: 12px; padding: 20px; margin-bottom: 20px;">
                    <div class="person-section-title" style="color: #64c8ff; font-size: 1.1em; display: flex; align-items: center; gap: 10px;">
                        <span style="font-size: 1.5em;">📜</span> Evidentiary Source Document
                    </div>
                    <div style="margin-top: 15px; color: #9aa5b1; font-size: 0.9em;">
                        This person's record is documented in the following source:
                    </div>
                    <div style="margin-top: 15px; display: flex; flex-direction: column; gap: 10px;">
                        ${(result.sourceUrl || person.source_url) ? `
                        <button onclick="viewSourceDocument('${(result.sourceUrl || person.source_url).replace(/'/g, "\\'")}')"
                           class="source-document-link"
                           style="display: flex; align-items: center; gap: 12px; background: rgba(0,0,0,0.3); padding: 15px; border-radius: 10px; text-decoration: none; transition: all 0.2s; border: 1px solid rgba(100, 200, 255, 0.3); cursor: pointer; width: 100%; text-align: left;"
                           onmouseover="this.style.background='rgba(100, 200, 255, 0.2)'; this.style.borderColor='rgba(100, 200, 255, 0.6)'"
                           onmouseout="this.style.background='rgba(0,0,0,0.3)'; this.style.borderColor='rgba(100, 200, 255, 0.3)'">
                            <span style="font-size: 2em;">📄</span>
                            <div style="flex: 1;">
                                <div style="color: #64c8ff; font-weight: 600;">View Original Source Document</div>
                                <div style="color: #9aa5b1; font-size: 0.85em; margin-top: 3px; word-break: break-all;">
                                    ${getSourceDescription(result.sourceUrl || person.source_url)}
                                </div>
                            </div>
                            <span style="color: #64c8ff; font-size: 1.2em;">${isS3Url(result.sourceUrl || person.source_url) ? '▶' : '↗'}</span>
                        </button>
                        ` : ''}
                        ${result.archiveUrl ? `
                        <button onclick="closePersonModal(); viewArchivedDocument('${result.archiveUrl}')"
                           class="source-document-link"
                           style="display: flex; align-items: center; gap: 12px; background: rgba(0,0,0,0.3); padding: 15px; border-radius: 10px; text-decoration: none; transition: all 0.2s; border: 1px solid rgba(100, 255, 100, 0.3); cursor: pointer; width: 100%; text-align: left;"
                           onmouseover="this.style.background='rgba(100, 255, 100, 0.2)'; this.style.borderColor='rgba(100, 255, 100, 0.6)'"
                           onmouseout="this.style.background='rgba(0,0,0,0.3)'; this.style.borderColor='rgba(100, 255, 100, 0.3)'">
                            <span style="font-size: 2em;">📁</span>
                            <div style="flex: 1;">
                                <div style="color: #64ff64; font-weight: 600;">View Archived Copy (Local)</div>
                                <div style="color: #9aa5b1; font-size: 0.85em; margin-top: 3px;">Preserved in platform archive</div>
                            </div>
                            <span style="color: #64ff64; font-size: 1.2em;">▶</span>
                        </button>
                        ` : ''}
                    </div>
                    ${!(result.sourceUrl || person.source_url) && !result.archiveUrl ? `
                    <div style="margin-top: 15px; padding: 15px; background: rgba(255, 100, 100, 0.1); border-radius: 10px; border: 1px solid rgba(255, 100, 100, 0.3);">
                        <div style="color: #ff6464; font-weight: 600;">⚠ No Source Document Available</div>
                        <div style="color: #9aa5b1; font-size: 0.85em; margin-top: 5px;">This record needs documentation to be verified.</div>
                    </div>
                    ` : ''}
                </div>
                ` : `
                <div class="person-section" style="background: rgba(255, 100, 100, 0.1); border: 2px solid rgba(255, 100, 100, 0.3); border-radius: 12px; padding: 20px; margin-bottom: 20px;">
                    <div class="person-section-title" style="color: #ff6464; font-size: 1.1em; display: flex; align-items: center; gap: 10px;">`}
                        <span style="font-size: 1.5em;">⚠️</span> Source Document Required
                    </div>
                    <div style="margin-top: 10px; color: #9aa5b1; font-size: 0.9em;">
                        This record has no linked source document. All persons must be verifiable through historical documentation.
                    </div>
                </div>
                `}

                <!-- Personal Details -->
                <div class="person-section">
                    <div class="person-section-title">Personal Details</div>
                    <div class="person-details-grid">
                        ${person.birth_year ? `<div class="person-detail"><div class="person-detail-label">Birth Year</div><div class="person-detail-value">${person.birth_year}</div></div>` : ''}
                        ${person.death_year ? `<div class="person-detail"><div class="person-detail-label">Death Year</div><div class="person-detail-value">${person.death_year}</div></div>` : ''}
                        ${person.gender ? `<div class="person-detail"><div class="person-detail-label">Gender</div><div class="person-detail-value">${person.gender}</div></div>` : ''}
                        ${person.location ? `<div class="person-detail"><div class="person-detail-label">Location</div><div class="person-detail-value">${escapeHtml(person.location)}</div></div>` : ''}
                        ${person.occupation ? `<div class="person-detail"><div class="person-detail-label">Occupation</div><div class="person-detail-value">${person.occupation}</div></div>` : ''}
                        ${person.spouse_name ? `<div class="person-detail"><div class="person-detail-label">Spouse</div><div class="person-detail-value">${escapeHtml(person.spouse_name)}</div></div>` : ''}
                        ${person.racial_designation ? `<div class="person-detail"><div class="person-detail-label">Racial Designation</div><div class="person-detail-value">${person.racial_designation}</div></div>` : ''}
                    </div>
                </div>

                <!-- Reparations -->
                ${reparations && reparations.total > 0 ? `
                <div class="person-section">
                    <div class="person-section-title">Reparations Owed</div>
                    <div class="reparations-total">
                        <div class="reparations-total-label">Total Amount Owed</div>
                        <div class="reparations-total-amount">$${formatCurrency(reparations.total)}</div>
                    </div>
                    <div class="reparations-breakdown">
                        ${reparations.breakdown.map(item => `
                            <div class="reparations-item">
                                <div>
                                    <div class="reparations-item-label">${item.label}</div>
                                    <div style="font-size: 0.8em; color: #9aa5b1;">${item.description}</div>
                                </div>
                                <div class="reparations-item-amount">$${formatCurrency(item.amount)}</div>
                            </div>
                        `).join('')}
                    </div>
                    ${reparations.amountPaid > 0 ? `
                        <div style="margin-top: 15px; padding: 10px; background: rgba(100, 255, 100, 0.1); border-radius: 8px;">
                            <span style="color: #64ff64;">Amount Paid: $${formatCurrency(reparations.amountPaid)}</span>
                        </div>
                    ` : ''}
                </div>
                ` : ''}

                <!-- Owner/Enslaver (for enslaved persons) -->
                ${owner ? `
                <div class="person-section">
                    <div class="person-section-title">Enslaved By</div>
                    <div class="person-detail" style="cursor: pointer;" onclick="searchPerson('${escapeHtml(owner.full_name)}')">
                        <div class="person-detail-label">Slaveholder</div>
                        <div class="person-detail-value" style="color: #ff6464;">${escapeHtml(owner.full_name)}</div>
                    </div>
                </div>
                ` : ''}

                <!-- Enslaved Persons (for slaveholders) -->
                ${enslavedPersons && enslavedPersons.length > 0 ? `
                <div class="person-section">
                    <div class="person-section-title">Enslaved Persons (${enslavedPersons.length} documented)</div>
                    <div style="max-height: 200px; overflow-y: auto; background: rgba(30, 40, 70, 0.5); border-radius: 10px; padding: 10px;">
                        ${enslavedPersons.slice(0, 20).map(ep => `
                            <div style="padding: 5px 10px; cursor: pointer; border-radius: 5px; margin-bottom: 3px;"
                                 onmouseover="this.style.background='rgba(255,100,100,0.2)'"
                                 onmouseout="this.style.background='transparent'"
                                 onclick="searchPerson('${escapeHtml(ep.enslaved_name)}')">
                                <span style="color: #64b5f6;">${escapeHtml(ep.enslaved_name)}</span>
                            </div>
                        `).join('')}
                        ${enslavedPersons.length > 20 ? `<div style="color: #9aa5b1; padding: 10px; text-align: center;">... and ${enslavedPersons.length - 20} more</div>` : ''}
                    </div>
                </div>
                ` : ''}

                <!-- Documents (for slaveholders with S3 documents) -->
                ${ownerDocuments && ownerDocuments.length > 0 ? `
                <div class="person-section">
                    <div class="person-section-title">Historical Documents</div>
                    ${ownerDocuments.map(doc => `
                        <div style="background: rgba(30, 40, 70, 0.5); padding: 15px; border-radius: 10px; margin-bottom: 10px;">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <div>
                                    <div style="font-weight: 600; color: #e0e0e0;">${escapeHtml(doc.doc_type || 'Document')}</div>
                                    <div style="font-size: 0.85em; color: #9aa5b1;">${doc.filename || doc.document_id}</div>
                                    ${doc.ocr_page_count ? `<div style="font-size: 0.8em; color: #64b5f6;">${doc.ocr_page_count} page(s)</div>` : ''}
                                </div>
                                ${doc.s3_key ? `<button class="person-link-btn" onclick="openDocumentFromS3('${doc.s3_key}')">📄 View Document</button>` : ''}
                            </div>
                        </div>
                    `).join('')}
                </div>
                ` : ''}

                <!-- Descendants (for slaveholders from WikiTree scraping) -->
                ${descendants && descendants.length > 0 ? `
                <div class="person-section">
                    <div class="person-section-title" style="display: flex; align-items: center; gap: 8px;">
                        <span style="font-size: 1.2em;">👨‍👩‍👧‍👦</span> Known Descendants (${descendants.length})
                    </div>
                    <div style="font-size: 0.85em; color: #9aa5b1; margin-bottom: 10px;">
                        Genealogical connections traced via WikiTree
                    </div>
                    <div style="max-height: 250px; overflow-y: auto; background: rgba(30, 40, 70, 0.5); border-radius: 10px; padding: 10px;">
                        ${descendants.map(d => {
                            const genLabel = d.generation_from_owner === 1 ? 'Child' :
                                           d.generation_from_owner === 2 ? 'Grandchild' :
                                           d.generation_from_owner === 3 ? 'Great-grandchild' :
                                           d.generation_from_owner === 4 ? 'Great-great-grandchild' :
                                           'Gen ' + d.generation_from_owner;
                            const years = d.descendant_birth_year ?
                                '(' + d.descendant_birth_year + (d.descendant_death_year ? '-' + d.descendant_death_year : '') + ')' : '';
                            const wikitreeLink = d.wikitree_id ?
                                '<a href="https://www.wikitree.com/wiki/' + d.wikitree_id + '" target="_blank" style="color: #64b5f6; font-size: 0.8em; margin-left: 8px;">WikiTree ↗</a>' : '';
                            return '<div style="padding: 8px 10px; border-radius: 5px; margin-bottom: 5px; background: rgba(0,0,0,0.2);">' +
                                '<div style="display: flex; justify-content: space-between; align-items: center;">' +
                                    '<div>' +
                                        '<span style="color: #e0e0e0;">' + escapeHtml(d.descendant_name) + '</span>' +
                                        '<span style="color: #9aa5b1; font-size: 0.85em;"> ' + years + '</span>' +
                                        wikitreeLink +
                                    '</div>' +
                                    '<span style="color: #64b5f6; font-size: 0.75em; background: rgba(100,180,246,0.2); padding: 2px 8px; border-radius: 4px;">' + genLabel + '</span>' +
                                '</div>' +
                            '</div>';
                        }).join('')}
                    </div>
                </div>
                ` : ''}

                <!-- Links & Actions -->
                <div class="person-section">
                    <div class="person-section-title">Actions</div>
                    ${result.sourceUrl && !isDbHomepage ? `<a href="${result.sourceUrl}" target="_blank" class="person-link-btn">📄 View Source Document</a>` : ''}
                    ${result.archiveUrl ? `<button class="person-link-btn" onclick="closePersonModal(); openArchiveViewer(window.searchResults[${window.searchResults?.indexOf(result) || 0}])">📁 View Archive</button>` : ''}
                    ${links?.familySearch ? `<a href="${links.familySearch}" target="_blank" class="person-link-btn">🌳 FamilySearch</a>` : ''}
                    ${links?.ancestry ? `<a href="${links.ancestry}" target="_blank" class="person-link-btn">🌳 Ancestry</a>` : ''}
                    ${links?.wikiTree ? `<a href="${links.wikiTree}" target="_blank" class="person-link-btn">🌳 WikiTree</a>` : ''}
                </div>

                <!-- Context/Notes -->
                ${person.notes || person.context_text ? `
                <div class="person-section">
                    <div class="person-section-title">Notes & Context</div>
                    <div style="background: rgba(30, 40, 70, 0.5); padding: 15px; border-radius: 10px; color: #e0e0e0; font-size: 0.9em; line-height: 1.6; max-height: 200px; overflow-y: auto;">
                        ${escapeHtml((person.notes || person.context_text || '').substring(0, 500))}${(person.notes || person.context_text || '').length > 500 ? '...' : ''}
                    </div>
                </div>
                ` : ''}
            `;
        }

        function renderBasicProfile(result) {
            const bodyEl = document.getElementById('modalPersonBody');
            bodyEl.innerHTML = `
                <div class="person-status-banner unconfirmed">
                    <span>○</span>
                    <span>Unconfirmed Record</span>
                </div>

                <!-- EVIDENTIARY SOURCE DOCUMENT - Most Important Section -->
                ${result.sourceUrl || result.source_url || result.archiveUrl ? `
                <div class="person-section" style="background: linear-gradient(135deg, rgba(100, 200, 255, 0.15), rgba(100, 255, 100, 0.1)); border: 2px solid rgba(100, 200, 255, 0.4); border-radius: 12px; padding: 20px; margin-bottom: 20px;">
                    <div class="person-section-title" style="color: #64c8ff; font-size: 1.1em; display: flex; align-items: center; gap: 10px;">
                        <span style="font-size: 1.5em;">📜</span> Evidentiary Source Document
                    </div>
                    <div style="margin-top: 15px; color: #9aa5b1; font-size: 0.9em;">
                        This person's record is documented in the following source:
                    </div>
                    <div style="margin-top: 15px; display: flex; flex-direction: column; gap: 10px;">
                        ${result.sourceUrl || result.source_url ? `
                        <button onclick="viewSourceDocument('${(result.sourceUrl || result.source_url).replace(/'/g, "\\'")}')"
                           style="display: flex; align-items: center; gap: 12px; background: rgba(0,0,0,0.3); padding: 15px; border-radius: 10px; text-decoration: none; transition: all 0.2s; border: 1px solid rgba(100, 200, 255, 0.3); cursor: pointer; width: 100%; text-align: left;"
                           onmouseover="this.style.background='rgba(100, 200, 255, 0.2)'; this.style.borderColor='rgba(100, 200, 255, 0.6)'"
                           onmouseout="this.style.background='rgba(0,0,0,0.3)'; this.style.borderColor='rgba(100, 200, 255, 0.3)'">
                            <span style="font-size: 2em;">📄</span>
                            <div style="flex: 1;">
                                <div style="color: #64c8ff; font-weight: 600;">View Original Source Document</div>
                                <div style="color: #9aa5b1; font-size: 0.85em; margin-top: 3px; word-break: break-all;">
                                    ${getSourceDescription(result.sourceUrl || result.source_url)}
                                </div>
                            </div>
                            <span style="color: #64c8ff; font-size: 1.2em;">${isS3Url(result.sourceUrl || result.source_url) ? '▶' : '↗'}</span>
                        </button>
                        ` : ''}
                        ${result.archiveUrl || result.archive_url ? `
                        <button onclick="closePersonModal(); viewArchivedDocument('${result.archiveUrl || result.archive_url}')"
                           style="display: flex; align-items: center; gap: 12px; background: rgba(0,0,0,0.3); padding: 15px; border-radius: 10px; text-decoration: none; transition: all 0.2s; border: 1px solid rgba(100, 255, 100, 0.3); cursor: pointer; width: 100%; text-align: left;"
                           onmouseover="this.style.background='rgba(100, 255, 100, 0.2)'; this.style.borderColor='rgba(100, 255, 100, 0.6)'"
                           onmouseout="this.style.background='rgba(0,0,0,0.3)'; this.style.borderColor='rgba(100, 255, 100, 0.3)'">
                            <span style="font-size: 2em;">📁</span>
                            <div style="flex: 1;">
                                <div style="color: #64ff64; font-weight: 600;">View Archived Copy (Local)</div>
                                <div style="color: #9aa5b1; font-size: 0.85em; margin-top: 3px;">Preserved in platform archive</div>
                            </div>
                            <span style="color: #64ff64; font-size: 1.2em;">▶</span>
                        </button>
                        ` : ''}
                    </div>
                </div>
                ` : `
                <div class="person-section" style="background: rgba(255, 100, 100, 0.1); border: 2px solid rgba(255, 100, 100, 0.3); border-radius: 12px; padding: 20px; margin-bottom: 20px;">
                    <div class="person-section-title" style="color: #ff6464; font-size: 1.1em; display: flex; align-items: center; gap: 10px;">
                        <span style="font-size: 1.5em;">⚠️</span> Source Document Required
                    </div>
                    <div style="margin-top: 10px; color: #9aa5b1; font-size: 0.9em;">
                        This record has no linked source document. All persons must be verifiable through historical documentation.
                    </div>
                </div>
                `}

                <div class="person-section">
                    <div class="person-section-title">Record Information</div>
                    <div class="person-detail">
                        <div class="person-detail-label">Data Source</div>
                        <div class="person-detail-value">${result.source || 'Unknown'}</div>
                    </div>
                    ${result.confidence || result.confidence_score ? `
                    <div class="person-detail" style="margin-top: 10px;">
                        <div class="person-detail-label">Extraction Confidence</div>
                        <div class="person-detail-value" style="color: ${(result.confidence || result.confidence_score) >= 0.7 ? '#64ff64' : (result.confidence || result.confidence_score) >= 0.5 ? '#ffb74d' : '#ff6464'}">
                            ${Math.round((result.confidence || result.confidence_score) * 100)}%
                        </div>
                    </div>
                    ` : ''}
                    ${result.locations ? `
                    <div class="person-detail" style="margin-top: 10px;">
                        <div class="person-detail-label">Location</div>
                        <div class="person-detail-value">${escapeHtml(result.locations)}</div>
                    </div>
                    ` : ''}
                </div>
            `;
        }

        // Helper function to check if a URL is an S3 URL (needs presigning)
        function isS3Url(url) {
            if (!url) return false;
            try {
                const hostname = new URL(url).hostname.toLowerCase();
                return hostname.includes('s3') && hostname.includes('amazonaws');
            } catch {
                return false;
            }
        }

        // View source document - handles S3 URLs with presigning
        async function viewSourceDocument(sourceUrl) {
            if (isS3Url(sourceUrl)) {
                // Use the presigned document viewer
                closePersonModal();
                viewArchivedDocument(sourceUrl);
            } else {
                // Open external URL in new tab
                window.open(sourceUrl, '_blank', 'noopener');
            }
        }

        // Helper function to check if URL is a database homepage (not an actual document)
        function isDatabaseHomepage(url) {
            if (!url) return false;
            try {
                const urlObj = new URL(url);
                const pathname = urlObj.pathname.toLowerCase();
                const hostname = urlObj.hostname.toLowerCase();

                // These are database homepages, NOT actual documents
                const databaseHomepages = [
                    'ibiblio.org/laslave',      // Louisiana Slave Database
                    'slavevoyages.org',          // Slave Voyages Database
                    'freedmensbureau.com',       // Freedmen's Bureau
                    'slaveryinamerica.org'       // Various slavery databases
                ];

                // Check if it's a database homepage (short path, no specific document)
                for (const db of databaseHomepages) {
                    if ((hostname + pathname).includes(db)) {
                        // Only count as homepage if path is short (no specific record)
                        if (pathname === '/' || pathname.length < 10) {
                            return true;
                        }
                    }
                }

                return false;
            } catch {
                return false;
            }
        }

        // Helper function to describe source URLs in human-readable form
        function getSourceDescription(url) {
            if (!url) return 'Unknown source';
            try {
                const urlObj = new URL(url);
                const hostname = urlObj.hostname.toLowerCase();

                if (hostname.includes('ibiblio.org') && hostname.includes('laslave')) {
                    return 'Louisiana Slave Database (ibiblio.org)';
                } else if (hostname.includes('ibiblio')) {
                    return 'Louisiana Slave Database (ibiblio.org)';
                } else if (hostname.includes('familysearch')) {
                    return 'FamilySearch.org - Historical Records';
                } else if (hostname.includes('msa.maryland.gov')) {
                    return 'Maryland State Archives - Official Records';
                } else if (hostname.includes('civilwardc')) {
                    return 'Civil War DC - Emancipation Petitions';
                } else if (hostname.includes('ancestry')) {
                    return 'Ancestry.com - Genealogical Records';
                } else if (hostname.includes('fold3')) {
                    return 'Fold3 - Military & Historical Records';
                } else if (hostname.includes('newspapers')) {
                    return 'Historical Newspapers Archive';
                } else if (hostname.includes('s3') && hostname.includes('amazonaws')) {
                    return 'Platform Archive - Preserved Copy';
                } else {
                    return hostname.replace('www.', '');
                }
            } catch {
                return url.substring(0, 50) + (url.length > 50 ? '...' : '');
            }
        }

        // View archived document from S3 URL
        async function viewArchivedDocument(archiveUrl) {
            document.getElementById('documentViewer').classList.add('active');
            const content = document.getElementById('docViewerContent');
            const sidebar = document.getElementById('docMetadata');

            content.innerHTML = '<div style="text-align: center; padding: 50px;"><div class="spinner" style="margin: 0 auto;"></div><p style="margin-top: 15px; color: #9aa5b1;">Loading archived document...</p></div>';

            try {
                // Get presigned URL for viewing
                const presignResponse = await fetch(`${API_BASE_URL}/api/documents/archive/presign?url=${encodeURIComponent(archiveUrl)}`);
                const presignData = await presignResponse.json();

                if (presignData.success && presignData.viewUrl) {
                    window.currentDocDownloadUrl = presignData.downloadUrl || presignData.viewUrl;

                    // Check if PDF or image
                    const isPdf = archiveUrl.toLowerCase().endsWith('.pdf') || presignData.metadata?.contentType?.includes('pdf');

                    if (isPdf) {
                        content.innerHTML = `<iframe src="${presignData.viewUrl}" style="width: 100%; height: 100%; border: none;"></iframe>`;
                    } else {
                        content.innerHTML = `<img src="${presignData.viewUrl}" style="max-width: 100%; max-height: 100%; object-fit: contain;" alt="Archived document">`;
                    }

                    sidebar.innerHTML = `
                        <h3>Archived Document</h3>
                        <div style="margin-top: 15px;">
                            <div style="color: #9aa5b1; font-size: 0.9em;">Source</div>
                            <div style="color: #e0e0e0; margin-top: 3px;">Platform Archive</div>
                        </div>
                        <div style="margin-top: 15px;">
                            <div style="color: #9aa5b1; font-size: 0.9em;">Original URL</div>
                            <div style="color: #64c8ff; margin-top: 3px; word-break: break-all; font-size: 0.85em;">${archiveUrl}</div>
                        </div>
                    `;
                } else {
                    content.innerHTML = `<div style="text-align: center; padding: 50px; color: #ff6464;">
                        <p>Failed to load archived document</p>
                        <p style="color: #9aa5b1; font-size: 0.9em; margin-top: 10px;">${presignData.error || 'Unknown error'}</p>
                        <a href="${archiveUrl}" target="_blank" style="color: #64c8ff; margin-top: 15px; display: inline-block;">Try opening directly ↗</a>
                    </div>`;
                }
            } catch (error) {
                console.error('Archive view error:', error);
                content.innerHTML = `<div style="text-align: center; padding: 50px; color: #ff6464;">
                    <p>Failed to load archived document</p>
                    <a href="${archiveUrl}" target="_blank" style="color: #64c8ff; margin-top: 15px; display: inline-block;">Try opening directly ↗</a>
                </div>`;
            }
        }

        function closePersonModal(event) {
            if (event && event.target !== event.currentTarget) return;
            document.getElementById('personModalOverlay').classList.remove('active');
        }

        function formatCurrency(amount) {
            if (!amount || amount === 0) return '0';
            if (amount >= 1000000000) return (amount / 1000000000).toFixed(2) + 'B';
            if (amount >= 1000000) return (amount / 1000000).toFixed(2) + 'M';
            if (amount >= 1000) return (amount / 1000).toFixed(1) + 'K';
            return amount.toFixed(2);
        }

        function searchPerson(name) {
            closePersonModal();
            document.getElementById('searchInput').value = name;
            performSearch();
        }

        function openArchiveViewerByResult(index) {
            const result = window.searchResults[index];
            if (result) openArchiveViewer(result);
        }

        // Open document from S3 key (for slaveholder documents)
        async function openDocumentFromS3(s3Key) {
            closePersonModal();
            document.getElementById('documentViewer').classList.add('active');
            const content = document.getElementById('docViewerContent');
            const sidebar = document.getElementById('docMetadata');

            content.innerHTML = '<div style="text-align: center; padding: 50px;"><div class="spinner" style="margin: 0 auto;"></div><p style="margin-top: 15px; color: #9aa5b1;">Loading document...</p></div>';

            try {
                // For multi-page documents (directories), try page-1.pdf first
                let keyToFetch = s3Key;
                if (s3Key.endsWith('/')) {
                    keyToFetch = s3Key + 'page-1.pdf';
                }

                const presignResponse = await fetch(`${API_BASE_URL}/api/documents/archive/presign?key=${encodeURIComponent(keyToFetch)}`);
                const presignData = await presignResponse.json();

                if (!presignData.success) {
                    throw new Error(presignData.error || 'Failed to get document access');
                }

                const viewUrl = presignData.viewUrl;
                window.currentDocDownloadUrl = presignData.downloadUrl;

                const isPdf = keyToFetch.toLowerCase().includes('.pdf');

                if (isPdf) {
                    content.innerHTML = `<iframe src="${viewUrl}" style="width: 100%; height: 85vh; border: none; border-radius: 8px;"></iframe>`;
                } else {
                    content.innerHTML = `<img src="${viewUrl}" style="max-height: 85vh; border-radius: 8px;" />`;
                }

                sidebar.innerHTML = `
                    <h3>Document Info</h3>
                    <p><strong>S3 Key:</strong> ${s3Key}</p>
                    <p style="margin-top: 15px;"><a href="${presignData.downloadUrl}" target="_blank" class="download-btn">⬇️ Download</a></p>
                `;
            } catch (error) {
                console.error('Failed to load S3 document:', error);
                content.innerHTML = `<div style="text-align: center; padding: 50px; color: #ff6464;"><p>Failed to load document: ${error.message}</p></div>`;
            }
        }

        // Open archived document in viewer
        async function openArchiveViewer(result) {
            document.getElementById('documentViewer').classList.add('active');
            const content = document.getElementById('docViewerContent');
            const sidebar = document.getElementById('docMetadata');

            // Show loading state
            content.innerHTML = '<div style="text-align: center; padding: 50px;"><div class="spinner" style="margin: 0 auto;"></div><p style="margin-top: 15px; color: #9aa5b1;">Loading archived document...</p></div>';

            try {
                // Get presigned URL from backend
                const presignResponse = await fetch(`${API_BASE_URL}/api/documents/archive/presign?url=${encodeURIComponent(result.archiveUrl)}`);
                const presignData = await presignResponse.json();

                if (!presignData.success) {
                    throw new Error(presignData.error || 'Failed to get document access');
                }

                const viewUrl = presignData.viewUrl;
                window.currentDocDownloadUrl = presignData.downloadUrl;

                // Determine file type from URL
                const isPdf = result.archiveUrl.toLowerCase().includes('.pdf');

                // Display document with presigned URL
                if (isPdf) {
                    content.innerHTML = `<iframe src="${viewUrl}" style="width: 100%; height: 85vh; border: none; border-radius: 8px;"></iframe>`;
                } else {
                    content.innerHTML = `<img src="${viewUrl}" style="max-height: 85vh; border-radius: 8px;" onerror="this.onerror=null; this.parentElement.innerHTML='<p style=\\'color: #ff6464; text-align: center;\\'>Image failed to load</p>';" />`;
                }
            } catch (error) {
                console.error('Failed to load archive:', error);
                content.innerHTML = `<div style="text-align: center; padding: 50px; color: #ff6464;"><p>Failed to load document: ${error.message}</p><p style="margin-top: 10px; color: #9aa5b1;">Direct link: <a href="${result.archiveUrl}" target="_blank" style="color: #64c8ff;">${result.archiveUrl}</a></p></div>`;
            }

            // Update sidebar with person/document info
            sidebar.innerHTML = `
                <div style="margin-bottom: 15px;">
                    <div style="color: #9aa5b1; font-size: 0.85em;">Name</div>
                    <div style="color: #e0e0e0; font-size: 1.1em; font-weight: 600;">${escapeHtml(result.name)}</div>
                </div>
                <div style="margin-bottom: 15px;">
                    <div style="color: #9aa5b1; font-size: 0.85em;">Type</div>
                    <div style="color: ${result.type === 'slaveholder' ? '#ff6464' : '#64ff64'}; text-transform: capitalize;">${result.type}</div>
                </div>
                ${result.confidence ? `
                <div style="margin-bottom: 15px;">
                    <div style="color: #9aa5b1; font-size: 0.85em;">Confidence</div>
                    <div style="color: #e0e0e0;">${Math.round(result.confidence * 100)}%</div>
                </div>` : ''}
                <div style="margin-bottom: 15px;">
                    <div style="color: #9aa5b1; font-size: 0.85em;">Source</div>
                    <div style="color: #e0e0e0;">${result.source}</div>
                </div>
                ${result.contextText ? `
                <div style="margin-bottom: 15px;">
                    <div style="color: #9aa5b1; font-size: 0.85em;">Citation</div>
                    <div style="color: #e0e0e0; font-size: 0.9em; line-height: 1.4;">${escapeHtml(result.contextText.split('Archived:')[0])}</div>
                </div>` : ''}
                <div style="margin-bottom: 15px;">
                    <div style="color: #9aa5b1; font-size: 0.85em;">Archive</div>
                    <a href="${result.archiveUrl}" target="_blank" style="color: #64c8ff; font-size: 0.85em; word-break: break-all;">View Original</a>
                </div>
                ${result.sourceUrl ? `
                <div style="margin-bottom: 15px;">
                    <div style="color: #9aa5b1; font-size: 0.85em;">Original Source</div>
                    <a href="${result.sourceUrl}" target="_blank" style="color: #64c8ff; font-size: 0.85em; word-break: break-all;">Visit Source</a>
                </div>` : ''}
            `;

            // Store download URL
            window.currentDocDownloadUrl = result.archiveUrl;
        }

        // ============================================
        // PANELS
        // ============================================
        function openPanel(panelId) {
            closeAllPanels();
            document.getElementById(`${panelId}Panel`).classList.add('active');

            // Update nav items
            document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
            if (event && event.currentTarget) {
                event.currentTarget.classList.add('active');
            }

            // Load content if needed
            if (panelId === 'documents') loadDocuments();
            if (panelId === 'people') loadPeople();
            if (panelId === 'quality') loadDataQuality();
            if (panelId === 'progress') startProgressRefresh();
        }

        function closePanel(panelId) {
            document.getElementById(`${panelId}Panel`).classList.remove('active');

            // Stop progress refresh when closing progress panel
            if (panelId === 'progress') stopProgressRefresh();

            // Reset nav to search
            document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
            document.querySelector('.nav-item:nth-child(4)').classList.add('active');
        }

        function closeAllPanels() {
            document.querySelectorAll('.feature-panel').forEach(panel => {
                panel.classList.remove('active');
            });
            // Stop progress refresh when closing all panels
            stopProgressRefresh();
        }

        // ============================================
        // DOCUMENTS
        // ============================================
        async function loadDocuments() {
            const container = document.getElementById('documentsList');

            try {
                const response = await fetch(`${API_BASE_URL}/api/documents`);
                if (response.ok) {
                    const data = await response.json();

                    if (data.documents && data.documents.length > 0) {
                        container.innerHTML = data.documents.map(doc => `
                            <div class="document-card" onclick="openDocViewer('${doc.id}')">
                                <div class="doc-name">${escapeHtml(doc.title || doc.original_filename)}</div>
                                <div class="doc-meta">
                                    ${doc.owner_name ? `Owner: ${escapeHtml(doc.owner_name)}` : ''}
                                    ${doc.document_date ? `<br>Date: ${doc.document_date}` : ''}
                                </div>
                            </div>
                        `).join('');
                    } else {
                        container.innerHTML = '<div style="text-align: center; color: #9aa5b1; padding: 40px;">No documents uploaded yet</div>';
                    }
                }
            } catch (error) {
                container.innerHTML = '<div style="text-align: center; color: #ff6464; padding: 40px;">Failed to load documents</div>';
            }
        }

        // ============================================
        // PEOPLE BROWSER
        // ============================================
        window.peopleOffset = 0;

        async function loadPeople(offset = 0) {
            window.peopleOffset = offset;
            const container = document.getElementById('peopleList');
            const typeFilter = document.getElementById('peopleTypeFilter').value;
            const sourceFilter = document.getElementById('peopleSourceFilter').value;
            const confidenceFilter = document.getElementById('peopleConfidenceFilter').value;

            container.innerHTML = '<div style="text-align: center; color: #9aa5b1; padding: 40px;"><div class="spinner" style="margin: 0 auto 15px;"></div>Loading people database...</div>';

            try {
                let url = `${API_BASE_URL}/api/contribute/browse?limit=100&offset=${offset}`;
                if (typeFilter) url += `&type=${typeFilter}`;
                if (sourceFilter) url += `&source=${sourceFilter}`;
                if (confidenceFilter) url += `&minConfidence=${confidenceFilter}`;

                const response = await fetch(url);
                const data = await response.json();

                if (data.success && data.people && data.people.length > 0) {
                    // Update stats
                    document.getElementById('peopleTotalCount').textContent = formatCount(data.total);
                    document.getElementById('peopleBadge').textContent = formatCount(data.total);

                    // Filter out obvious garbage on client side as backup
                    const filteredPeople = data.people.filter(person => {
                        if (!person.name || person.name.length < 3) return false;
                        const normalized = person.name.toLowerCase().trim();
                        // Common garbage patterns - words that are clearly not names
                        const garbagePatterns = /^(the|he|she|it|that|this|with|from|for|and|but|not|our|his|her|they|them|their|who|what|where|when|how|why|which|statistics|participant|researcher|comments|record|year|years|month|months|day|days|week|weeks|compensation|enlisted|received|born|died|age|ages|male|female|time|date|number|total|county|state|city|filed|signed|note|page|filed|washington|district|columbia|unknown|none|other|same|said|also|may|shall|will|would|could|should|being|been|have|has|had|was|were|are|been|about|after|before|into|over|under|such|these|those|than|then|them|very|just|only|some|more|most|own|any|each|every|both|few|all|many|much|one|two|three|four|five|six|seven|eight|nine|ten|first|second|third|last|next|new|old|good|great|high|little|long|own|part|small|young|right|left|end|hand|place|man|woman|person|people|child|children|name|names|slave|slaves|owner|owners|property|value|hereby|said|aforesaid|thereof|therein|thereon|thereby|whereas|whereof)$/i;
                        if (garbagePatterns.test(normalized)) return false;
                        // Common standalone surnames that are likely OCR extraction errors
                        const standaloneSurnames = /^(smith|jones|brown|williams|johnson|davis|miller|wilson|moore|taylor|anderson|thomas|jackson|white|harris|martin|thompson|garcia|martinez|robinson|clark|rodriguez|lewis|lee|walker|hall|allen|young|hernandez|king|wright|lopez|hill|scott|green|adams|baker|gonzalez|nelson|carter|mitchell|perez|roberts|turner|phillips|campbell|parker|evans|edwards|collins|stewart|sanchez|morris|rogers|reed|cook|morgan|bell|murphy|bailey|rivera|cooper|richardson|cox|howard|ward|torres|peterson|gray|ramirez|james|watson|brooks|kelly|sanders|price|bennett|wood|barnes|ross|henderson|coleman|jenkins|perry|powell|long|patterson|hughes|flores|washington|butler|simmons|foster|gonzales|bryant|alexander|russell|griffin|diaz|hayes|stevens|darby|hopewell|ravenel|porcher)$/i;
                        if (standaloneSurnames.test(normalized)) return false;
                        if (person.name === person.name.toUpperCase() && person.name.length > 3) return false; // ALL CAPS headers
                        // Filter names with newlines (likely OCR artifacts)
                        if (person.name.includes('\n')) return false;
                        // Filter names that are just numbers
                        if (/^\d+$/.test(person.name.trim())) return false;
                        // Filter names that contain odd characters likely from OCR
                        if (/[|\\<>{}[\]@#$%^&*=+]/.test(person.name)) return false;
                        return true;
                    });

                    container.innerHTML = filteredPeople.map((person, idx) => `
                        <div class="person-card" style="padding: 15px; background: rgba(30, 40, 70, 0.5); border-radius: 10px; margin-bottom: 10px; cursor: pointer; transition: background 0.2s;"
                             onmouseover="this.style.background='rgba(50, 70, 120, 0.7)'"
                             onmouseout="this.style.background='rgba(30, 40, 70, 0.5)'"
                             onclick="openPersonFromBrowse(${JSON.stringify(person).replace(/"/g, '&quot;')})">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <div>
                                    <div style="font-weight: bold; color: ${person.type === 'owner' || person.type === 'slaveholder' ? '#ff6464' : '#64b5f6'}; font-size: 16px;">
                                        ${escapeHtml(person.name)}
                                    </div>
                                    <div style="font-size: 12px; color: #9aa5b1; margin-top: 5px;">
                                        ${person.type ? `<span style="padding: 2px 8px; border-radius: 4px; background: ${person.type === 'owner' || person.type === 'slaveholder' ? 'rgba(255,100,100,0.2)' : 'rgba(100,181,246,0.2)'}; margin-right: 8px;">${person.type}</span>` : ''}
                                        ${person.source || 'Unknown source'}
                                        ${person.locations ? ` - ${person.locations}` : ''}
                                    </div>
                                </div>
                                <div style="text-align: right;">
                                    <div style="font-size: 14px; color: ${person.confidence_score >= 0.7 ? '#64ff64' : person.confidence_score >= 0.5 ? '#ffb74d' : '#ff6464'};">
                                        ${((person.confidence_score || 0) * 100).toFixed(0)}%
                                    </div>
                                    <div style="font-size: 10px; color: #9aa5b1;">confidence</div>
                                </div>
                            </div>
                        </div>
                    `).join('');

                    // Update pagination
                    const currentPage = Math.floor(offset / 100) + 1;
                    const totalPages = Math.ceil(data.total / 100);
                    document.getElementById('peoplePageInfo').textContent = `Page ${currentPage} of ${totalPages}`;
                    document.getElementById('peoplePrevBtn').disabled = offset === 0;
                    document.getElementById('peopleNextBtn').disabled = !data.hasMore;

                } else {
                    container.innerHTML = '<div style="text-align: center; color: #9aa5b1; padding: 40px;">No people found matching filters</div>';
                    document.getElementById('peopleTotalCount').textContent = '0';
                    document.getElementById('peopleBadge').textContent = '0';
                }
            } catch (error) {
                console.error('Load people error:', error);
                container.innerHTML = '<div style="text-align: center; color: #ff6464; padding: 40px;">Failed to load people database</div>';
            }
        }

        function openPersonFromBrowse(person) {
            // Convert browse result to format expected by openPersonModal
            const result = {
                id: person.id,
                name: person.name,
                type: person.type,
                source_url: person.source_url,
                sourceUrl: person.source_url,  // camelCase for modal template
                confidence_score: person.confidence_score,
                locations: person.locations,
                table_source: 'unconfirmed_persons',
                archive_url: person.archive_url,
                archiveUrl: person.archive_url  // camelCase for modal template
            };
            openPersonModal(result);
        }

        function formatCount(num) {
            if (!num) return '--';
            if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
            if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
            return num.toString();
        }

        // ============================================
        // DOCUMENT VIEWER
        // ============================================
        async function openDocViewer(documentId) {
            document.getElementById('documentViewer').classList.add('active');
            const content = document.getElementById('docViewerContent');
            content.innerHTML = '<div style="text-align: center; padding: 50px;"><div class="spinner" style="margin: 0 auto;"></div><p style="margin-top: 15px; color: #9aa5b1;">Loading document...</p></div>';

            try {
                // Get document metadata
                const metaResponse = await fetch(`${API_BASE_URL}/api/documents/${documentId}`);
                const metaData = await metaResponse.json();

                if (metaData.success) {
                    const doc = metaData.document;

                    // Update sidebar
                    document.getElementById('docMetadata').innerHTML = `
                        <div style="margin-bottom: 15px;">
                            <div style="color: #9aa5b1; font-size: 0.85em;">Title</div>
                            <div style="color: #e0e0e0;">${escapeHtml(doc.title || 'Untitled')}</div>
                        </div>
                        ${doc.owner_name ? `
                        <div style="margin-bottom: 15px;">
                            <div style="color: #9aa5b1; font-size: 0.85em;">Owner</div>
                            <div style="color: #e0e0e0;">${escapeHtml(doc.owner_name)}</div>
                        </div>` : ''}
                        ${doc.document_date ? `
                        <div style="margin-bottom: 15px;">
                            <div style="color: #9aa5b1; font-size: 0.85em;">Date</div>
                            <div style="color: #e0e0e0;">${doc.document_date}</div>
                        </div>` : ''}
                        ${doc.document_type ? `
                        <div style="margin-bottom: 15px;">
                            <div style="color: #9aa5b1; font-size: 0.85em;">Type</div>
                            <div style="color: #e0e0e0;">${doc.document_type}</div>
                        </div>` : ''}
                    `;

                    // Get access URL
                    const accessResponse = await fetch(`${API_BASE_URL}/api/documents/${documentId}/access`);
                    const accessData = await accessResponse.json();

                    if (accessData.success) {
                        const mimeType = accessData.metadata?.mimeType || doc.mime_type;

                        if (mimeType && mimeType.includes('pdf')) {
                            content.innerHTML = `<iframe src="${accessData.viewUrl}" style="width: 100%; height: 85vh; border: none; border-radius: 8px;"></iframe>`;
                        } else {
                            content.innerHTML = `<img src="${accessData.viewUrl}" style="max-height: 85vh; border-radius: 8px;" />`;
                        }

                        window.currentDocDownloadUrl = accessData.downloadUrl;
                    } else {
                        throw new Error(accessData.error || 'Failed to access document');
                    }
                }
            } catch (error) {
                content.innerHTML = `<div style="text-align: center; padding: 50px; color: #ff6464;">Failed to load document: ${error.message}</div>`;
            }
        }

        function closeDocViewer() {
            document.getElementById('documentViewer').classList.remove('active');
        }

        function downloadDocument() {
            if (window.currentDocDownloadUrl) {
                window.open(window.currentDocDownloadUrl, '_blank');
            }
        }

        function zoomDocument() {
            const img = document.querySelector('#docViewerContent img');
            if (img) {
                img.style.transform = img.style.transform === 'scale(1.5)' ? 'scale(1)' : 'scale(1.5)';
            }
        }

        // ============================================
        // CHAT
        // ============================================
        async function sendChat() {
            const input = document.getElementById('chatInput');
            const message = input.value.trim();
            if (!message) return;

            const messagesContainer = document.getElementById('chatMessages');

            // Add user message
            messagesContainer.innerHTML += `<div class="chat-message user">${escapeHtml(message)}</div>`;
            input.value = '';
            messagesContainer.scrollTop = messagesContainer.scrollHeight;

            try {
                const response = await fetch(`${API_BASE_URL}/api/chat`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message, sessionId: 'main-chat' })
                });

                if (response.ok) {
                    const data = await response.json();
                    // Format response - convert markdown bold to HTML
                    let responseText = (data.response || 'No response')
                        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                        .replace(/\n/g, '<br>');
                    messagesContainer.innerHTML += `<div class="chat-message assistant">${responseText}</div>`;
                } else {
                    messagesContainer.innerHTML += `<div class="chat-message assistant">Sorry, I couldn't process that request. Try "help" for commands.</div>`;
                }
            } catch (error) {
                messagesContainer.innerHTML += `<div class="chat-message assistant">Connection error. Please try again.</div>`;
            }

            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }

        // ============================================
        // FILE UPLOAD
        // ============================================
        function handleFileSelect(event) {
            const files = event.target.files;
            const queue = document.getElementById('uploadQueue');

            queue.innerHTML = Array.from(files).map((file, i) => `
                <div style="padding: 10px; background: rgba(30, 40, 70, 0.6); margin: 8px 0; border-radius: 8px; display: flex; justify-content: space-between; align-items: center;">
                    <span>${escapeHtml(file.name)}</span>
                    <span style="color: #9aa5b1; font-size: 0.85em;">${(file.size / 1024 / 1024).toFixed(2)} MB</span>
                </div>
            `).join('');

            if (files.length > 0) {
                queue.innerHTML += `
                    <button onclick="uploadFiles()" style="margin-top: 15px; padding: 12px 25px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border: none; border-radius: 8px; color: white; font-weight: 600; cursor: pointer; width: 100%;">
                        Upload ${files.length} file${files.length > 1 ? 's' : ''}
                    </button>
                `;
            }
        }

        async function uploadFiles() {
            const files = document.getElementById('fileInput').files;
            if (!files.length) return;

            const formData = new FormData();
            Array.from(files).forEach(file => formData.append('documents', file));

            try {
                showToast('Uploading...', 'info');

                const response = await fetch(`${API_BASE_URL}/api/documents/upload`, {
                    method: 'POST',
                    body: formData
                });

                if (response.ok) {
                    showToast('Upload successful!', 'success');
                    document.getElementById('uploadQueue').innerHTML = '';
                    document.getElementById('fileInput').value = '';
                } else {
                    throw new Error('Upload failed');
                }
            } catch (error) {
                showToast('Upload failed: ' + error.message, 'error');
            }
        }

        // ============================================
        // WALLET
        // ============================================
        async function connectWallet() {
            if (typeof window.ethereum === 'undefined') {
                showToast('Please install MetaMask', 'error');
                return;
            }

            try {
                const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
                const btn = document.getElementById('walletBtn');
                btn.textContent = accounts[0].slice(0, 6) + '...' + accounts[0].slice(-4);
                btn.classList.add('connected');
                showToast('Wallet connected', 'success');
            } catch (error) {
                showToast('Failed to connect wallet', 'error');
            }
        }

        // ============================================
        // DATA QUALITY
        // ============================================
        let qualityData = null;

        async function loadDataQuality() {
            try {
                const response = await fetch(`${API_BASE_URL}/api/contribute/data-quality`);
                if (!response.ok) throw new Error('Failed to load');

                qualityData = await response.json();

                if (qualityData.success) {
                    // Update stats
                    document.getElementById('qualityTotalIssues').textContent = formatNumber(qualityData.summary.totalIssues);

                    const issues = qualityData.summary.issueBreakdown;
                    const lowConf = issues.find(i => i.issue_type === 'low_confidence');
                    const missingOwner = issues.find(i => i.issue_type === 'missing_owner_link');

                    document.getElementById('qualityLowConf').textContent = formatNumber(lowConf?.count || 0);
                    document.getElementById('qualityMissingOwner').textContent = formatNumber(missingOwner?.count || 0);

                    // Update badge
                    const badge = document.getElementById('qualityBadge');
                    if (qualityData.summary.totalIssues > 0) {
                        badge.textContent = qualityData.summary.totalIssues > 99 ? '99+' : qualityData.summary.totalIssues;
                        badge.style.display = 'block';
                    } else {
                        badge.style.display = 'none';
                    }

                    // Render fix buttons
                    const fixContainer = document.getElementById('qualityFixButtons');
                    if (qualityData.fixablePatterns && qualityData.fixablePatterns.length > 0) {
                        fixContainer.innerHTML = qualityData.fixablePatterns.map(fix => `
                            <button class="quality-btn-bulk" onclick="applyQualityFix('${fix.fix_type}')">
                                ${escapeHtml(fix.description)} (${formatNumber(fix.affected_count)})
                            </button>
                        `).join('');
                    } else {
                        fixContainer.innerHTML = '<div style="color: #64ff64;">No automated fixes available - data looks clean!</div>';
                    }

                    // Render records to review
                    renderQualityRecords(qualityData.sampleGarbage);
                }
            } catch (error) {
                console.error('Failed to load data quality:', error);
                document.getElementById('qualityRecords').innerHTML = '<div style="color: #ff6464; text-align: center; padding: 20px;">Failed to load. Is the server running?</div>';
            }
        }

        function renderQualityRecords(records) {
            const container = document.getElementById('qualityRecords');

            if (!records || records.length === 0) {
                container.innerHTML = '<div style="color: #64ff64; text-align: center; padding: 20px;">No garbage records found - database is clean!</div>';
                return;
            }

            container.innerHTML = records.map(record => `
                <div class="quality-record" id="qrecord-${record.lead_id}">
                    <div class="quality-record-name">${escapeHtml(record.full_name)}</div>
                    <div class="quality-record-meta">
                        Type: ${record.person_type || 'unknown'} |
                        Confidence: ${Math.round((record.confidence_score || 0) * 100)}%
                        ${record.source_url ? ` | <a href="${escapeHtml(record.source_url)}" target="_blank" style="color: #64c8ff;">Source</a>` : ''}
                    </div>
                    <div class="quality-record-actions">
                        <input type="text" id="qfix-${record.lead_id}" placeholder="Correct name..." />
                        <button class="quality-btn quality-btn-fix" onclick="fixQualityRecord('${record.lead_id}')">Fix</button>
                        <button class="quality-btn quality-btn-delete" onclick="deleteQualityRecord('${record.lead_id}')">Delete</button>
                    </div>
                </div>
            `).join('');
        }

        async function applyQualityFix(fixType) {
            if (!confirm(`Apply fix: ${fixType}?\n\nThis will modify the database.`)) return;

            try {
                const response = await fetch(`${API_BASE_URL}/api/contribute/data-quality/fix`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ fixType })
                });

                const data = await response.json();

                if (data.success) {
                    showToast(data.message, 'success');
                    loadDataQuality(); // Refresh
                } else {
                    showToast(data.error || 'Fix failed', 'error');
                }
            } catch (error) {
                showToast('Failed to apply fix: ' + error.message, 'error');
            }
        }

        async function fixQualityRecord(id) {
            const input = document.getElementById(`qfix-${id}`);
            const newName = input?.value.trim();

            if (!newName) {
                showToast('Enter a corrected name first', 'error');
                return;
            }

            try {
                const response = await fetch(`${API_BASE_URL}/api/contribute/data-quality/record/${id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ full_name: newName, confidence_score: 0.9 })
                });

                const data = await response.json();

                if (data.success) {
                    document.getElementById(`qrecord-${id}`).classList.add('fixed');
                    showToast(`Fixed: ${newName}`, 'success');
                } else {
                    showToast(data.error || 'Fix failed', 'error');
                }
            } catch (error) {
                showToast('Failed to fix record: ' + error.message, 'error');
            }
        }

        async function deleteQualityRecord(id) {
            try {
                const response = await fetch(`${API_BASE_URL}/api/contribute/data-quality/record/${id}`, {
                    method: 'DELETE'
                });

                const data = await response.json();

                if (data.success) {
                    document.getElementById(`qrecord-${id}`).classList.add('deleted');
                    showToast(data.message || 'Record deleted', 'success');
                } else {
                    showToast(data.error || 'Delete failed', 'error');
                }
            } catch (error) {
                showToast('Failed to delete record: ' + error.message, 'error');
            }
        }

        // ============================================
        // EXTRACTION PROGRESS
        // ============================================
        let progressRefreshInterval = null;

        async function loadExtractionProgress() {
            try {
                const response = await fetch(`${API_BASE_URL}/api/contribute/extraction-progress`);
                const data = await response.json();

                if (!data.success) {
                    document.getElementById('currentJob').innerHTML = `
                        <div style="text-align: center; color: #ff6464;">Error loading progress</div>
                    `;
                    return;
                }

                // Update progress indicator in quick actions button
                const indicator = document.getElementById('progressIndicator');
                const badge = document.getElementById('progressBadge');
                if (data.hasRunningJob) {
                    indicator.innerHTML = '🟢 ';
                    badge.textContent = `${Math.round(data.current.percent_complete)}%`;
                    badge.style.display = 'block';
                    badge.style.background = '#22c55e';
                } else {
                    indicator.innerHTML = '';
                    badge.style.display = 'none';
                }

                // Update current job section
                if (data.current) {
                    const job = data.current;
                    const statusColor = job.actual_status === 'running' ? '#22c55e' :
                                       job.actual_status === 'stalled' ? '#f59e0b' :
                                       job.actual_status === 'completed' ? '#64c8ff' : '#ff6464';
                    const statusLabel = job.actual_status === 'running' ? '🟢 Running' :
                                       job.actual_status === 'stalled' ? '🟡 Stalled' :
                                       job.actual_status === 'completed' ? '✅ Completed' : '⚠️ ' + job.status;

                    document.getElementById('currentJob').innerHTML = `
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                            <div>
                                <div style="font-weight: bold; color: #fff; font-size: 1.1em;">${escapeHtml(job.job_name)}</div>
                                <div style="color: #9aa5b1; font-size: 0.9em;">Year: ${job.year || 'Mixed'}</div>
                            </div>
                            <div style="color: ${statusColor}; font-weight: bold;">${statusLabel}</div>
                        </div>
                        <div style="background: #1f2937; border-radius: 8px; height: 24px; overflow: hidden; margin-bottom: 10px;">
                            <div style="background: linear-gradient(90deg, #3b82f6, #8b5cf6); height: 100%; width: ${job.percent_complete}%; transition: width 0.5s;"></div>
                        </div>
                        <div style="display: flex; justify-content: space-between; color: #9aa5b1; font-size: 0.9em;">
                            <span>${job.percent_complete}% complete</span>
                            <span>${job.locations_processed} / ${job.locations_total} counties</span>
                        </div>
                        <div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.1);">
                            <div style="color: #9aa5b1; font-size: 0.85em;">
                                <strong style="color: #64c8ff;">Currently:</strong> ${escapeHtml(job.current_state || 'N/A')} > ${escapeHtml(job.current_county || 'N/A')} > ${escapeHtml(job.current_district || 'N/A')}
                            </div>
                            ${job.eta_formatted ? `<div style="color: #22c55e; margin-top: 5px;">⏱ ETA: ${job.eta_formatted}</div>` : ''}
                            ${job.errors > 0 ? `<div style="color: #f59e0b; margin-top: 5px;">⚠️ ${job.errors} errors</div>` : ''}
                        </div>
                    `;

                    // Update stats
                    document.getElementById('progressLocations').textContent = formatNumber(job.locations_processed);
                    document.getElementById('progressImages').textContent = formatNumber(job.images_processed);
                    document.getElementById('progressOwners').textContent = formatNumber(job.owners_extracted);
                    document.getElementById('progressEnslaved').textContent = formatNumber(job.enslaved_extracted);
                } else {
                    document.getElementById('currentJob').innerHTML = `
                        <div style="text-align: center; color: #9aa5b1; padding: 20px;">
                            <div style="font-size: 2em; margin-bottom: 10px;">⏸️</div>
                            <div>No extraction currently running</div>
                            <div style="font-size: 0.85em; margin-top: 10px;">Start extraction via command line</div>
                        </div>
                    `;
                    document.getElementById('progressLocations').textContent = '-';
                    document.getElementById('progressImages').textContent = '-';
                    document.getElementById('progressOwners').textContent = '-';
                    document.getElementById('progressEnslaved').textContent = '-';
                }

                // Update recent jobs list
                const recentContainer = document.getElementById('recentJobs');
                if (data.recent && data.recent.length > 0) {
                    recentContainer.innerHTML = data.recent.map(job => {
                        const statusIcon = job.status === 'completed' ? '✅' :
                                          job.status === 'running' ? '🔄' :
                                          job.status === 'interrupted' ? '⚠️' : '❌';
                        const date = new Date(job.started_at).toLocaleDateString();
                        return `
                            <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px; background: rgba(255,255,255,0.03); border-radius: 8px; margin-bottom: 8px;">
                                <div>
                                    <div style="color: #fff; font-weight: 500;">${statusIcon} ${escapeHtml(job.job_name)}</div>
                                    <div style="color: #6b7280; font-size: 0.85em;">${date} • ${formatNumber(job.enslaved_extracted)} enslaved</div>
                                </div>
                                <div style="text-align: right;">
                                    <div style="color: #64c8ff; font-weight: bold;">${job.percent_complete}%</div>
                                    <div style="color: #6b7280; font-size: 0.8em;">${formatNumber(job.locations_processed)}/${formatNumber(job.locations_total)}</div>
                                </div>
                            </div>
                        `;
                    }).join('');
                } else {
                    recentContainer.innerHTML = '<div style="text-align: center; color: #9aa5b1; padding: 20px;">No extraction jobs yet</div>';
                }

            } catch (error) {
                console.error('Progress load error:', error);
                document.getElementById('currentJob').innerHTML = `
                    <div style="text-align: center; color: #ff6464;">Failed to load: ${error.message}</div>
                `;
            }
        }

        function startProgressRefresh() {
            loadExtractionProgress();
            if (progressRefreshInterval) clearInterval(progressRefreshInterval);
            progressRefreshInterval = setInterval(loadExtractionProgress, 10000);
        }

        function stopProgressRefresh() {
            if (progressRefreshInterval) {
                clearInterval(progressRefreshInterval);
                progressRefreshInterval = null;
            }
        }

        // ============================================
        // UTILITIES
        // ============================================
        function showToast(message, type = 'info') {
            const toast = document.getElementById('toast');
            toast.textContent = message;
            toast.className = `toast ${type} visible`;

            setTimeout(() => {
                toast.classList.remove('visible');
            }, 3000);
        }

        function escapeHtml(text) {
            if (!text) return '';
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
