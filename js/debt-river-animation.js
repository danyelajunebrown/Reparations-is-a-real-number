/**
 * Debt River Animation
 * Creates a flowing background visualization of slave owner names with reparations amounts
 */

class DebtRiverAnimation {
    constructor(container) {
        this.container = container;
        this.particles = [];
        this.isSearchActive = false;
        this.searchQuery = '';
        this.animationFrame = null;
        this.lastTime = performance.now();
        
        // Regional color coding
        this.regionColors = {
            'Maryland': '#8b4513',      // Brown - Chesapeake
            'Virginia': '#8b4513',
            'South Carolina': '#2e7d32', // Dark green - Deep South
            'Georgia': '#2e7d32',
            'Louisiana': '#5e35b1',      // Purple - Gulf Coast
            'Mississippi': '#5e35b1',
            'Washington DC': '#1976d2',  // Blue - Federal records
            'Alabama': '#d84315',        // Orange-red
            'North Carolina': '#6a1b9a'  // Deep purple
        };

        // Curated list of documented slave owners with calculated reparations
        // These are real cases from the database
        this.slaveOwners = [
            { name: 'James Hopewell', region: 'Maryland', amount: 2200000, enslaved: 32 },
            { name: 'Thomas Ravenel', region: 'South Carolina', amount: 1850000, enslaved: 28 },
            { name: 'Stephen Ravenel', region: 'South Carolina', amount: 2100000, enslaved: 31 },
            { name: 'Daniel Ravenel', region: 'South Carolina', amount: 1950000, enslaved: 29 },
            { name: 'Thomas Donoho', region: 'Washington DC', amount: 780000, enslaved: 15 },
            { name: 'Ann Biscoe', region: 'Maryland', amount: 1200000, enslaved: 22 },
            { name: 'George Washington', region: 'Virginia', amount: 6500000, enslaved: 123 },
            { name: 'Joseph Miller', region: 'Louisiana', amount: 980000, enslaved: 18 },
            { name: 'Nancy Miller Brown', region: 'Louisiana', amount: 450000, enslaved: 8 },
            { name: 'Henry Laurens', region: 'South Carolina', amount: 5200000, enslaved: 98 },
            { name: 'Wade Hampton', region: 'South Carolina', amount: 8900000, enslaved: 168 },
            { name: 'James Middleton', region: 'South Carolina', amount: 3400000, enslaved: 64 },
            { name: 'Charles Pinckney', region: 'South Carolina', amount: 2800000, enslaved: 53 },
            { name: 'Robert Carter', region: 'Virginia', amount: 11200000, enslaved: 212 },
            { name: 'John Ball', region: 'South Carolina', amount: 1650000, enslaved: 31 },
            { name: 'Elias Ball', region: 'South Carolina', amount: 1920000, enslaved: 36 },
            { name: 'Isaac Ball', region: 'South Carolina', amount: 1780000, enslaved: 33 },
            { name: 'Peter Gaillard', region: 'South Carolina', amount: 1340000, enslaved: 25 },
            { name: 'William Aiken', region: 'South Carolina', amount: 4100000, enslaved: 77 },
            { name: 'Nathaniel Heyward', region: 'South Carolina', amount: 9800000, enslaved: 185 }
        ];

        this.init();
    }

    init() {
        // Create particles for each slave owner
        this.slaveOwners.forEach((owner, index) => {
            const particle = new NameParticle(owner, index, this.regionColors);
            this.particles.push(particle);
            this.container.appendChild(particle.element);
        });

        // Start animation
        this.animate();

        // Handle resize
        window.addEventListener('resize', () => this.handleResize());
    }

    animate() {
        const currentTime = performance.now();
        const deltaTime = (currentTime - this.lastTime) / 1000; // Convert to seconds
        this.lastTime = currentTime;

        // Update each particle
        this.particles.forEach(particle => {
            particle.update(deltaTime, this.isSearchActive, this.searchQuery);
        });

        this.animationFrame = requestAnimationFrame(() => this.animate());
    }

    onSearch(query) {
        this.searchQuery = query.toLowerCase().trim();
        this.isSearchActive = this.searchQuery.length > 0;

        if (this.isSearchActive) {
            // Apply magnetic pull to matching names
            this.particles.forEach(particle => {
                const matches = particle.owner.name.toLowerCase().includes(this.searchQuery) ||
                               particle.owner.region.toLowerCase().includes(this.searchQuery);
                particle.setMatchState(matches);
            });
        } else {
            // Clear search - reset all particles
            this.particles.forEach(particle => {
                particle.setMatchState(false);
            });
        }
    }

    pause() {
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }
    }

    resume() {
        if (!this.animationFrame) {
            this.lastTime = performance.now();
            this.animate();
        }
    }

    handleResize() {
        // Reset particle positions on resize
        this.particles.forEach(particle => {
            particle.resetPosition();
        });
    }
}

