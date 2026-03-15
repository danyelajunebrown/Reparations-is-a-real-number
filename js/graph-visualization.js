/**
 * Obsidian-Style Force-Directed Graph Visualization
 * Shows people in the database as interconnected nodes
 */

class GraphVisualization {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        if (!this.container) return;

        // Set API base URL
        this.apiBase = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
            ? 'http://localhost:3000'
            : 'https://reparations-platform.onrender.com';

        this.width = window.innerWidth;
        this.height = window.innerHeight;
        this.nodes = [];
        this.edges = [];
        this.simulation = null;
        this.svg = null;
        this.g = null;
        this.zoom = null;
        this.selectedNode = null;

        // Colors by type
        this.colors = {
            enslaved: '#60a5fa',    // Blue
            owner: '#f87171',       // Red
            unknown: '#a78bfa'      // Purple
        };

        // Initialize
        console.log('Graph Visualization: Initializing with container', containerId);
        this.init();
        this.loadData();

        // Handle resize
        window.addEventListener('resize', () => this.handleResize());
    }

    init() {
        // Create SVG
        this.svg = d3.select(this.container)
            .append('svg')
            .attr('width', '100%')
            .attr('height', '100%')
            .style('background', 'transparent');

        // Add zoom behavior
        this.zoom = d3.zoom()
            .scaleExtent([0.1, 4])
            .on('zoom', (event) => {
                this.g.attr('transform', event.transform);
            });

        this.svg.call(this.zoom);

        // Create main group for transformations
        this.g = this.svg.append('g');

        // Create groups for edges and nodes (edges behind nodes)
        this.edgeGroup = this.g.append('g').attr('class', 'edges');
        this.nodeGroup = this.g.append('g').attr('class', 'nodes');

        // Add glow filter for highlighted nodes
        const defs = this.svg.append('defs');
        const filter = defs.append('filter')
            .attr('id', 'glow')
            .attr('x', '-50%')
            .attr('y', '-50%')
            .attr('width', '200%')
            .attr('height', '200%');
        filter.append('feGaussianBlur')
            .attr('stdDeviation', '3')
            .attr('result', 'coloredBlur');
        const feMerge = filter.append('feMerge');
        feMerge.append('feMergeNode').attr('in', 'coloredBlur');
        feMerge.append('feMergeNode').attr('in', 'SourceGraphic');
    }

    async loadData(filters = {}) {
        const params = new URLSearchParams({
            limit: filters.limit || 300,
            type: filters.type || 'all',
            ...filters
        });

        try {
            console.log('Graph: Fetching from', `${this.apiBase}/api/contribute/graph?${params}`);
            const response = await fetch(`${this.apiBase}/api/contribute/graph?${params}`);
            const data = await response.json();
            console.log('Graph: Received', data.graph?.nodes?.length || 0, 'nodes');

            if (data.success && data.graph) {
                this.nodes = data.graph.nodes;
                this.edges = data.graph.edges;
                this.render();
                this.updateStats(data.stats);
            } else {
                console.log('Graph: No data, showing placeholder');
                this.showPlaceholder();
            }
        } catch (error) {
            console.error('Graph: Failed to load data:', error);
            // Show placeholder nodes as fallback
            this.showPlaceholder();
        }
    }

    showPlaceholder() {
        // Create sample nodes as visual placeholder
        this.nodes = [];
        for (let i = 0; i < 50; i++) {
            this.nodes.push({
                id: `placeholder-${i}`,
                name: i % 5 === 0 ? 'Loading...' : '',
                type: ['enslaved', 'owner', 'unknown'][i % 3],
                size: 5 + Math.random() * 10,
                confidence: 0.5
            });
        }
        this.edges = [];
        this.render();
    }

    render() {
        // Clear previous
        this.edgeGroup.selectAll('*').remove();
        this.nodeGroup.selectAll('*').remove();

        // Create force simulation
        this.simulation = d3.forceSimulation(this.nodes)
            .force('link', d3.forceLink(this.edges).id(d => d.id).distance(100))
            .force('charge', d3.forceManyBody().strength(-150))
            .force('center', d3.forceCenter(this.width / 2, this.height / 2))
            .force('collision', d3.forceCollide().radius(d => d.size + 5));

        // Create edges
        const links = this.edgeGroup.selectAll('line')
            .data(this.edges)
            .enter()
            .append('line')
            .attr('stroke', 'rgba(100, 200, 255, 0.2)')
            .attr('stroke-width', 1);

        // Create node groups
        const nodeGroups = this.nodeGroup.selectAll('g')
            .data(this.nodes)
            .enter()
            .append('g')
            .attr('class', 'node')
            .call(d3.drag()
                .on('start', (event, d) => this.dragStarted(event, d))
                .on('drag', (event, d) => this.dragged(event, d))
                .on('end', (event, d) => this.dragEnded(event, d)))
            .on('click', (event, d) => this.nodeClicked(event, d))
            .on('mouseover', (event, d) => this.nodeHovered(event, d, true))
            .on('mouseout', (event, d) => this.nodeHovered(event, d, false));

        // Add circles
        nodeGroups.append('circle')
            .attr('r', d => d.size)
            .attr('fill', d => this.colors[d.type] || this.colors.unknown)
            .attr('fill-opacity', 0.7)
            .attr('stroke', d => this.colors[d.type] || this.colors.unknown)
            .attr('stroke-width', 1.5)
            .attr('stroke-opacity', 0.9);

        // Add labels (only for larger nodes or named ones)
        nodeGroups.filter(d => d.name && d.name !== 'Loading...' && (d.size > 8 || d.confidence > 0.8))
            .append('text')
            .text(d => this.truncateName(d.name))
            .attr('text-anchor', 'middle')
            .attr('dy', d => d.size + 14)
            .attr('fill', '#e0e0e0')
            .attr('font-size', '10px')
            .attr('font-family', 'system-ui, sans-serif')
            .attr('opacity', 0.8);

        // Update positions on tick
        this.simulation.on('tick', () => {
            links
                .attr('x1', d => d.source.x)
                .attr('y1', d => d.source.y)
                .attr('x2', d => d.target.x)
                .attr('y2', d => d.target.y);

            nodeGroups.attr('transform', d => `translate(${d.x}, ${d.y})`);
        });
    }

    truncateName(name) {
        if (!name) return '';
        if (name.length <= 15) return name;
        return name.substring(0, 12) + '...';
    }

    dragStarted(event, d) {
        if (!event.active) this.simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
    }

    dragged(event, d) {
        d.fx = event.x;
        d.fy = event.y;
    }

    dragEnded(event, d) {
        if (!event.active) this.simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
    }

    nodeClicked(event, d) {
        event.stopPropagation();
        this.selectedNode = d;

        // Trigger search for this person
        if (d.name && d.name !== 'Loading...' && window.performSearch) {
            document.getElementById('searchInput').value = d.name;
            window.performSearch();
        }

        // Highlight connected nodes
        this.highlightConnections(d);
    }

    nodeHovered(event, d, isOver) {
        const node = d3.select(event.currentTarget);

        if (isOver) {
            node.select('circle')
                .transition()
                .duration(200)
                .attr('r', d.size * 1.3)
                .style('filter', 'url(#glow)');

            // Show tooltip
            this.showTooltip(event, d);
        } else {
            node.select('circle')
                .transition()
                .duration(200)
                .attr('r', d.size)
                .style('filter', null);

            this.hideTooltip();
        }
    }

    highlightConnections(node) {
        // Find connected nodes
        const connectedIds = new Set();
        this.edges.forEach(e => {
            if (e.source.id === node.id) connectedIds.add(e.target.id);
            if (e.target.id === node.id) connectedIds.add(e.source.id);
        });

        // Dim non-connected nodes
        this.nodeGroup.selectAll('g')
            .transition()
            .duration(300)
            .style('opacity', d =>
                d.id === node.id || connectedIds.has(d.id) ? 1 : 0.2
            );

        // Reset after delay
        setTimeout(() => {
            this.nodeGroup.selectAll('g')
                .transition()
                .duration(300)
                .style('opacity', 1);
        }, 2000);
    }

    showTooltip(event, d) {
        let tooltip = document.getElementById('graph-tooltip');
        if (!tooltip) {
            tooltip = document.createElement('div');
            tooltip.id = 'graph-tooltip';
            tooltip.className = 'graph-tooltip';
            document.body.appendChild(tooltip);
        }

        const typeLabel = d.type === 'enslaved' ? 'Enslaved Person' :
                          d.type === 'owner' ? 'Slaveholder' : 'Unknown';

        tooltip.innerHTML = `
            <div class="tooltip-name">${d.name || 'Unknown'}</div>
            <div class="tooltip-type">${typeLabel}</div>
            ${d.location ? `<div class="tooltip-location">${d.location}</div>` : ''}
            <div class="tooltip-confidence">Confidence: ${Math.round(d.confidence * 100)}%</div>
        `;

        tooltip.style.left = `${event.pageX + 15}px`;
        tooltip.style.top = `${event.pageY + 15}px`;
        tooltip.style.display = 'block';
    }

    hideTooltip() {
        const tooltip = document.getElementById('graph-tooltip');
        if (tooltip) tooltip.style.display = 'none';
    }

    updateStats(stats) {
        // Update any stats display
        const statsEl = document.getElementById('graph-stats');
        if (statsEl && stats) {
            statsEl.innerHTML = `
                <span>${stats.nodeCount} people</span>
                <span>${stats.edgeCount} connections</span>
            `;
        }
    }

    handleResize() {
        this.width = window.innerWidth;
        this.height = window.innerHeight;

        if (this.simulation) {
            this.simulation.force('center', d3.forceCenter(this.width / 2, this.height / 2));
            this.simulation.alpha(0.3).restart();
        }
    }

    // Filter methods
    filterByType(type) {
        this.loadData({ type, limit: 300 });
    }

    filterByState(state) {
        this.loadData({ state, limit: 300 });
    }

    filterBySearch(search) {
        this.loadData({ search, limit: 100 });
    }
}

