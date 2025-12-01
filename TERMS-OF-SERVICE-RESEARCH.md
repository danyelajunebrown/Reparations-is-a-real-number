# Terms of Service Research for Web Scraping

## Purpose

This document tracks the Terms of Service for websites we may scrape to ensure legal compliance.

---

## Wikipedia

**URL**: https://en.wikipedia.org/wiki/Wikipedia:Terms_of_Service

**Paste TOS here**:
```
[TO BE FILLED IN]
```

**Key Points** (to be completed after review):
- [ ] Commercial use allowed?
- [ ] Scraping/automated access allowed?
- [ ] Attribution requirements?
- [ ] Rate limiting requirements?
- [ ] Content license (CC BY-SA)?

---

## FamilySearch

**URL**: https://www.familysearch.org/en/terms

**Paste TOS here**:
```
[TO BE FILLED IN]
```

**Key Points** (to be completed after review):
- [ ] Can we scrape public family trees?
- [ ] API available?
- [ ] User consent required for private trees?
- [ ] Rate limiting?
- [ ] Attribution requirements?

---

## Ancestry.com

**URL**: https://www.ancestry.com/cs/legal/termsandconditions

**Paste TOS here**:
```
[TO BE FILLED IN]
```

**Key Points** (to be completed after review):
- [ ] Scraping explicitly prohibited?
- [ ] API available?
- [ ] User trees considered private?
- [ ] Can users export their own data?
- [ ] Research/academic use exceptions?

---

## FindAGrave

**URL**: https://www.findagrave.com/page/terms-of-service

**Paste TOS here**:
```
[TO BE FILLED IN]
```

**Key Points** (to be completed after review):
- [ ] Public memorials scrapable?
- [ ] Commercial use restrictions?
- [ ] Attribution requirements?
- [ ] Rate limiting?
- [ ] API available?

---

## Archive.org

**URL**: https://archive.org/about/terms.php

**Paste TOS here**:
```
[TO BE FILLED IN]
```

**Key Points** (to be completed after review):
- [ ] Bulk downloading allowed?
- [ ] Research use permitted?
- [ ] API access?
- [ ] Rate limiting requirements?
- [ ] Attribution requirements?

---

## Library of Congress (loc.gov)

**URL**: https://www.loc.gov/legal/

**Paste TOS here**:
```
[TO BE FILLED IN]
```

**Key Points** (to be completed after review):
- [ ] Public domain materials?
- [ ] Scraping policy?
- [ ] API available?
- [ ] Research use permitted?

---

## National Archives (NARA)

**URL**: https://www.archives.gov/global-pages/privacy.html

**Paste TOS here**:
```
[TO BE FILLED IN]
```

**Key Points** (to be completed after review):
- [ ] Public records access?
- [ ] Bulk download permitted?
- [ ] API available?
- [ ] Commercial use restrictions?

---

## General Legal Considerations

### Fair Use (US Copyright Law)
Research use may qualify as fair use under:
- **Purpose**: Non-commercial historical research
- **Nature**: Factual/historical information
- **Amount**: Minimal necessary portions
- **Effect**: No market harm

### Computer Fraud and Abuse Act (CFAA)
To avoid CFAA issues:
- [ ] Respect robots.txt
- [ ] Honor rate limits
- [ ] Don't circumvent access controls
- [ ] Don't cause server harm

### Consent Model
- [ ] Only scrape public information
- [ ] Users can opt to share private trees
- [ ] Screenshot/HTML upload for login-required sites
- [ ] Never scrape behind authentication without permission

---

## Action Items After TOS Review

1. **Identify prohibited sites**: Mark any sites where scraping is explicitly prohibited
2. **Find API alternatives**: For sites with APIs, use those instead of scraping
3. **Implement robots.txt**: Check and honor robots.txt for each domain
4. **Add rate limiting**: Implement delays between requests (e.g., 1-2 seconds)
5. **Add attribution**: Include source URLs in all extracted data
6. **User consent flow**: For sites requiring authentication, implement upload workflow

---

## Summary Table (to be completed)

| Site | Scraping Allowed? | API Available? | Attribution Required? | Notes |
|------|-------------------|----------------|----------------------|-------|
| Wikipedia | TBD | Yes (MediaWiki API) | TBD | |
| FamilySearch | TBD | Yes (requires key) | TBD | |
| Ancestry | TBD | Limited | TBD | Likely prohibited |
| FindAGrave | TBD | No | TBD | |
| Archive.org | TBD | Yes | TBD | |
| Library of Congress | TBD | Yes | TBD | |
| NARA | TBD | Yes | TBD | |

---

## Implementation Notes

Once TOS review is complete:
1. Update `autonomous-web-scraper.js` with site-specific logic
2. Add robots.txt checking before each scrape
3. Implement per-domain rate limiting
4. Add attribution to all saved records
5. Block prohibited sites in submission form
6. Document allowed vs disallowed sources
