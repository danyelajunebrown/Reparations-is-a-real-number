/**
 * SlaveVoyages.org API Client
 *
 * REST API for the Trans-Atlantic Slave Trade Database.
 * 36,000+ voyages, records on 12+ million displaced Africans.
 * Includes enslaver names, voyages, ports, dates, number of captives.
 *
 * API docs: https://www.slavevoyages.org/api/
 * GitHub: https://github.com/slavevoyages/voyages-api
 * No authentication required.
 *
 * Usage:
 *   const api = require('./slavevoyages-api');
 *   const results = await api.searchEnslavers('Smith');
 *   const voyages = await api.searchVoyages({ year_arrived: [1700, 1800] });
 */

const BASE_URL = 'https://api.slavevoyages.org';

// Public auth token (embedded in the SlaveVoyages.org frontend JS bundle)
const AUTH_TOKEN = 'd3eb897a50604f6b995872caa6e8b23baabe2ddb';

// Rate limiting
let lastRequestTime = 0;
const RATE_LIMIT_MS = 1000; // 1 second between requests

async function rateLimitedFetch(url, options) {
    const now = Date.now();
    const elapsed = now - lastRequestTime;
    if (elapsed < RATE_LIMIT_MS) {
        await new Promise(r => setTimeout(r, RATE_LIMIT_MS - elapsed));
    }
    lastRequestTime = Date.now();

    const response = await fetch(url, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': `Token ${AUTH_TOKEN}`,
            ...(options?.headers || {})
        }
    });

    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`SlaveVoyages API error ${response.status}: ${text.substring(0, 200)}`);
    }

    return response.json();
}

/**
 * Search for enslavers by name
 * @param {string} name - Enslaver name (partial match, case-insensitive)
 * @param {object} options - Additional filters
 * @returns {Array} Array of enslaver records
 */