// CSS for tooltip (injected)
const tooltipStyles = `
.graph-tooltip {
    position: absolute;
    display: none;
    background: rgba(20, 25, 50, 0.95);
    border: 1px solid rgba(100, 200, 255, 0.3);
    border-radius: 8px;
    padding: 12px 16px;
    color: #e0e0e0;
    font-size: 13px;
    z-index: 10000;
    pointer-events: none;
    max-width: 250px;
    backdrop-filter: blur(10px);
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
}

.tooltip-name {
    font-size: 15px;
    font-weight: 600;
    margin-bottom: 6px;
    color: #ffffff;
}

.tooltip-type {
    color: #60a5fa;
    margin-bottom: 4px;
}

.tooltip-location {
    color: #a78bfa;
    font-size: 12px;
    margin-bottom: 4px;
}

.tooltip-confidence {
    color: #888;
    font-size: 11px;
}

#graphContainer {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    z-index: 0;
    pointer-events: auto;
}

#graphContainer svg {
    width: 100%;
    height: 100%;
}

.node {
    cursor: pointer;
}

.node:hover circle {
    filter: url(#glow);
}

#graph-stats {
    position: fixed;
    bottom: 80px;
    left: 20px;
    background: rgba(20, 25, 50, 0.8);
    padding: 8px 16px;
    border-radius: 20px;
    color: #888;
    font-size: 12px;
    z-index: 1000;
    display: flex;
    gap: 15px;
}

#graph-stats span {
    display: flex;
    align-items: center;
    gap: 5px;
}
`;

