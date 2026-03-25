// Kiosk-mode Ancestor Climb Controller — Tree View + Approval Workflow
(function() {
  const API_BASE_URL = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    ? 'http://localhost:3000'
    : (location.origin || '');

  // Elements
  const startScreen = document.getElementById('start-screen');
  const progressScreen = document.getElementById('progress-screen');
  const startBtn = document.getElementById('start-btn');
  const promptOverlay = document.getElementById('prompt-overlay');
  const fsidInput = document.getElementById('fsid-input');
  const nameInput = document.getElementById('name-input');
  const fatherInput = document.getElementById('father-input');
  const motherInput = document.getElementById('mother-input');
  const birthyearInput = document.getElementById('birthyear-input');
  const confirmPrompt = document.getElementById('confirm-prompt');
  const cancelPrompt = document.getElementById('cancel-prompt');
  const resetBtn = document.getElementById('reset-btn');

  const statVisited = document.getElementById('stat-visited');
  const statMatches = document.getElementById('stat-matches');
  const statStatus = document.getElementById('stat-status');
  const toast = document.getElementById('toast');
  const idleTimerEl = document.getElementById('idle-timer');

  // View elements
  const treeView = document.getElementById('tree-view');
  const cardsView = document.getElementById('cards-view');
  const treeCanvas = document.getElementById('tree-canvas');
  const treeEmpty = document.getElementById('tree-empty');
  const cardsList = document.getElementById('cards-list');
  const viewTabs = document.querySelectorAll('.view-tab');

  // Lineage overlay elements
  const lineageOverlay = document.getElementById('lineage-overlay');
  const lineageTitle = document.getElementById('lineage-title');
  const lineageChain = document.getElementById('lineage-chain');
  const lineageMeta = document.getElementById('lineage-meta');
  const lineageNotesWrap = document.getElementById('lineage-notes-wrap');
  const lineageNotesInput = document.getElementById('lineage-notes');
  const lineageActions = document.getElementById('lineage-actions');
  const approveBtn = document.getElementById('approve-btn');
  const rejectBtn = document.getElementById('reject-btn');
  const lineageClose = document.getElementById('lineage-close');

  let pollInterval = null;
  let idleTimeout = null;
  let countdownInterval = null;
  let currentMatches = [];
  let currentView = 'tree';
  let activeMatchId = null; // match currently open in lineage overlay
  const RESET_AFTER_MS = 90 * 1000;

  // ============================
  // UTILITIES
  // ============================
  function showToast(msg, kind = 'info') {
    if (!toast) return;
    toast.textContent = msg;
    toast.className = `toast ${kind} visible`;
    setTimeout(() => toast.classList.remove('visible'), 2500);
  }

  function validateFsId(id) {
    return /^[A-Z0-9]{4}-[A-Z0-9]{2,4}$/i.test((id||'').trim());
  }

  function escapeHtml(t) {
    const div = document.createElement('div');
    div.textContent = t || '';
    return div.innerHTML;
  }

  function switchScreen(target) {
    for (const el of document.querySelectorAll('.screen')) el.classList.remove('active');
    target.classList.add('active');
  }

  // ============================
  // PROMPT (unchanged logic)
  // ============================
  function openPrompt() {
    promptOverlay.classList.add('active');
    fsidInput.value = '';
    nameInput.value = '';
    fatherInput.value = '';
    motherInput.value = '';
    birthyearInput.value = '';
    setActiveInput(nameInput);
  }

  function closePrompt() {
    promptOverlay.classList.remove('active');
  }

  // ============================
  // IDLE / AUTO-RESET
  // ============================
  function startIdleCountdown(ms) {
    const end = Date.now() + ms;
    clearInterval(countdownInterval);
    countdownInterval = setInterval(() => {
      const remain = Math.max(0, end - Date.now());
      const s = Math.ceil(remain / 1000);
      idleTimerEl.textContent = `Reset in ${s}s`;
      if (remain <= 0) clearInterval(countdownInterval);
    }, 250);
  }

  function scheduleAutoReset() {
    clearTimeout(idleTimeout);
    startIdleCountdown(RESET_AFTER_MS);
    idleTimeout = setTimeout(resetKiosk, RESET_AFTER_MS);
  }

  function resetKiosk() {
    clearInterval(pollInterval);
    clearTimeout(idleTimeout);
    clearInterval(countdownInterval);
    statVisited.textContent = '0';
    statMatches.textContent = '0';
    statStatus.textContent = 'ready';
    currentMatches = [];
    treeCanvas.innerHTML = '';
    treeEmpty.style.display = '';
    cardsList.innerHTML = '<div class="empty">Ready for next participant</div>';
    idleTimerEl.textContent = '';
    closeLineageOverlay();
    switchScreen(startScreen);
  }

  // ============================
  // VIEW TABS
  // ============================
  viewTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      currentView = tab.dataset.view;
      viewTabs.forEach(t => t.classList.toggle('active', t === tab));
      treeView.classList.toggle('active', currentView === 'tree');
      cardsView.classList.toggle('active', currentView === 'cards');
      renderCurrentView();
    });
  });

  // Filter out disqualified matches from participant view
  const HIDDEN_CLASSIFICATIONS = new Set([
    'temporal_impossible', 'common_name_suspect'
  ]);
  function filterMatches(matches) {
    if (!matches) return [];
    return matches.filter(m => {
      const cls = (m.classification || '').toLowerCase();
      return !HIDDEN_CLASSIFICATIONS.has(cls);
    });
  }

  function renderCurrentView() {
    const visible = filterMatches(currentMatches);
    if (currentView === 'tree') {
      renderTreeView(visible);
    } else {
      renderCardsView(visible);
    }
  }

  // Classification label helper
  function classificationLabel(cls) {
    const labels = {
      confirmed_slaveholder: 'CONFIRMED',
      enslaved_ancestor: 'ENSLAVED',
      free_poc: 'FREE POC',
      free_poc_slaveholder: 'FREE POC OWNER',
      temporal_impossible: 'TEMPORAL',
      common_name_suspect: 'COMMON NAME',
      ambiguous_needs_review: 'NEEDS REVIEW',
      unverified: 'UNVERIFIED',
      debt: 'DEBT',
      credit: 'CREDIT',
      pending_review: 'PENDING',
      rejected: 'REJECTED'
    };
    return labels[cls] || cls.toUpperCase().replace(/_/g, ' ');
  }

  // ============================
  // 4a. BUILD LINEAGE TREE
  // ============================
  function buildLineageTree(matches, participantName) {
    // Merge all lineage_path arrays into a single tree
    // Each path goes: [participant, parent, grandparent, ..., slaveholder]
    const nodeMap = new Map(); // key: "name|gen" -> node
    let root = null;

    function getOrCreateNode(name, gen) {
      const key = name + '|' + gen;
      if (nodeMap.has(key)) return nodeMap.get(key);
      const node = {
        name: name,
        gen: gen,
        children: [],
        isSlaveholder: false,
        matchId: null,
        matchData: null,
        key: key
      };
      nodeMap.set(key, node);
      return node;
    }

    for (const m of matches) {
      const path = m.lineage_path;
      if (!path || path.length === 0) continue;

      // path[0] = participant, path[last] = slaveholder direction
      for (let i = 0; i < path.length; i++) {
        const node = getOrCreateNode(path[i], i);

        // Mark root
        if (i === 0 && !root) root = node;

        // Link parent → child
        if (i > 0) {
          const parent = getOrCreateNode(path[i - 1], i - 1);
          if (!parent.children.find(c => c.key === node.key)) {
            parent.children.push(node);
          }
        }

        // Mark slaveholder (last in path)
        if (i === path.length - 1) {
          node.isSlaveholder = true;
          node.matchId = m.id;
          node.matchData = m;
        }
      }
    }

    // If no paths had data, create a placeholder root
    if (!root && participantName) {
      root = { name: participantName, gen: 0, children: [], isSlaveholder: false, matchId: null, matchData: null, key: participantName + '|0' };
    }

    return root;
  }

  // ============================
  // 4b. LAYOUT TREE
  // ============================
  function layoutTree(root) {
    if (!root) return { nodes: [], lines: [], width: 200, height: 100 };

    const NODE_W = 130;
    const NODE_H = 50;
    const H_GAP = 20;
    const V_GAP = 60;
    const PAD = 16;

    // Assign x positions bottom-up (leaf-first)
    let leafX = 0;

    function assignX(node) {
      if (node.children.length === 0) {
        node._x = leafX;
        leafX += NODE_W + H_GAP;
        return;
      }
      for (const child of node.children) {
        assignX(child);
      }
      // Center parent over children
      const first = node.children[0]._x;
      const last = node.children[node.children.length - 1]._x;
      node._x = (first + last) / 2;
    }

    function assignY(node, depth) {
      node._y = depth * (NODE_H + V_GAP);
      for (const child of node.children) {
        assignY(child, depth + 1);
      }
    }

    assignX(root);
    assignY(root, 0);

    // Collect all nodes and lines
    const nodes = [];
    const lines = [];

    function collect(node) {
      nodes.push({
        name: node.name,
        gen: node.gen,
        x: node._x + PAD,
        y: node._y + PAD,
        w: NODE_W,
        h: NODE_H,
        isSlaveholder: node.isSlaveholder,
        isParticipant: node.gen === 0,
        matchId: node.matchId,
        matchData: node.matchData,
        key: node.key
      });

      for (const child of node.children) {
        // Vertical line from parent bottom-center to child top-center
        const px = node._x + PAD + NODE_W / 2;
        const py = node._y + PAD + NODE_H;
        const cx = child._x + PAD + NODE_W / 2;
        const cy = child._y + PAD;

        // Draw as two segments: vertical down, then horizontal, then vertical down
        const midY = py + (cy - py) / 2;
        lines.push({ x1: px, y1: py, x2: px, y2: midY });
        lines.push({ x1: px, y1: midY, x2: cx, y2: midY });
        lines.push({ x1: cx, y1: midY, x2: cx, y2: cy });

        collect(child);
      }
    }

    collect(root);

    const maxX = Math.max(...nodes.map(n => n.x + n.w)) + PAD;
    const maxY = Math.max(...nodes.map(n => n.y + n.h)) + PAD;

    return { nodes, lines, width: maxX, height: maxY };
  }

  // ============================
  // 4c. RENDER TREE VIEW
  // ============================
  function renderTreeView(matches) {
    if (!matches || matches.length === 0) {
      treeCanvas.innerHTML = '';
      treeEmpty.style.display = '';
      return;
    }
    treeEmpty.style.display = 'none';

    const participantName = matches[0] && matches[0].lineage_path && matches[0].lineage_path[0]
      ? matches[0].lineage_path[0] : 'Participant';
    const root = buildLineageTree(matches, participantName);
    const layout = layoutTree(root);

    treeCanvas.style.width = layout.width + 'px';
    treeCanvas.style.height = layout.height + 'px';

    let html = '';

    // Lines
    for (const ln of layout.lines) {
      if (ln.x1 === ln.x2) {
        // Vertical
        const top = Math.min(ln.y1, ln.y2);
        const h = Math.abs(ln.y2 - ln.y1);
        html += `<div class="tree-line" style="left:${ln.x1 - 1}px;top:${top}px;width:2px;height:${h}px;"></div>`;
      } else {
        // Horizontal
        const left = Math.min(ln.x1, ln.x2);
        const w = Math.abs(ln.x2 - ln.x1);
        html += `<div class="tree-line" style="left:${left}px;top:${ln.y1 - 1}px;width:${w}px;height:2px;"></div>`;
      }
    }

    // Nodes
    for (const n of layout.nodes) {
      const cls = ['tree-node'];
      if (n.isParticipant) cls.push('participant');
      if (n.isSlaveholder) cls.push('slaveholder');
      if (!n.isParticipant && !n.isSlaveholder) cls.push('on-path');
      const matchCls = n.matchData ? (n.matchData.classification || 'unverified').toLowerCase() : '';
      if (n.matchData && ['pending_review', 'rejected', 'temporal_impossible', 'common_name_suspect'].includes(matchCls)) {
        cls.push('reviewed');
      }

      const nodeBadge = n.isSlaveholder && matchCls ? `<div class="tn-badge badge ${matchCls}">${escapeHtml(classificationLabel(matchCls))}</div>` : '';

      html += `<div class="${cls.join(' ')}" style="left:${n.x}px;top:${n.y}px;width:${n.w}px;min-height:${n.h}px;"
                    data-match-id="${n.matchId || ''}" data-key="${escapeHtml(n.key)}">
        <div class="tn-name">${escapeHtml(n.name)}</div>
        <div class="tn-gen">${n.isParticipant ? 'You' : n.isSlaveholder ? 'Match' : 'Gen ' + n.gen}</div>
        ${nodeBadge}
      </div>`;
    }

    treeCanvas.innerHTML = html;

    // Tap handlers on slaveholder nodes
    treeCanvas.querySelectorAll('.tree-node.slaveholder').forEach(el => {
      el.addEventListener('click', () => {
        const mid = el.dataset.matchId;
        const match = currentMatches.find(m => String(m.id) === mid);
        if (match) renderLineageDetail(match);
      });
    });
  }

  // ============================
  // 4d. RENDER CARDS VIEW
  // ============================
  function renderCardsView(matches) {
    if (!matches || matches.length === 0) {
      cardsList.innerHTML = '<div class="empty">No matches yet… climbing</div>';
      return;
    }

    cardsList.innerHTML = matches.map(m => {
      const conf = m.match_confidence ? Math.round(m.match_confidence * 100) + '%' : 'N/A';
      const cls = (m.classification || 'unverified').toLowerCase();
      const badge = classificationLabel(cls);
      return `<div class="match-card" data-match-id="${m.id}">
        <div class="mc-name">${escapeHtml(m.slaveholder_name || 'Unknown')}</div>
        <div class="mc-gen">Generation ${m.generation_distance || '?'}</div>
        <div class="mc-detail">
          <span class="badge ${cls}">${escapeHtml(badge)}</span>
          <span class="mc-conf">${conf} &bull; ${escapeHtml(m.match_type || 'match')}</span>
        </div>
      </div>`;
    }).join('');

    cardsList.querySelectorAll('.match-card').forEach(el => {
      el.addEventListener('click', () => {
        const mid = el.dataset.matchId;
        const match = currentMatches.find(m => String(m.id) === mid);
        if (match) renderLineageDetail(match);
      });
    });
  }

  // ============================
  // 4e. LINEAGE DETAIL OVERLAY
  // ============================
  function renderLineageDetail(match) {
    activeMatchId = match.id;
    const path = match.lineage_path || [];

    lineageTitle.textContent = escapeHtml(match.slaveholder_name || 'Match Detail');

    // Build vertical chain
    let chainHtml = '';
    for (let i = 0; i < path.length; i++) {
      const isFirst = i === 0;
      const isLast = i === path.length - 1;
      const cls = isFirst ? 'lc-participant' : isLast ? 'lc-slaveholder' : '';
      const label = isFirst ? 'Participant' : isLast ? 'Slaveholder Match' : 'Gen ' + i;

      chainHtml += `<div class="lc-person ${cls}">
        <div class="lc-name">${escapeHtml(path[i])}</div>
        <div class="lc-gen">${label}</div>
      </div>`;
      if (!isLast) {
        chainHtml += '<div class="lc-connector">&#x25BC;</div>';
      }
    }
    if (path.length === 0) {
      chainHtml = '<div class="empty">No lineage path available</div>';
    }
    lineageChain.innerHTML = chainHtml;

    // Meta
    const conf = match.match_confidence ? Math.round(match.match_confidence * 100) + '%' : 'N/A';
    lineageMeta.innerHTML = `${escapeHtml(match.match_type || 'match')} &bull; ${conf} confidence &bull; Gen ${match.generation_distance || '?'}`;

    // Show/hide actions based on review status
    const cls = (match.classification || 'unverified').toLowerCase();
    const autoResolved = ['temporal_impossible', 'common_name_suspect', 'enslaved_ancestor', 'confirmed_slaveholder', 'free_poc', 'pending_review', 'rejected'];
    const alreadyReviewed = autoResolved.includes(cls);
    lineageActions.style.display = alreadyReviewed ? 'none' : '';
    lineageNotesWrap.style.display = alreadyReviewed ? 'none' : '';
    lineageNotesInput.value = '';

    const label = classificationLabel(cls);
    lineageMeta.innerHTML += ` &bull; <span class="badge ${cls}">${escapeHtml(label)}</span>`;
    if (match.confidence_adjusted != null) {
      lineageMeta.innerHTML += ` &bull; Adj: ${Math.round(match.confidence_adjusted * 100)}%`;
    }
    if (match.review_reason) {
      lineageMeta.innerHTML += `<br><small>${escapeHtml(match.review_reason)}</small>`;
    }

    lineageOverlay.classList.add('active');
  }

  function closeLineageOverlay() {
    lineageOverlay.classList.remove('active');
    activeMatchId = null;
  }

  lineageClose.addEventListener('click', closeLineageOverlay);
  lineageOverlay.addEventListener('click', (e) => {
    if (e.target === lineageOverlay) closeLineageOverlay();
  });

  // Review keyboard
  document.querySelectorAll('#review-keyboard .vkb-key').forEach(key => {
    key.addEventListener('click', (e) => {
      e.preventDefault();
      const val = key.dataset.rkey;
      if (val === 'BACKSPACE') {
        lineageNotesInput.value = lineageNotesInput.value.slice(0, -1);
      } else {
        lineageNotesInput.value += val;
      }
    });
  });

  // ============================
  // 4f. REVIEW MATCH
  // ============================
  async function reviewMatch(matchId, decision) {
    const notes = lineageNotesInput.value.trim();
    try {
      const r = await fetch(`${API_BASE_URL}/api/kiosk/match/${encodeURIComponent(matchId)}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, notes: notes || undefined })
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error || 'Review failed');

      // Update local match data
      const idx = currentMatches.findIndex(m => String(m.id) === String(matchId));
      if (idx >= 0) {
        currentMatches[idx].classification = d.match.classification;
        currentMatches[idx].classification_reason = d.match.classification_reason;
      }

      closeLineageOverlay();
      renderCurrentView();
      showToast(decision === 'approve' ? 'Approved — sent to review' : 'Rejected', 'info');
    } catch (e) {
      showToast(e.message, 'error');
    }
  }

  approveBtn.addEventListener('click', () => {
    if (activeMatchId) reviewMatch(activeMatchId, 'approve');
  });
  rejectBtn.addEventListener('click', () => {
    if (activeMatchId) reviewMatch(activeMatchId, 'reject');
  });

  // ============================
  // CLIMB START + POLLING (same logic as before)
  // ============================
  async function startClimb(fsId, name, participantInfo) {
    try {
      showToast('Starting…', 'info');
      const payload = { fsId: fsId || null, name: name || null, ...participantInfo };

      let res = await fetch(`${API_BASE_URL}/api/kiosk/start-climb`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        res = await fetch(`${API_BASE_URL}/api/ancestor-climb/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      }
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Failed to start');

      statVisited.textContent = '0';
      statMatches.textContent = '0';
      statStatus.textContent = 'starting…';
      currentMatches = [];
      treeCanvas.innerHTML = '';
      treeEmpty.style.display = '';
      cardsList.innerHTML = '<div class="empty">Searching…</div>';
      switchScreen(progressScreen);

      if (data.sessionId) {
        pollKioskStatus(data.sessionId);
      } else if (fsId) {
        discoverSessionThenPoll(fsId);
      } else if (data.lookupName) {
        discoverSessionByName(data.lookupName);
      }
      scheduleAutoReset();
    } catch (e) {
      showToast(e.message, 'error');
    }
  }

  async function discoverSessionByName(name) {
    clearInterval(pollInterval);
    pollInterval = setInterval(async () => {
      try {
        const r = await fetch(`${API_BASE_URL}/api/ancestor-climb/sessions?name=${encodeURIComponent(name)}`);
        const d = await r.json();
        if (!d.success) return;
        const sessions = d.sessions || [];
        if (sessions.length === 0) return;
        clearInterval(pollInterval);
        pollKioskStatus(sessions[0].id);
      } catch (err) {
        statStatus.textContent = 'searching records…';
      }
    }, 1500);
  }

  async function discoverSessionThenPoll(fsId) {
    clearInterval(pollInterval);
    pollInterval = setInterval(async () => {
      try {
        const r = await fetch(`${API_BASE_URL}/api/ancestor-climb/sessions?fsId=${encodeURIComponent(fsId)}`);
        const d = await r.json();
        if (!d.success) return;
        const sessions = d.sessions || [];
        if (sessions.length === 0) return;
        clearInterval(pollInterval);
        pollKioskStatus(sessions[0].id);
      } catch (err) {
        statStatus.textContent = 'waiting for login/network…';
      }
    }, 1500);
  }

  // 4g. Modified polling — stores currentMatches, renders active view
  function pollKioskStatus(sessionId) {
    clearInterval(pollInterval);
    pollInterval = setInterval(async () => {
      try {
        const r = await fetch(`${API_BASE_URL}/api/kiosk/climb-status/${encodeURIComponent(sessionId)}`);
        const d = await r.json();
        if (!d.success) return;
        const s = d.session || {};
        statVisited.textContent = s.ancestors_visited || 0;
        statMatches.textContent = s.matches_found || 0;
        statStatus.textContent = s.status || 'in_progress';

        const prevCount = currentMatches.length;
        currentMatches = d.matches || [];
        renderCurrentView();

        // Flash on new match
        if (currentMatches.length > prevCount) {
          showToast(`New match found! (${currentMatches.length} total)`, 'info');
        }

        if (s.status === 'failed') {
          statStatus.textContent = 'Error — person not found or climb failed';
          showToast('Climb failed. Check the FamilySearch ID and try again.', 'error');
          clearInterval(pollInterval);
          scheduleAutoReset();
          return;
        }
        if (s.status === 'completed') {
          clearInterval(pollInterval);
          scheduleAutoReset();
          return;
        }
        scheduleAutoReset();
      } catch (err) {
        statStatus.textContent = 'reconnecting…';
      }
    }, 2500);
  }

  // ============================
  // VIRTUAL KEYBOARD (prompt dialog)
  // ============================
  let activeInput = fsidInput;
  const allInputs = [fsidInput, nameInput, fatherInput, motherInput, birthyearInput];

  function setActiveInput(input) {
    activeInput = input;
    allInputs.forEach(el => el.classList.toggle('vkb-active', el === input));
  }

  allInputs.forEach(el => {
    el.addEventListener('click', () => setActiveInput(el));
    el.addEventListener('touchstart', (e) => { e.preventDefault(); setActiveInput(el); });
  });

  document.querySelectorAll('#virtual-keyboard .vkb-key').forEach(key => {
    key.addEventListener('click', (e) => {
      e.preventDefault();
      const val = key.dataset.key;
      if (!activeInput) return;
      if (val === 'BACKSPACE') {
        activeInput.value = activeInput.value.slice(0, -1);
      } else {
        activeInput.value += val;
      }
    });
  });

  // ============================
  // WIRE EVENTS
  // ============================
  startBtn.addEventListener('click', openPrompt);
  cancelPrompt.addEventListener('click', closePrompt);
  confirmPrompt.addEventListener('click', () => {
    const fsId = (fsidInput.value || '').trim().toUpperCase();
    const name = (nameInput.value || '').trim();
    const fatherName = (fatherInput.value || '').trim();
    const motherName = (motherInput.value || '').trim();
    const birthYear = (birthyearInput.value || '').trim();

    const hasFsId = validateFsId(fsId);
    const hasName = name.length >= 3;
    const hasParents = fatherName.length >= 3 || motherName.length >= 3;

    if (!hasFsId && !hasName) {
      showToast('Enter a FamilySearch ID or your full name', 'error');
      return;
    }
    if (!hasFsId && hasName && !hasParents) {
      showToast('Without a FamilySearch ID, please provide at least one parent name', 'error');
      return;
    }

    const participantInfo = {};
    if (fatherName) participantInfo.fatherName = fatherName;
    if (motherName) participantInfo.motherName = motherName;
    if (birthYear && /^\d{4}$/.test(birthYear)) participantInfo.birthYear = parseInt(birthYear);

    closePrompt();
    startClimb(hasFsId ? fsId : null, name, participantInfo);
  });
  resetBtn.addEventListener('click', resetKiosk);

  // ============================
  // ACTIVE CLIMBS on start screen
  // ============================
  const activeClimbsContainer = document.getElementById('active-climbs');
  const activeClimbsList = document.getElementById('active-climbs-list');

  async function loadActiveClimbs() {
    try {
      const r = await fetch(`${API_BASE_URL}/api/ancestor-climb/sessions?limit=10`);
      const d = await r.json();
      if (!d.success || !d.sessions || d.sessions.length === 0) {
        activeClimbsContainer.style.display = 'none';
        return;
      }

      const climbs = d.sessions.filter(s =>
        s.status === 'in_progress' || s.status === 'completed' || s.status === 'failed'
      ).slice(0, 5);

      if (climbs.length === 0) {
        activeClimbsContainer.style.display = 'none';
        return;
      }

      activeClimbsList.innerHTML = climbs.map(s => {
        const statusClass = s.status === 'completed' ? 'completed' : s.status === 'failed' ? 'failed' : '';
        const statusLabel = s.status === 'in_progress' ? 'climbing' : s.status;
        const visited = s.ancestors_visited || 0;
        const matches = s.matches_found || 0;
        return `<div class="climb-card" data-session-id="${escapeHtml(s.id)}" data-fs-id="${escapeHtml(s.modern_person_fs_id || '')}">
          <div>
            <div class="cc-name">${escapeHtml(s.modern_person_name || s.modern_person_fs_id || 'Unknown')}</div>
            <div class="cc-meta">${visited} ancestors &bull; ${matches} matches &bull; <span class="cc-status ${statusClass}">${statusLabel}</span></div>
          </div>
          <div class="cc-stats">
            <div class="cc-count">${matches}</div>
            <div class="cc-label">matches</div>
          </div>
        </div>`;
      }).join('');

      activeClimbsContainer.style.display = '';

      activeClimbsList.querySelectorAll('.climb-card').forEach(card => {
        card.addEventListener('click', () => {
          const sid = card.dataset.sessionId;
          if (!sid) return;
          statVisited.textContent = '0';
          statMatches.textContent = '0';
          statStatus.textContent = 'loading…';
          currentMatches = [];
          treeCanvas.innerHTML = '';
          treeEmpty.style.display = '';
          cardsList.innerHTML = '<div class="empty">Loading climb data…</div>';
          switchScreen(progressScreen);
          pollKioskStatus(sid);
        });
      });
    } catch (e) {
      activeClimbsContainer.style.display = 'none';
    }
  }

  loadActiveClimbs();
  setInterval(() => {
    if (startScreen.classList.contains('active')) loadActiveClimbs();
  }, 15000);
})();