async function searchEnslavers(name, options = {}) {
    const filters = [{
        varName: 'aliases__alias',
        op: 'icontains',
        searchTerm: name
    }];

    const payload = {
        filter: filters,
        page: 1,
        page_size: options.pageSize || 20
    };

    try {
        const data = await rateLimitedFetch(`${BASE_URL}/past/enslaver/`, {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        // API returns: { page, page_size, count, results: [...] }
        // Each result has: { id, names: [...], birth, death, principal_location, named_enslaved_people, voyages, sources }
        if (data?.results) return data.results;
        if (Array.isArray(data) && data.length === 1 && typeof data[0] === 'string') {
            // Error message from API
            console.error(`SlaveVoyages filter error: ${data[0]}`);
            return [];
        }
        return Array.isArray(data) ? data : [];
    } catch (err) {
        console.error(`SlaveVoyages enslaver search error for "${name}":`, err.message);
        return [];
    }
}

/**
 * Search for voyages with filters
 * @param {object} filters - Voyage search filters
 * @returns {Array} Array of voyage records
 */
async function searchVoyages(filters = {}) {
    const filterList = [];

    if (filters.year_arrived) {
        filterList.push({
            varName: 'var_imp_arrival_at_port_of_dis',
            op: 'btw',
            searchTerm: filters.year_arrived // [startYear, endYear]
        });
    }

    if (filters.ship_name) {
        filterList.push({
            varName: 'var_ship_name',
            op: 'icontains',
            searchTerm: filters.ship_name
        });
    }

    const payload = {
        filter: filterList,
        page: 1,
        page_size: filters.pageSize || 10
    };

    try {
        const data = await rateLimitedFetch(`${BASE_URL}/voyage/`, {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        return data?.results || (Array.isArray(data) ? data : []);
    } catch (err) {
        console.error('SlaveVoyages voyage search error:', err.message);
        return [];
    }
}

/**
 * Search for enslaved persons
 * @param {object} filters - Search filters
 * @returns {Array} Array of enslaved person records
 */
async function searchEnslaved(filters = {}) {
    const filterList = [];

    if (filters.name) {
        filterList.push({
            varName: 'documented_name',
            op: 'icontains',
            searchTerm: filters.name
        });
    }

    if (filters.age) {
        filterList.push({
            varName: 'age',
            op: 'btw',
            searchTerm: filters.age // [minAge, maxAge]
        });
    }

    const payload = {
        filter: filterList,
        page: 1,
        page_size: filters.pageSize || 10
    };

    try {
        const data = await rateLimitedFetch(`${BASE_URL}/past/enslaved/`, {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        return data?.results || (Array.isArray(data) ? data : []);
    } catch (err) {
        console.error('SlaveVoyages enslaved search error:', err.message);
        return [];
    }
}

/**
 * Check if a person name matches any known enslaver in SlaveVoyages
 * Used as a fallback in the ancestor climber's checkEnslaverDatabase()
 *
 * @param {object} person - { name, birth_year, death_year, locations }
 * @returns {object|null} Match result with confidence, or null
 */
async function checkEnslaver(person) {
    if (!person.name) return null;

    // Extract surname for search (SlaveVoyages works best with surname)
    const nameParts = person.name.trim().split(/\s+/);
    const surname = nameParts[nameParts.length - 1];
    const firstName = nameParts[0];

    // Require first + last name minimum — surname alone should never match
    if (!surname || surname.length < 2 || nameParts.length < 2 || firstName.length < 2) return null;

    const results = await searchEnslavers(surname);
    if (!results || !Array.isArray(results) || results.length === 0) return null;

    // Filter for matches
    let bestMatch = null;
    let bestConfidence = 0;

    for (const enslaver of results) {
        // API returns: { id, names: ['Last, First'], birth, death, principal_location, named_enslaved_people, voyages, sources }
        const enslaverName = (enslaver.names && enslaver.names[0]) || '';
        if (!enslaverName) continue;

        // Exact surname whole-word match — reject "Young" matching "Youngblood"
        const enslaverNameLower = enslaverName.toLowerCase();
        const surnameLower = surname.toLowerCase();
        const surnameRegex = new RegExp(`\\b${surnameLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
        if (!surnameRegex.test(enslaverNameLower)) continue;

        let confidence = 0;

        // Full name match (case-insensitive)
        if (enslaverNameLower === person.name.toLowerCase()) {
            confidence = 0.80;
        }
        // Surname + first name match (require first name > 1 char)
        else if (surnameRegex.test(enslaverNameLower) &&
                 firstName.length > 1 &&
                 enslaverNameLower.includes(firstName.toLowerCase())) {
            confidence = 0.70;
        }
        // First-initial-only matching REMOVED — too many false positives for international database
        else {
            continue;
        }

        // Temporal check — if enslaver has birth/death dates, validate against ancestor
        if (person.birth_year) {
            const enslaverDeath = enslaver.death;
            if (enslaverDeath && (person.birth_year - enslaverDeath) > 20) {
                // Enslaver died >20 years before ancestor was born — reject
                continue;
            }
            const enslaverBirth = enslaver.birth;
            if (enslaverBirth && Math.abs(person.birth_year - enslaverBirth) > 50) {
                // Birth years differ by >50 years — unlikely to be the same person
                continue;
            }
        }

        // Location boost — if enslaver has a principal location matching person's locations
        if (person.locations && person.locations.length > 0 && enslaver.principal_location?.name) {
            const loc = enslaver.principal_location.name.toLowerCase();
            for (const personLoc of person.locations) {
                if (loc.includes(personLoc.toLowerCase()) || personLoc.toLowerCase().includes(loc)) {
                    confidence += 0.10;
                    break;
                }
            }
        }

        // Enslaved people boost — if they have named enslaved people, it's a stronger record
        if (enslaver.named_enslaved_people && enslaver.named_enslaved_people.length > 0) {
            confidence += 0.05;
        }

        if (confidence > bestConfidence) {
            bestConfidence = confidence;
            bestMatch = {
                id: enslaver.id,
                canonical_name: enslaverName,
                confidence,
                type: 'slavevoyages_enslaver',
                source: 'slavevoyages.org',
                location: enslaver.principal_location?.name || null,
                voyages: enslaver.voyages || [],
                named_enslaved_count: enslaver.named_enslaved_people?.length || 0,
                sources: (enslaver.sources || []).map(s => s.title || s.short_ref?.name).filter(Boolean)
            };
        }
    }

    // Raised threshold from 0.55 to 0.65
    if (bestMatch && bestConfidence >= 0.65) {
        return bestMatch;
    }

    return null;
}

module.exports = {
    searchEnslavers,
    searchVoyages,
    searchEnslaved,
    checkEnslaver,
    BASE_URL
};