// Inject styles
const styleEl = document.createElement('style');
styleEl.textContent = tooltipStyles;
document.head.appendChild(styleEl);

// Initialize when D3 is loaded
function initGraph() {
    const container = document.getElementById('graphContainer');
    if (!container) {
        console.log('Graph container not found, skipping graph initialization');
        return;
    }

    if (typeof d3 === 'undefined') {
        console.log('D3.js not loaded, attempting to load from CDN...');
        const script = document.createElement('script');
        script.src = 'https://d3js.org/d3.v7.min.js';
        script.onload = () => {
            console.log('D3.js loaded successfully');
            try {
                window.graphViz = new GraphVisualization('graphContainer');
            } catch (e) {
                console.error('Failed to initialize graph:', e);
                showGraphFallback(container);
            }
        };
        script.onerror = () => {
            console.warn('D3.js CDN failed - graph visualization unavailable');
            showGraphFallback(container);
        };
        document.head.appendChild(script);
    } else {
        try {
            window.graphViz = new GraphVisualization('graphContainer');
        } catch (e) {
            console.error('Failed to initialize graph:', e);
            showGraphFallback(container);
        }
    }
}

// Fallback when D3 fails to load
function showGraphFallback(container) {
    container.innerHTML = `
        <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
                    color: rgba(100, 200, 255, 0.3); text-align: center; font-size: 14px;">
            <div style="font-size: 48px; margin-bottom: 10px;">&#x2726;</div>
            <div>Graph visualization loading...</div>
            <div style="font-size: 12px; margin-top: 5px;">Search and data features still available</div>
        </div>
    `;
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { GraphVisualization, initGraph };
}