class NameParticle {
    constructor(owner, index, regionColors) {
        this.owner = owner;
        this.index = index;
        this.regionColors = regionColors;
        
        // Create DOM element
        this.element = this.createElement();
        
        // Physics properties
        this.position = { x: 0, y: 0 };
        this.velocity = { 
            x: 15 + Math.random() * 25,  // 15-40 px/sec horizontal
            y: 0 
        };
        this.turbulenceOffset = Math.random() * Math.PI * 2; // Phase offset for swirl
        this.turbulenceAmplitude = 15 + Math.random() * 10;  // 15-25px vertical displacement
        this.turbulenceFrequency = 0.3 + Math.random() * 0.4; // Swirl speed variation
        
        // State
        this.isMatch = false;
        this.baseOpacity = 0.2 + Math.random() * 0.15; // 0.2-0.35
        
        // Initialize position
        this.resetPosition();
    }

    createElement() {
        const el = document.createElement('div');
        el.className = 'debt-particle';
        el.style.borderLeftColor = this.regionColors[this.owner.region] || '#64c8ff';
        
        const nameEl = document.createElement('div');
        nameEl.className = 'debt-name';
        nameEl.textContent = this.owner.name;
        
        const amountEl = document.createElement('div');
        amountEl.className = 'debt-amount';
        amountEl.textContent = `$${this.formatAmount(this.owner.amount)} owed · ${this.owner.region}`;
        
        el.appendChild(nameEl);
        el.appendChild(amountEl);
        
        // Click handler
        el.addEventListener('click', () => {
            if (this.isMatch) {
                // Trigger search for this person
                if (window.debtRiverSearchCallback) {
                    window.debtRiverSearchCallback(this.owner.name);
                }
            }
        });
        
        return el;
    }

    formatAmount(amount) {
        if (amount >= 1000000) {
            return (amount / 1000000).toFixed(1) + 'M';
        }
        if (amount >= 1000) {
            return (amount / 1000).toFixed(0) + 'K';
        }
        return amount.toString();
    }

    resetPosition() {
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight - 140; // Account for nav bars
        
        // Distribute vertically with some randomness
        const baseY = (this.index / 20) * viewportHeight;
        const randomY = (Math.random() - 0.5) * 100;
        
        // Start off-screen left with staggered positions
        this.position.x = -300 - (Math.random() * viewportWidth);
        this.position.y = Math.max(50, Math.min(viewportHeight - 50, baseY + randomY));
        
        this.updateDOMPosition();
    }

    update(deltaTime, isSearchActive, searchQuery) {
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight - 140;
        
        if (isSearchActive && this.isMatch) {
            // Magnetic pull toward center
            const centerX = viewportWidth / 2;
            const centerY = viewportHeight / 2;
            
            const dx = centerX - this.position.x;
            const dy = centerY - this.position.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            if (distance > 50) {
                // Apply attraction force
                const force = 200; // Attraction strength
                this.position.x += (dx / distance) * force * deltaTime;
                this.position.y += (dy / distance) * force * deltaTime;
            }
            
            // Increase opacity and scale
            this.element.style.opacity = '1';
            this.element.style.transform = `translate3d(${this.position.x}px, ${this.position.y}px, 0) scale(1.2)`;
            this.element.style.cursor = 'pointer';
            
        } else {
            // Normal flow mode - rocky river motion
            
            // Horizontal drift
            this.position.x += this.velocity.x * deltaTime;
            
            // Vertical turbulence (sinusoidal swirl)
            const time = performance.now() / 1000;
            const swirl = Math.sin(time * this.turbulenceFrequency + this.turbulenceOffset) * this.turbulenceAmplitude;
            this.position.y += swirl * deltaTime;
            
            // Keep within viewport vertically
            if (this.position.y < 50) this.position.y = 50;
            if (this.position.y > viewportHeight - 50) this.position.y = viewportHeight - 50;
            
            // Wrap around horizontally
            if (this.position.x > viewportWidth + 200) {
                this.position.x = -300;
                // Randomize Y when wrapping
                this.position.y = 50 + Math.random() * (viewportHeight - 100);
            }
            
            // Opacity based on match state
            const targetOpacity = (isSearchActive && !this.isMatch) ? 0 : this.baseOpacity;
            const currentOpacity = parseFloat(this.element.style.opacity) || this.baseOpacity;
            const newOpacity = currentOpacity + (targetOpacity - currentOpacity) * deltaTime * 2;
            
            this.element.style.opacity = newOpacity.toString();
            this.element.style.transform = `translate3d(${this.position.x}px, ${this.position.y}px, 0) scale(1)`;
            this.element.style.cursor = 'default';
        }
    }

    updateDOMPosition() {
        this.element.style.transform = `translate3d(${this.position.x}px, ${this.position.y}px, 0)`;
        this.element.style.opacity = this.baseOpacity.toString();
    }

    setMatchState(matches) {
        this.isMatch = matches;
    }
}

// Initialize on load
function initDebtRiver() {
    const container = document.getElementById('debtRiverContainer');
    if (container && !window.debtRiver) {
        window.debtRiver = new DebtRiverAnimation(container);
        
        // Set up search callback
        window.debtRiverSearchCallback = (name) => {
            document.getElementById('searchInput').value = name;
            performSearch();
        };
    }
}

// Export for integration
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { DebtRiverAnimation, initDebtRiver };
}
