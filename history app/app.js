// Ancient Trace — app.js
// Uses Vercel API Functions as proxy (no exposed keys)

document.addEventListener('DOMContentLoaded', () => {

  // API calls go through Vercel Functions — keys hidden server-side
  const RESEARCH_API = '/api/research';
  const ORACLE_API   = '/api/oracle';

  // ── FIREBASE ────────────────────────────────────────────────────
  const auth     = firebase.auth();
  const db       = firebase.database();
  const provider = new firebase.auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  let currentUser = null;

  // ── GLOBAL STATE ─────────────────────────────────────────────────
  window.lastResult      = '';
  window.lastLocation    = '';
  window.lastSourcesData = null;
  window.lastImagesData  = [];
  let ttsSummaryText     = '';
  let leafletMap         = null;

  // ── PWA INSTALL ───────────────────────────────────────────────────
  let deferredPrompt;
  const installBtn = document.getElementById('install-btn');
  if (installBtn) {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      installBtn.style.display = 'flex';
    });
    installBtn.addEventListener('click', async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      installBtn.style.display = 'none';
    });
    window.addEventListener('appinstalled', () => {
      installBtn.style.display = 'none';
    });
  }

  // ── THEME ────────────────────────────────────────────────────────
  const themeBtn   = document.getElementById('theme-toggle');
  const savedTheme = localStorage.getItem('ancient-theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
  themeBtn.textContent = savedTheme === 'dark' ? '☀️' : '🌙';
  themeBtn.addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('ancient-theme', next);
    themeBtn.textContent = next === 'dark' ? '☀️' : '🌙';
  });

  // ── AUTH ─────────────────────────────────────────────────────────
  const loginBtn   = document.getElementById('login-btn');
  const logoutBtn  = document.getElementById('logout-btn');
  const userInfo   = document.getElementById('user-info');
  const userPhoto  = document.getElementById('user-photo');
  const userNameEl = document.getElementById('user-name');

  auth.onAuthStateChanged(user => {
    currentUser = user;
    if (user) {
      loginBtn.style.display = 'none';
      userInfo.style.display = 'flex';
      userPhoto.src          = user.photoURL || '';
      userNameEl.textContent = user.displayName?.split(' ')[0] || 'Traveller';
      loadOracleAllHistory();
    } else {
      loginBtn.style.display = 'block';
      userInfo.style.display = 'none';
    }
  });
  loginBtn.addEventListener('click',  () => auth.signInWithPopup(provider).catch(e => alert(e.message)));
  logoutBtn.addEventListener('click', () => auth.signOut());

  // ── PAST SEARCHES SIDEBAR (LEFT) ─────────────────────────────────
  const pastSidebar  = document.getElementById('past-sidebar');
  const closeSidebar = document.getElementById('close-sidebar');
  const searchesList = document.getElementById('searches-list');
  const historyBtn   = document.getElementById('history-btn');
  const resultsWrap  = document.getElementById('results-section');
  const loadingEl    = document.getElementById('loading');
  const resultsEl    = document.getElementById('results-content');
  const sourcesEl    = document.getElementById('sources-container');
  const bookmarkBar  = document.getElementById('bookmark-bar');
  const bookmarkBtn  = document.getElementById('bookmark-btn');
  const bookmarkStatus = document.getElementById('bookmark-status');

  historyBtn.addEventListener('click', () => {
    pastSidebar.classList.add('open');
    if (currentUser) loadPastSearches();
    else searchesList.innerHTML = '<p class="no-searches">Sign in to view history</p>';
  });
  closeSidebar.addEventListener('click', () => pastSidebar.classList.remove('open'));

  async function saveSearch(location, content, sourcesData, imagesData, type = 'search') {
    if (!currentUser) return;
    const id = Date.now().toString();
    await db.ref(`users/${currentUser.uid}/searches/${id}`).set({
      location, content,
      sourcesDataStr: JSON.stringify(sourcesData || null),
      imagesDataStr:  JSON.stringify(imagesData  || []),
      type,
      timestamp: firebase.database.ServerValue.TIMESTAMP
    });
  }

  async function loadPastSearches() {
    searchesList.innerHTML = '<p class="no-searches">Loading…</p>';
    const snap = await db.ref(`users/${currentUser.uid}/searches`).once('value');
    searchesList.innerHTML = '';
    if (!snap.exists()) { searchesList.innerHTML = '<p class="no-searches">No history yet</p>'; return; }
    const arr = Object.entries(snap.val())
      .map(([id, d]) => ({ id, ...d }))
      .sort((a, b) => b.timestamp - a.timestamp);
    arr.forEach(s => {
      const icon = s.type === 'bookmark' ? '🗿' : '📜';
      const d    = new Date(s.timestamp).toLocaleDateString();
      const div  = document.createElement('div');
      div.className = 'past-item';
      div.innerHTML = `
        <div class="past-item-info">
          <div class="past-location">${icon} ${s.location}</div>
          <div class="past-date">${d}</div>
        </div>
        <div class="past-actions">
          <button class="past-btn reload-btn" title="Reload">↩</button>
          <button class="past-btn del-btn" title="Delete">✕</button>
        </div>`;
      div.querySelector('.reload-btn').addEventListener('click', () => {
        const parsedSources = JSON.parse(s.sourcesDataStr || 'null');
        const parsedImages  = JSON.parse(s.imagesDataStr  || '[]');
        searchInput.value       = s.location;
        window.lastLocation     = s.location;
        window.lastResult       = s.content;
        window.lastSourcesData  = parsedSources;
        window.lastImagesData   = parsedImages;
        resultsWrap.style.display = 'block';
        bookmarkBar.style.display = 'flex';
        displayResults(s.content, parsedSources, parsedImages);
        setActiveTab('explore');
        pastSidebar.classList.remove('open');
        locBadge.style.display   = 'flex';
        locBadgeName.textContent = s.location;
        showOracleSuggestions(s.location);
        oracleLocMsgs.innerHTML = `<div class="oracle-welcome"><div class="oracle-welcome-icon">🏛️</div><p>Ask me about <strong>${s.location}</strong>.</p></div>`;
      });
      div.querySelector('.del-btn').addEventListener('click', async () => {
        await db.ref(`users/${currentUser.uid}/searches/${s.id}`).remove();
        loadPastSearches();
      });
      searchesList.appendChild(div);
    });
  }

  // ── BOOKMARK ─────────────────────────────────────────────────────
  bookmarkBtn.addEventListener('click', async () => {
    if (!currentUser) { alert('Sign in to carve into stone!'); return; }
    if (!window.lastResult) return;
    await saveSearch(window.lastLocation, window.lastResult, window.lastSourcesData, window.lastImagesData, 'bookmark');
    bookmarkBtn.textContent    = '🗿 Carved!';
    bookmarkStatus.textContent = '✦ Preserved for eternity ✦';
    bookmarkBtn.disabled       = true;
    setTimeout(() => { bookmarkBtn.textContent = '🗿 Carve Into Stone'; bookmarkStatus.textContent = ''; bookmarkBtn.disabled = false; }, 3000);
  });

  // ── VOICE / TTS ───────────────────────────────────────────────────
  const voiceSelect = document.getElementById('voice-select');
  const ttsPlay     = document.getElementById('tts-play');
  const ttsPause    = document.getElementById('tts-pause');
  const ttsStop     = document.getElementById('tts-stop');
  let voices        = [];

  function loadVoices() {
    voices = speechSynthesis.getVoices().filter(v => v.lang.startsWith('en'));
    voiceSelect.innerHTML = '<option value="">Default voice</option>';
    voices.forEach((v, i) => { const o = document.createElement('option'); o.value = i; o.textContent = v.name; voiceSelect.appendChild(o); });
  }
  loadVoices();
  speechSynthesis.onvoiceschanged = loadVoices;

  function speakText(text) {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.voice = voices[voiceSelect.value] || null; u.rate = 0.9; u.pitch = 1;
    u.onstart = () => { ttsPlay.style.display = 'none'; ttsPause.style.display = 'inline-flex'; };
    u.onend   = () => { ttsPlay.style.display = 'inline-flex'; ttsPause.style.display = 'none'; };
    speechSynthesis.speak(u);
  }

  ttsPlay.addEventListener('click', async () => {
    if (speechSynthesis.paused) { speechSynthesis.resume(); return; }
    if (ttsSummaryText) { speakText(ttsSummaryText); return; }
    if (!window.lastResult) return;
    ttsPlay.textContent = '⏳'; ttsPlay.disabled = true;
    await buildTTSSummary(window.lastResult);
    ttsPlay.textContent = '▶'; ttsPlay.disabled = false;
    speakText(ttsSummaryText);
  });
  ttsPause.addEventListener('click', () => { speechSynthesis.pause(); ttsPlay.style.display='inline-flex'; ttsPause.style.display='none'; });
  ttsStop.addEventListener('click',  () => { speechSynthesis.cancel(); ttsPlay.style.display='inline-flex'; ttsPause.style.display='none'; });

  // ── ORACLE PANEL ──────────────────────────────────────────────────
  const oraclePanel   = document.getElementById('oracle-panel');
  const closeOracle   = document.getElementById('close-oracle');
  const oracleInput   = document.getElementById('oracle-input');
  const oracleSend    = document.getElementById('oracle-send');
  const oracleLocMsgs = document.getElementById('oracle-loc-messages');
  const oracleAllMsgs = document.getElementById('oracle-all-messages');
  const oracleSugg    = document.getElementById('oracle-suggestions');
  const oracleBtn     = document.getElementById('oracle-btn');
  const clearChatBtn  = document.getElementById('oracle-clear-chat');
  const locBadge      = document.getElementById('oracle-location-badge');
  const locBadgeName  = document.getElementById('oracle-location-name');

  oracleBtn.addEventListener('click',   () => oraclePanel.classList.add('open'));
  closeOracle.addEventListener('click', () => oraclePanel.classList.remove('open'));

  document.querySelectorAll('.oracle-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.oracle-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      if (tab.dataset.otab === 'location') {
        oracleLocMsgs.style.display = 'flex'; oracleAllMsgs.style.display = 'none';
        oracleSugg.style.display = window.lastLocation ? 'flex' : 'none';
      } else {
        oracleLocMsgs.style.display = 'none'; oracleAllMsgs.style.display = 'flex';
        oracleSugg.style.display = 'none'; loadOracleAllHistory();
      }
    });
  });

  clearChatBtn.addEventListener('click', () => {
    oracleLocMsgs.innerHTML = `<div class="oracle-welcome"><div class="oracle-welcome-icon">🏛️</div><p>Chat cleared. Ask me about <strong>${window.lastLocation}</strong>.</p></div>`;
  });

  function addOracleMsg(text, role, container) {
    const div = document.createElement('div');
    div.className = `oracle-msg oracle-${role}`;
    div.innerHTML = role === 'assistant'
      ? `<span class="oracle-avatar">🔮</span><div class="oracle-bubble">${text}</div>`
      : `<div class="oracle-bubble oracle-user-bubble">${text}</div>`;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  }

  function showOracleSuggestions(location) {
    const questions = [`Who was the most powerful ruler of ${location}?`, `What caused the downfall of ${location}?`, `What was daily life like in ancient ${location}?`, `What mysteries remain unsolved in ${location}?`];
    oracleSugg.style.display = 'flex';
    oracleSugg.innerHTML = questions.map(q => `<button class="sugg-chip">${q}</button>`).join('');
    oracleSugg.querySelectorAll('.sugg-chip').forEach(btn => { btn.addEventListener('click', () => { oracleInput.value = btn.textContent; sendOracleMsg(); }); });
  }

  async function saveOracleMsg(question, answer, location) {
    if (!currentUser) return;
    await db.ref(`users/${currentUser.uid}/oracleHistory/${Date.now()}`).set({ question, answer, location, timestamp: firebase.database.ServerValue.TIMESTAMP });
  }

  async function loadOracleAllHistory() {
    if (!currentUser) { oracleAllMsgs.innerHTML = '<div class="oracle-welcome"><p>Sign in to view Oracle history.</p></div>'; return; }
    const snap = await db.ref(`users/${currentUser.uid}/oracleHistory`).once('value');
    oracleAllMsgs.innerHTML = '';
    if (!snap.exists()) { oracleAllMsgs.innerHTML = '<div class="oracle-welcome"><p>No Oracle conversations yet.</p></div>'; return; }
    Object.values(snap.val()).sort((a, b) => a.timestamp - b.timestamp).forEach(item => {
      const label = document.createElement('div');
      label.className = 'oracle-loc-label'; label.textContent = `📍 ${item.location}`;
      oracleAllMsgs.appendChild(label);
      addOracleMsg(item.question, 'user', oracleAllMsgs);
      addOracleMsg(item.answer.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>'), 'assistant', oracleAllMsgs);
    });
    oracleAllMsgs.scrollTop = oracleAllMsgs.scrollHeight;
  }

  async function sendOracleMsg() {
    const q = oracleInput.value.trim();
    if (!q || !window.lastResult) { if (!window.lastResult) addOracleMsg('Search a location first!', 'assistant', oracleLocMsgs); return; }
    oracleInput.value = ''; oracleSugg.style.display = 'none';
    addOracleMsg(q, 'user', oracleLocMsgs);
    const thinking = document.createElement('div');
    thinking.className = 'oracle-msg oracle-assistant oracle-thinking';
    thinking.innerHTML = '<span class="oracle-avatar">🔮</span><div class="oracle-bubble">Consulting the ancient scrolls…</div>';
    oracleLocMsgs.appendChild(thinking);
    oracleLocMsgs.scrollTop = oracleLocMsgs.scrollHeight;
    try {
      const res  = await fetch(ORACLE_API, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: q, systemPrompt: `You are the Ancient Trace Oracle — a wise historian with deep knowledge of ${window.lastLocation}.\nHistorical record:\n---\n${window.lastResult.substring(0, 3000)}\n---\nAnswer dramatically in under 150 words.`, maxTokens: 400 }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Oracle error');
      const ans = data.candidates?.[0]?.content?.parts?.[0]?.text || 'The scrolls are silent.';
      thinking.remove();
      addOracleMsg(ans.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>'), 'assistant', oracleLocMsgs);
      saveOracleMsg(q, ans, window.lastLocation);
    } catch(err) { thinking.remove(); addOracleMsg(`Oracle unavailable: ${err.message}`, 'assistant', oracleLocMsgs); }
  }

  oracleSend.addEventListener('click', sendOracleMsg);
  oracleInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendOracleMsg(); });

  // ── SEARCH SUGGESTIONS ───────────────────────────────────────────
  const searchInput = document.getElementById('search-input');
  const suggestBox  = document.getElementById('search-suggestions');
  let suggestTimer  = null;

  searchInput.addEventListener('input', () => {
    clearTimeout(suggestTimer);
    const q = searchInput.value.trim();
    if (q.length < 2) { suggestBox.style.display = 'none'; return; }
    suggestTimer = setTimeout(() => fetchSuggestions(q), 350);
  });

  async function fetchSuggestions(q) {
    try {
      const res  = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=5`);
      const data = await res.json();
      if (!data.length) { suggestBox.style.display = 'none'; return; }
      suggestBox.innerHTML = '';
      data.forEach(place => {
        const div = document.createElement('div'); div.className = 'suggest-item'; div.textContent = place.display_name;
        div.addEventListener('click', () => { searchInput.value = place.display_name.split(',')[0].trim(); suggestBox.style.display = 'none'; });
        suggestBox.appendChild(div);
      });
      suggestBox.style.display = 'block';
    } catch { suggestBox.style.display = 'none'; }
  }
  document.addEventListener('click', e => { if (!e.target.closest('.search-bar-wrapper')) suggestBox.style.display = 'none'; });

  // ── MAIN SEARCH ───────────────────────────────────────────────────
  const discoverBtn = document.getElementById('discover-btn');

  function doSearch() {
    const loc = searchInput.value.trim();
    if (!loc) { searchInput.focus(); return; }
    suggestBox.style.display = 'none';
    runSearch(loc);
  }
  discoverBtn.addEventListener('click', doSearch);
  searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });

  async function runSearch(location) {
    oracleLocMsgs.innerHTML = `<div class="oracle-welcome"><div class="oracle-welcome-icon">🏛️</div><p>Ask me anything about <strong>${location}</strong>.</p></div>`;
    oracleSugg.style.display = 'none'; ttsSummaryText = '';
    resultsWrap.style.display = 'block'; loadingEl.style.display = 'flex';
    resultsEl.innerHTML = ''; sourcesEl.innerHTML = ''; bookmarkBar.style.display = 'none';
    setActiveTab('explore');
    try {
      const res  = await fetch(RESEARCH_API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Research API error');
      if (!data.candidates?.[0]) throw new Error('No response from AI');
      const content = data.candidates[0].content.parts[0].text;
      window.lastResult = content; window.lastLocation = location;
      window.lastSourcesData = data; window.lastImagesData = await fetchWikipediaImages(location);
      displayResults(content, data, window.lastImagesData);
      locBadge.style.display = 'flex'; locBadgeName.textContent = location;
      showOracleSuggestions(location);
      if (currentUser) saveSearch(location, content, data, window.lastImagesData, 'search');
    } catch (err) {
      console.error(err);
      resultsEl.innerHTML = `<div class="error-msg">⚠️ ${err.message}</div>`;
    } finally { loadingEl.style.display = 'none'; }
  }

  // ── WIKIPEDIA IMAGES ──────────────────────────────────────────────
  async function fetchWikipediaImages(location) {
    try {
      const res  = await fetch(`https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(location)}&prop=images&imlimit=20&format=json&origin=*`);
      const data = await res.json();
      const page = Object.values(data.query?.pages || {})[0];
      if (!page?.images) return [];
      const valid = page.images.filter(img => { const n = img.title.toLowerCase(); return !n.includes('logo') && !n.includes('icon') && !n.includes('flag') && !n.includes('map') && (n.endsWith('.jpg') || n.endsWith('.png') || n.endsWith('.jpeg')); }).slice(0, 8);
      const results = [];
      for (const img of valid) {
        try {
          const r = await fetch(`https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(img.title)}&prop=imageinfo&iiprop=url|thumburl|extmetadata&iiurlwidth=400&format=json&origin=*`);
          const d = await r.json();
          const info = Object.values(d.query?.pages || {})[0]?.imageinfo?.[0];
          if (info?.thumburl) { const desc = info.extmetadata?.ImageDescription?.value?.replace(/<[^>]+>/g, '') || ''; results.push({ thumb: info.thumburl, url: info.url, desc: desc.substring(0, 80) }); }
        } catch { /* skip */ }
      }
      return results;
    } catch { return []; }
  }

  // ── DISPLAY RESULTS ───────────────────────────────────────────────
  function displayResults(content, data, images) {
    resultsEl.innerHTML = `<div class="result-text">${formatMdWithImages(content, images || [])}</div>`;
    bookmarkBar.style.display = 'flex';
    sourcesEl.innerHTML = '';
    const meta = data?.candidates?.[0]?.groundingMetadata;
    if (meta) {
      const chunks = meta.groundingChunks || []; const queries = meta.webSearchQueries || [];
      if (chunks.some(c => c.web?.uri)) {
        sourcesEl.innerHTML = '<h3 class="sources-heading">📚 Sources</h3>';
        chunks.forEach(c => { if (!c.web?.uri) return; const el = document.createElement('a'); el.className = 'source-card'; el.href = c.web.uri; el.target = '_blank'; el.rel = 'noopener noreferrer'; el.innerHTML = `<span class="source-icon">🔗</span><div class="source-info"><span class="source-title">${c.web.title || c.web.uri}</span><span class="source-url">${c.web.uri}</span></div>`; sourcesEl.appendChild(el); });
      } else if (queries.length) {
        sourcesEl.innerHTML = '<h3 class="sources-heading">🔍 Search Queries</h3>';
        queries.forEach(q => { const el = document.createElement('div'); el.className = 'source-card'; el.innerHTML = `<span class="source-icon">🔍</span><span>${q}</span>`; sourcesEl.appendChild(el); });
      }
    }
  }

  function formatMdWithImages(text, images) {
    const sections = text.split(/^## /gm).filter(Boolean);
    let html = ''; let imgIndex = 0;
    sections.forEach((section, i) => {
      const lines = section.split('\n'); const heading = lines[0].trim(); const body = lines.slice(1).join('\n'); const bodyHtml = formatMdBody(body);
      const img = images[imgIndex];
      if (img && i > 0) { imgIndex++; html += `<h2 class="result-heading">## ${heading}</h2><div class="content-with-image"><figure class="inline-figure"><a href="${img.url}" target="_blank" rel="noopener"><img src="${img.thumb}" alt="${img.desc || heading}" loading="lazy"/></a>${img.desc ? `<figcaption>${img.desc}</figcaption>` : ''}</figure><div class="inline-text">${bodyHtml}</div></div>`; }
      else { html += i === 0 ? bodyHtml : `<h2 class="result-heading">## ${heading}</h2>${bodyHtml}`; }
    });
    return html;
  }

  function formatMdBody(text) {
    return text.replace(/^### (.+)$/gm, '<h3 class="result-heading-sm">$1</h3>').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>').replace(/^[-*]\s+(.+)$/gm, '<li>$1</li>').replace(/(<li>[\s\S]*?<\/li>)/g, m => `<ul>${m}</ul>`).replace(/\n\n+/g, '</p><p>').replace(/^(?!<[hup\/li]|<\/[hup\/li])(.+)$/gm, '<p>$1</p>').replace(/<p><\/p>/g, '');
  }

  // ── TTS SUMMARY ───────────────────────────────────────────────────
  async function buildTTSSummary(content) {
    try {
      const res  = await fetch(ORACLE_API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: content, systemPrompt: `Write a vivid dramatic audio narration of approximately 250 words about this historical location. Write like a BBC documentary narrator. No markdown. Pure flowing prose.`, maxTokens: 400 }) });
      const data = await res.json();
      ttsSummaryText = data.candidates?.[0]?.content?.parts?.[0]?.text || content.replace(/[#*]/g,'').substring(0, 800);
    } catch { ttsSummaryText = content.replace(/[#*_`]/g, '').substring(0, 800); }
  }

  // ── NAVIGATION TABS ───────────────────────────────────────────────
  const tabLinks = document.querySelectorAll('.nav-tab');
  tabLinks.forEach(link => { link.addEventListener('click', e => { e.preventDefault(); setActiveTab(link.dataset.tab); }); });

  function setActiveTab(tab) {
    tabLinks.forEach(l => l.classList.remove('active'));
    const active = document.querySelector(`.nav-tab[data-tab="${tab}"]`);
    if (active) active.classList.add('active');
    resultsEl.style.display = 'none'; sourcesEl.style.display = 'none';
    document.getElementById('timeline-panel').style.display = 'none';
    document.getElementById('artifacts-panel').style.display = 'none';
    switch(tab) {
      case 'explore':   resultsEl.style.display = 'block'; break;
      case 'timeline':  document.getElementById('timeline-panel').style.display = 'block'; buildTimeline(); break;
      case 'artifacts': document.getElementById('artifacts-panel').style.display = 'block'; buildArtifacts(); break;
      case 'sources':   sourcesEl.style.display = 'block'; if (!sourcesEl.innerHTML.trim()) sourcesEl.innerHTML = '<p class="no-searches">Search a location first.</p>'; break;
    }
  }

  // ── TIMELINE ──────────────────────────────────────────────────────
  async function buildTimeline() {
    const panel = document.getElementById('timeline-panel');
    if (!window.lastResult) { panel.innerHTML = '<p class="no-searches">Search a location first.</p>'; return; }
    panel.innerHTML = `<h2 class="result-heading">🏛️ Historical Timeline of ${window.lastLocation}</h2><div class="loading-container"><div class="compass-spinner">🧭</div><p class="loading-text">Extracting timeline…</p></div>`;
    try {
      const res  = await fetch(ORACLE_API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: window.lastResult, systemPrompt: `Extract exactly 8 key historical events. Return ONLY a JSON array, no markdown.\nFormat: [{"year":"753 BC","event":"Description under 25 words"}]\nOrder chronologically.`, maxTokens: 600 }) });
      const data = await res.json();
      let raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
      raw = raw.replace(/```json|```/g, '').trim();
      const events = JSON.parse(raw);
      panel.innerHTML = `<h2 class="result-heading">🏛️ Historical Timeline — ${window.lastLocation}</h2><div class="timeline-wrap"><div class="timeline-line"></div>${events.map((e, i) => `<div class="timeline-event" style="animation-delay:${i * 0.08}s"><div class="timeline-dot"></div><div class="timeline-card"><div class="timeline-year">${e.year}</div><p>${e.event}</p></div></div>`).join('')}</div>`;
    } catch { panel.innerHTML = '<p class="no-searches">Could not extract timeline. Try again.</p>'; }
  }

  // ── ARTIFACTS ─────────────────────────────────────────────────────
  async function buildArtifacts() {
    const panel = document.getElementById('artifacts-panel');
    if (!window.lastLocation) { panel.innerHTML = '<p class="no-searches">Search a location first.</p>'; return; }
    panel.innerHTML = `
      <h2 class="result-heading">🏺 Artifacts — ${window.lastLocation}</h2>
      <div class="artifact-tabs">
        <button class="artifact-tab active" data-atab="maps">🗺️ Maps</button>
        <button class="artifact-tab" data-atab="paintings">🖼️ Paintings & Photos</button>
        <button class="artifact-tab" data-atab="manuscripts">📜 Manuscripts</button>
        <button class="artifact-tab" data-atab="videos">🎥 Videos</button>
        <button class="artifact-tab" data-atab="others">🏺 Others</button>
      </div>
      <div id="artifact-maps" class="artifact-section">
        <div id="leaflet-map" style="height:380px;width:100%;border-radius:8px;border:1px solid var(--border);"></div>
        <div class="map-info" id="map-info"><p>Locating <strong>${window.lastLocation}</strong>…</p></div>
        <div class="hist-maps-section"><h3 class="result-heading-sm">📜 Historical Maps</h3><div id="hist-maps-grid" class="hist-maps-grid"><p class="no-searches">Searching…</p></div></div>
      </div>
      <div id="artifact-paintings"   class="artifact-section" style="display:none;"><div id="paintings-grid"   class="artifact-grid"><p class="no-searches">Searching…</p></div></div>
      <div id="artifact-manuscripts" class="artifact-section" style="display:none;"><div id="manuscripts-grid" class="artifact-grid"><p class="no-searches">Searching…</p></div></div>
      <div id="artifact-videos" class="artifact-section" style="display:none;"><div class="artifact-grid"><a href="https://www.youtube.com/results?search_query=${encodeURIComponent(window.lastLocation + ' history documentary')}" target="_blank" rel="noopener" class="yt-search-btn">▶ Search "${window.lastLocation}" on YouTube</a></div></div>
      <div id="artifact-others" class="artifact-section" style="display:none;"><div id="others-grid" class="artifact-grid"><p class="no-searches">Searching…</p></div></div>`;
    panel.querySelectorAll('.artifact-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        panel.querySelectorAll('.artifact-tab').forEach(t => t.classList.remove('active'));
        panel.querySelectorAll('.artifact-section').forEach(s => s.style.display = 'none');
        tab.classList.add('active');
        document.getElementById(`artifact-${tab.dataset.atab}`).style.display = 'block';
      });
    });
    setTimeout(() => initLeafletMap(window.lastLocation), 150);
    fetchWikimediaArtifacts(window.lastLocation);
  }

  function initLeafletMap(location) {
    if (leafletMap) { leafletMap.remove(); leafletMap = null; }
    leafletMap = L.map('leaflet-map').setView([20, 0], 2);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 18 }).addTo(leafletMap);
    fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(location)}&format=json&limit=1`).then(r => r.json()).then(data => {
      if (data?.length) { const lat = parseFloat(data[0].lat), lon = parseFloat(data[0].lon); leafletMap.setView([lat, lon], 8); L.marker([lat, lon]).addTo(leafletMap).bindPopup(`<b>${location}</b>`).openPopup(); document.getElementById('map-info').innerHTML = `<p><strong>${location}</strong> — ${lat.toFixed(4)}, ${lon.toFixed(4)}</p>`; }
    }).catch(() => {});
    fetchHistoricalMaps(location);
  }

  async function fetchHistoricalMaps(location) {
    const grid = document.getElementById('hist-maps-grid');
    try {
      const res = await fetch(`https://commons.wikimedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(location + ' historical map')}&srnamespace=6&srlimit=8&format=json&origin=*`);
      const data = await res.json();
      grid.innerHTML = ''; let count = 0;
      for (const r of data.query?.search || []) { if (count >= 6) break; const card = await fetchWikimediaCard(r.title); if (card) { grid.appendChild(card); count++; } }
      if (!count) grid.innerHTML = '<p class="no-searches">No historical maps found.</p>';
    } catch { grid.innerHTML = '<p class="no-searches">Could not load maps.</p>'; }
  }

  async function fetchWikimediaArtifacts(location) {
    const categories = { paintings: `${location} painting portrait photograph`, manuscripts: `${location} manuscript document inscription`, others: `${location} archaeology ruin monument` };
    for (const [type, query] of Object.entries(categories)) {
      const grid = document.getElementById(`${type}-grid`);
      try {
        const res = await fetch(`https://commons.wikimedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srnamespace=6&srlimit=10&format=json&origin=*`);
        const data = await res.json();
        grid.innerHTML = ''; let count = 0;
        for (const r of data.query?.search || []) { if (count >= 6) break; if (r.title.toLowerCase().includes('map')) continue; const card = await fetchWikimediaCard(r.title); if (card) { grid.appendChild(card); count++; } }
        if (!count) grid.innerHTML = `<p class="no-searches">No ${type} found.</p>`;
      } catch { grid.innerHTML = `<p class="no-searches">Could not load ${type}.</p>`; }
    }
  }

  async function fetchWikimediaCard(title) {
    try {
      const res = await fetch(`https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}&prop=imageinfo&iiprop=url|thumburl|extmetadata&iiurlwidth=320&format=json&origin=*`);
      const data = await res.json();
      const info = Object.values(data.query?.pages || {})[0]?.imageinfo?.[0];
      if (!info?.thumburl) return null;
      const desc = info.extmetadata?.ImageDescription?.value?.replace(/<[^>]+>/g,'') || title.replace('File:','').replace(/\.[^.]+$/,'');
      const card = document.createElement('div'); card.className = 'artifact-card';
      card.innerHTML = `<a href="${info.url}" target="_blank" rel="noopener"><img src="${info.thumburl}" alt="${desc}" loading="lazy"/><div class="artifact-card-info"><p class="artifact-desc">${desc.substring(0,80)}</p></div></a>`;
      return card;
    } catch { return null; }
  }

  // ── SERVICE WORKER ────────────────────────────────────────────────
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/service-worker.js').catch(console.error);
  }

});
