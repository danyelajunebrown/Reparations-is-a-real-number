// Kiosk-mode Ancestor Climb Controller
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
  const confirmPrompt = document.getElementById('confirm-prompt');
  const cancelPrompt = document.getElementById('cancel-prompt');
  const resetBtn = document.getElementById('reset-btn');

  const statVisited = document.getElementById('stat-visited');
  const statMatches = document.getElementById('stat-matches');
  const statStatus = document.getElementById('stat-status');
  const matchesList = document.getElementById('matches-list');
  const toast = document.getElementById('toast');
  const idleTimerEl = document.getElementById('idle-timer');

  let pollInterval = null;
  let idleTimeout = null;
  let countdownInterval = null;
  const RESET_AFTER_MS = 90 * 1000; // 90s after last update

  function showToast(msg, kind = 'info') {
    if (!toast) return;
    toast.textContent = msg;
    toast.className = `toast ${kind} visible`;
    setTimeout(() => toast.classList.remove('visible'), 2500);
  }

  function validateFsId(id) {
    return /^[A-Z0-9]{4}-[A-Z0-9]{2,4}$/i.test((id||'').trim());
  }

  function switchScreen(target) {
    for (const el of document.querySelectorAll('.screen')) el.classList.remove('active');
    target.classList.add('active');
  }

  function openPrompt() {
    promptOverlay.classList.add('active');
    fsidInput.value = '';
    nameInput.value = '';
    setTimeout(() => fsidInput.focus(), 50);
  }

  function closePrompt() {
    promptOverlay.classList.remove('active');
  }

  function startIdleCountdown(ms) {
    const end = Date.now() + ms;
    clearInterval(countdownInterval);
    countdownInterval = setInterval(() => {
      const remain = Math.max(0, end - Date.now());
      const s = Math.ceil(remain / 1000);
      idleTimerEl.textContent = `Reset in ${s}s`;
      if (remain <= 0) {
        clearInterval(countdownInterval);
      }
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
    matchesList.innerHTML = '<div class="empty">Ready for next participant</div>';
    idleTimerEl.textContent = '';
    switchScreen(startScreen);
  }

  async function startClimb(fsId, name) {
    try {
      showToast('Starting…', 'info');
      // Use the kiosk API wrapper (visible Chromium with interactive login)
      let res = await fetch(`${API_BASE_URL}/api/kiosk/start-climb`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fsId, name })
      });
      // Fallback to existing ancestor-climb endpoint if kiosk route not present
      if (!res.ok) {
        res = await fetch(`${API_BASE_URL}/api/ancestor-climb/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fsId, name })
        });
      }
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Failed to start');

      // Move to progress screen and begin polling for sessions filtered by FS ID.
      statVisited.textContent = '0';
      statMatches.textContent = '0';
      statStatus.textContent = 'starting…';
      matchesList.innerHTML = '<div class="empty">Waiting for results… Log in to FamilySearch in the window that opened.</div>';
      switchScreen(progressScreen);

      // If sessionId was returned, poll compact kiosk status; otherwise fall back to session discovery
      if (data.sessionId) {
        pollKioskStatus(data.sessionId);
      } else {
        // Pending: session may not be inserted yet (user logging in). Discover it via ancestor-climb API, then switch to kiosk-status polling
        discoverSessionThenPoll(fsId);
      }
      scheduleAutoReset();
    } catch (e) {
      showToast(e.message, 'error');
    }
  }

  // Fallback discovery: find the newest session for this FS ID, then switch to kiosk status polling
  async function discoverSessionThenPoll(fsId) {
    clearInterval(pollInterval);
    pollInterval = setInterval(async () => {
      try {
        const r = await fetch(`${API_BASE_URL}/api/ancestor-climb/sessions?fsId=${encodeURIComponent(fsId)}`);
        const d = await r.json();
        if (!d.success) return;
        const sessions = d.sessions || [];
        if (sessions.length === 0) return;
        const latest = sessions[0];
        // Switch to compact kiosk polling once we have a session id
        clearInterval(pollInterval);
        pollKioskStatus(latest.id);
      } catch (err) {
        // Graceful fallback if FamilySearch or network is unreachable
        statStatus.textContent = 'waiting for login/network…';
      }
    }, 1500);
  }

  // Preferred polling path for the kiosk: compact status endpoint
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
        renderMatches(d.matches || []);
        scheduleAutoReset();
      } catch (err) {
        // Keep UI responsive with a helpful status
        statStatus.textContent = 'reconnecting…';
      }
    }, 2500);
  }

  function renderMatches(matches) {
    if (!matches || matches.length === 0) {
      matchesList.innerHTML = '<div class="empty">No matches yet… climbing</div>';
      return;
    }

    matchesList.innerHTML = matches.map(m => {
      const conf = m.match_confidence ? Math.round(m.match_confidence * 100) + '%' : 'N/A';
      const badge = (m.classification || 'unverified').toUpperCase();
      return `<div class="match">
          <div class="row1">
            <div class="name">${escapeHtml(m.slaveholder_name || 'Unknown')}</div>
            <div class="badge ${badge.toLowerCase()}">${escapeHtml(badge)}</div>
          </div>
          <div class="meta">Gen ${m.generation_distance || '?'} • ${conf} • ${escapeHtml(m.match_type || 'match')}</div>
          ${m.classification_reason ? `<div class="reason">${escapeHtml(m.classification_reason)}</div>` : ''}
        </div>`;
    }).join('');
  }

  async function loadSessionMatches(sessionId) {
    try {
      const r = await fetch(`${API_BASE_URL}/api/ancestor-climb/session/${encodeURIComponent(sessionId)}`);
      const d = await r.json();
      if (!d.success) return;

      renderMatches(d.matches || []);
    } catch (_) {}
  }

  function escapeHtml(t) {
    const div = document.createElement('div');
    div.textContent = t || '';
    return div.innerHTML;
  }

  // Wire events
  startBtn.addEventListener('click', openPrompt);
  cancelPrompt.addEventListener('click', closePrompt);
  confirmPrompt.addEventListener('click', () => {
    const fsId = (fsidInput.value || '').trim().toUpperCase();
    const name = (nameInput.value || '').trim();
    if (!validateFsId(fsId)) {
      showToast('Enter a valid FamilySearch ID like G21N-HD2', 'error');
      fsidInput.focus();
      return;
    }
    closePrompt();
    startClimb(fsId, name);
  });
  resetBtn.addEventListener('click', resetKiosk);
})();
