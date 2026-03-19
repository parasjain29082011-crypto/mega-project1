// Ancient Trace — app.js (Complete with all fixes)

document.addEventListener('DOMContentLoaded', () => {

  // Key 1 — Main history search (gemini-2.0-flash, 1500/day)
  const GEMINI_KEY      = 'AIzaSyBm-tyXxt7GnC9UVDvJ8-p398VZlUi2iYI';
  const GEMINI_URL      = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`;

  // Key 2 — Oracle + Timeline + TTS (gemini-1.5-flash, separate 1500/day quota)
  const GEMINI_FAST_KEY = 'AIzaSyBMm9xKuDq-FH_-z2wtHZWFEmhlubUK43c';
  const GEMINI_FAST_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_FAST_KEY}`;

  // ── FIREBASE ──────────────────────────────────────────────────────
  const auth     = firebase.auth();
  const db       = firebase.database();
  const provider = new firebase.auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  let currentUser = null;

  // ── GLOBAL STATE ──────────────────────────────────────────────────
  window.lastResult      = '';
  window.lastLocation    = '';
  window.lastSourcesData = null;
  window.lastImagesData  = [];
  let ttsSummaryText     = '';

  // ── THEME ─────────────────────────────────────────────────────────
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

  // ── AUTH ──────────────────────────────────────────────────────────
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

  // ── PAST SEARCHES SIDEBAR (LEFT) ──────────────────────────────────
  const pastSidebar  = document.getElementById('past-sidebar');
  const closeSidebar = document.getElementById('close-sidebar');
  const searchesList = document.getElementById('searches-list');
  const historyBtn   = document.getElementById('history-btn');

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
      location,
      content,
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
    if (!snap.exists()) {
      searchesList.innerHTML = '<p class="no-searches">No history yet</p>';
      return;
    }
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
        searchInput.value        = s.location;
        window.lastLocation      = s.location;
        window.lastResult        = s.content;
        window.lastSourcesData   = parsedSources;
        window.lastImagesData    = parsedImages;
        resultsWrap.style.display = 'block';
        bookmarkBar.style.display = 'flex';
        displayResults(s.content, parsedSources, parsedImages);
        setActiveTab('explore');
        pastSidebar.classList.remove('open');
        // Update oracle badge
        document.getElementById('oracle-location-badge').style.display = 'flex';
        document.getElementById('oracle-location-name').textContent = s.location;
        showOracleSuggestions(s.location);
      });

      div.querySelector('.del-btn').addEventListener('click', async () => {
        await db.ref(`users/${currentUser.uid}/searches/${s.id}`).remove();
        loadPastSearches();
      });

      searchesList.appendChild(div);
    });
  }

  // ── BOOKMARK / STONE CARVING ──────────────────────────────────────
  const bookmarkBar    = document.getElementById('bookmark-bar');
  const bookmarkBtn    = document.getElementById('bookmark-btn');
  const bookmarkStatus = document.getElementById('bookmark-status');

  bookmarkBtn.addEventListener('click', async () => {
    if (!currentUser) { alert('Sign in to carve into stone!'); return; }
    if (!window.lastResult) return;
    await saveSearch(window.lastLocation, window.lastResult, window.lastSourcesData, window.lastImagesData, 'bookmark');
    bookmarkBtn.textContent    = '🗿 Carved!';
    bookmarkStatus.textContent = '✦ Preserved for eternity ✦';
    bookmarkBtn.disabled       = true;
    setTimeout(() => {
      bookmarkBtn.textContent    = '🗿 Carve Into Stone';
      bookmarkStatus.textContent = '';
      bookmarkBtn.disabled       = false;
    }, 3000);
  });

  // ── VOICE / TTS ───────────────────────────────────────────────────
  const voiceSelect = document.getElementById('voice-select');
  const ttsPlay     = document.getElementById('tts-play');
  const ttsPause    = document.getElementById('tts-pause');
  const ttsStop     = document.getElementById('tts-stop');
  let   voices      = [];

  function loadVoices() {
    voices = speechSynthesis.getVoices().filter(v => v.lang.startsWith('en'));
    voiceSelect.innerHTML = '<option value="">Default voice</option>';
    voices.forEach((v, i) => {
      const o = document.createElement('option');
      o.value       = i;
      o.textContent = `${v.name}`;
      voiceSelect.appendChild(o);
    });
  }
  loadVoices();
  speechSynthesis.onvoiceschanged = loadVoices;

  function speakText(text) {
    speechSynthesis.cancel();
    const u   = new SpeechSynthesisUtterance(text);
    u.voice   = voices[voiceSelect.value] || null;
    u.rate    = 0.9; u.pitch = 1;
    u.onstart = () => { ttsPlay.style.display = 'none'; ttsPause.style.display = 'inline-flex'; };
    u.onend   = () => { ttsPlay.style.display = 'inline-flex'; ttsPause.style.display = 'none'; };
    u.onerror = () => { ttsPlay.style.display = 'inline-flex'; ttsPause.style.display = 'none'; };
    speechSynthesis.speak(u);
  }

  ttsPlay.addEventListener('click', async () => {
    if (speechSynthesis.paused) { speechSynthesis.resume(); return; }
    if (ttsSummaryText) { speakText(ttsSummaryText); return; }
    if (!window.lastResult) return;
    // Generate summary on demand (lazy)
    ttsPlay.textContent = '⏳';
    ttsPlay.disabled = true;
    await buildTTSSummary(window.lastResult);
    ttsPlay.textContent = '▶';
    ttsPlay.disabled = false;
    speakText(ttsSummaryText);
  });
  ttsPause.addEventListener('click', () => { speechSynthesis.pause(); ttsPlay.style.display='inline-flex'; ttsPause.style.display='none'; });
  ttsStop.addEventListener('click',  () => { speechSynthesis.cancel(); ttsPlay.style.display='inline-flex'; ttsPause.style.display='none'; });

  // ── ORACLE PANEL ──────────────────────────────────────────────────
  const oraclePanel    = document.getElementById('oracle-panel');
  const closeOracle    = document.getElementById('close-oracle');
  const oracleInput    = document.getElementById('oracle-input');
  const oracleSend     = document.getElementById('oracle-send');
  const oracleLocMsgs  = document.getElementById('oracle-loc-messages');
  const oracleAllMsgs  = document.getElementById('oracle-all-messages');
  const oracleSugg     = document.getElementById('oracle-suggestions');
  const oracleBtn      = document.getElementById('oracle-btn');
  const clearChatBtn   = document.getElementById('oracle-clear-chat');
  const locBadge       = document.getElementById('oracle-location-badge');
  const locBadgeName   = document.getElementById('oracle-location-name');
  let   activeOracleTab = 'location';

  oracleBtn.addEventListener('click',   () => oraclePanel.classList.add('open'));
  closeOracle.addEventListener('click', () => oraclePanel.classList.remove('open'));

  // Oracle tabs
  document.querySelectorAll('.oracle-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.oracle-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activeOracleTab = tab.dataset.otab;
      if (activeOracleTab === 'location') {
        oracleLocMsgs.style.display = 'flex';
        oracleAllMsgs.style.display = 'none';
        oracleSugg.style.display    = window.lastLocation ? 'flex' : 'none';
      } else {
        oracleLocMsgs.style.display = 'none';
        oracleAllMsgs.style.display = 'flex';
        oracleSugg.style.display    = 'none';
        loadOracleAllHistory();
      }
    });
  });

  // Clear location chat
  clearChatBtn.addEventListener('click', () => {
    oracleLocMsgs.innerHTML = `<div class="oracle-welcome">
      <div class="oracle-welcome-icon">🏛️</div>
      <p>Chat cleared. Ask me about <strong>${window.lastLocation}</strong>.</p>
    </div>`;
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
    const questions = [
      `Who was the most powerful ruler of ${location}?`,
      `What caused the downfall of ${location}?`,
      `What was daily life like in ancient ${location}?`,
      `What mysteries remain unsolved in ${location}?`
    ];
    oracleSugg.style.display = 'flex';
    oracleSugg.innerHTML = questions.map(q =>
      `<button class="sugg-chip">${q}</button>`
    ).join('');
    oracleSugg.querySelectorAll('.sugg-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        oracleInput.value = btn.textContent;
        sendOracleMsg();
      });
    });
  }

  async function saveOracleMsg(question, answer, location) {
    if (!currentUser) return;
    const id = Date.now().toString();
    await db.ref(`users/${currentUser.uid}/oracleHistory/${id}`).set({
      question, answer, location,
      timestamp: firebase.database.ServerValue.TIMESTAMP
    });
  }

  async function loadOracleAllHistory() {
    if (!currentUser) {
      oracleAllMsgs.innerHTML = '<div class="oracle-welcome"><p>Sign in to view full Oracle history.</p></div>';
      return;
    }
    const snap = await db.ref(`users/${currentUser.uid}/oracleHistory`).once('value');
    oracleAllMsgs.innerHTML = '';
    if (!snap.exists()) {
      oracleAllMsgs.innerHTML = '<div class="oracle-welcome"><p>No Oracle conversations yet.</p></div>';
      return;
    }
    const arr = Object.values(snap.val()).sort((a, b) => a.timestamp - b.timestamp);
    arr.forEach(item => {
      const locLabel = document.createElement('div');
      locLabel.className = 'oracle-loc-label';
      locLabel.textContent = `📍 ${item.location}`;
      oracleAllMsgs.appendChild(locLabel);
      addOracleMsg(item.question, 'user', oracleAllMsgs);
      addOracleMsg(item.answer.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>'), 'assistant', oracleAllMsgs);
    });
    oracleAllMsgs.scrollTop = oracleAllMsgs.scrollHeight;
  }

  async function sendOracleMsg() {
    const q = oracleInput.value.trim();
    if (!q) return;
    if (!window.lastResult) {
      addOracleMsg('Search a location first, then ask me about it.', 'assistant', oracleLocMsgs);
      return;
    }
    oracleInput.value = '';
    oracleSugg.style.display = 'none';

    addOracleMsg(q, 'user', oracleLocMsgs);

    const thinking = document.createElement('div');
    thinking.className = 'oracle-msg oracle-assistant oracle-thinking';
    thinking.innerHTML = '<span class="oracle-avatar">🔮</span><div class="oracle-bubble">Consulting the ancient scrolls…</div>';
    oracleLocMsgs.appendChild(thinking);
    oracleLocMsgs.scrollTop = oracleLocMsgs.scrollHeight;

    try {
      const res  = await fetch(GEMINI_FAST_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: q }] }],
          systemInstruction: { parts: [{ text:
            `You are the Ancient Trace Oracle — a wise, dramatic historian with deep knowledge of ${window.lastLocation}.
Here is the historical record:
---
${window.lastResult.substring(0, 3000)}
---
Answer concisely and dramatically in under 150 words. Be fascinating.` }] },
          generationConfig: { temperature: 0.8, maxOutputTokens: 400 }
        })
      });
      const data = await res.json();
      const ans  = data.candidates?.[0]?.content?.parts?.[0]?.text || 'The scrolls are silent on this matter.';
      thinking.remove();
      const formatted = ans.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      addOracleMsg(formatted, 'assistant', oracleLocMsgs);
      saveOracleMsg(q, ans, window.lastLocation);
    } catch {
      thinking.remove();
      addOracleMsg('The Oracle cannot be reached right now. Try again.', 'assistant', oracleLocMsgs);
    }
  }

  oracleSend.addEventListener('click', sendOracleMsg);
  oracleInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendOracleMsg(); });

  // ── SEARCH SUGGESTIONS ───────────────────────────────────────────
  const searchInput  = document.getElementById('search-input');
  const suggestBox   = document.getElementById('search-suggestions');
  let   suggestTimer = null;

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
        const div = document.createElement('div');
        div.className   = 'suggest-item';
        div.textContent = place.display_name;
        div.addEventListener('click', () => {
          searchInput.value        = place.display_name.split(',')[0].trim();
          suggestBox.style.display = 'none';
        });
        suggestBox.appendChild(div);
      });
      suggestBox.style.display = 'block';
    } catch { suggestBox.style.display = 'none'; }
  }
  document.addEventListener('click', e => { if (!e.target.closest('.search-bar-wrapper')) suggestBox.style.display = 'none'; });

  // ── MAIN SEARCH ───────────────────────────────────────────────────
  const discoverBtn = document.getElementById('discover-btn');
  const resultsWrap = document.getElementById('results-section');
  const loadingEl   = document.getElementById('loading');
  const resultsEl   = document.getElementById('results-content');
  const sourcesEl   = document.getElementById('sources-container');

  function doSearch() {
    const loc = searchInput.value.trim();
    if (!loc) { searchInput.focus(); return; }
    suggestBox.style.display = 'none';
    runSearch(loc);
  }
  discoverBtn.addEventListener('click', doSearch);
  searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });

  async function runSearch(location) {
    // Reset oracle location chat for new location
    oracleLocMsgs.innerHTML = `<div class="oracle-welcome">
      <div class="oracle-welcome-icon">🏛️</div>
      <p>Ask me anything about <strong>${location}</strong>.</p>
    </div>`;
    oracleSugg.style.display = 'none';

    resultsWrap.style.display = 'block';
    loadingEl.style.display   = 'flex';
    resultsEl.innerHTML       = '';
    sourcesEl.innerHTML       = '';
    bookmarkBar.style.display = 'none';
    setActiveTab('explore');

    try {
      const res = await fetch(GEMINI_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `Tell me the complete history of: ${location}` }] }],
          systemInstruction: { parts: [{ text:
            `You are Ancient Trace — an expert historian. Generate a rich Wikipedia-style historical report in markdown with EXACTLY these section headings (## prefix):
## 🏛️ Historical Overview
## 👥 Notable Figures
## ⚔️ Major Events & Battles
## 🎨 Culture & Architecture
## 💰 Economic History
## 🔮 Legacy & Modern Significance
Be detailed, fascinating and accurate. Use markdown bold for key terms.` }] },
          tools: [{ googleSearch: {} }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 4096 }
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'API error');
      if (!data.candidates?.[0]) throw new Error('No response');

      const content = data.candidates[0].content.parts[0].text;
      window.lastResult    = content;
      window.lastLocation  = location;
      window.lastSourcesData = data;

      // Fetch Wikipedia images
      window.lastImagesData = await fetchWikipediaImages(location);

      displayResults(content, data, window.lastImagesData);
      ttsSummaryText = ''; // reset — will be generated on demand

      // Update oracle
      locBadge.style.display   = 'flex';
      locBadgeName.textContent = location;
      showOracleSuggestions(location);

      if (currentUser) saveSearch(location, content, data, window.lastImagesData, 'search');

    } catch (err) {
      console.error(err);
      resultsEl.innerHTML = `<div class="error-msg">⚠️ ${err.message || 'Unable to connect. Please try again.'}</div>`;
    } finally {
      loadingEl.style.display = 'none';
    }
  }

  // ── FETCH WIKIPEDIA IMAGES ────────────────────────────────────────
  async function fetchWikipediaImages(location) {
    try {
      const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(location)}&prop=images&imlimit=20&format=json&origin=*`;
      const res       = await fetch(searchUrl);
      const data      = await res.json();
      const pages     = data.query?.pages || {};
      const page      = Object.values(pages)[0];
      if (!page?.images) return [];

      const validImages = page.images.filter(img => {
        const n = img.title.toLowerCase();
        return !n.includes('logo') && !n.includes('icon') && !n.includes('flag') &&
               !n.includes('map') && (n.endsWith('.jpg') || n.endsWith('.png') || n.endsWith('.jpeg'));
      }).slice(0, 8);

      const imageData = [];
      for (const img of validImages) {
        try {
          const infoUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(img.title)}&prop=imageinfo&iiprop=url|thumburl|extmetadata&iiurlwidth=400&format=json&origin=*`;
          const infoRes = await fetch(infoUrl);
          const info    = await infoRes.json();
          const p       = Object.values(info.query?.pages || {})[0];
          const imgInfo = p?.imageinfo?.[0];
          if (imgInfo?.thumburl) {
            const desc = imgInfo.extmetadata?.ImageDescription?.value?.replace(/<[^>]+>/g, '') || '';
            imageData.push({ thumb: imgInfo.thumburl, url: imgInfo.url, desc: desc.substring(0, 80) });
          }
        } catch { /* skip */ }
      }
      return imageData;
    } catch { return []; }
  }

  // ── DISPLAY RESULTS WITH IMAGES ───────────────────────────────────
  function displayResults(content, data, images) {
    const formatted = formatMdWithImages(content, images || []);
    resultsEl.innerHTML = `<div class="result-text">${formatted}</div>`;
    bookmarkBar.style.display = 'flex';

    // Build sources
    sourcesEl.innerHTML = '';
    const meta = data?.candidates?.[0]?.groundingMetadata;
    if (meta) {
      const chunks   = meta.groundingChunks || [];
      const queries  = meta.webSearchQueries || [];
      const hasLinks = chunks.some(c => c.web?.uri);
      if (hasLinks) {
        sourcesEl.innerHTML = '<h3 class="sources-heading">📚 Sources</h3>';
        chunks.forEach(c => {
          if (!c.web?.uri) return;
          const el = document.createElement('a');
          el.className = 'source-card';
          el.href = c.web.uri; el.target = '_blank'; el.rel = 'noopener noreferrer';
          el.innerHTML = `<span class="source-icon">🔗</span>
            <div class="source-info">
              <span class="source-title">${c.web.title || c.web.uri}</span>
              <span class="source-url">${c.web.uri}</span>
            </div>`;
          sourcesEl.appendChild(el);
        });
      } else if (queries.length) {
        sourcesEl.innerHTML = '<h3 class="sources-heading">🔍 Search Queries</h3>';
        queries.forEach(q => {
          const el = document.createElement('div');
          el.className = 'source-card';
          el.innerHTML = `<span class="source-icon">🔍</span><span>${q}</span>`;
          sourcesEl.appendChild(el);
        });
      }
    }
  }

  function formatMdWithImages(text, images) {
    // Split into sections by ## headings
    const sections = text.split(/^## /gm).filter(Boolean);
    let html = '';
    let imgIndex = 0;

    sections.forEach((section, i) => {
      const lines    = section.split('\n');
      const heading  = lines[0].trim();
      const body     = lines.slice(1).join('\n');
      const bodyHtml = formatMdBody(body);

      // Insert image beside section if available
      const img = images[imgIndex];
      if (img && i > 0) {
        imgIndex++;
        html += `<h2 class="result-heading">## ${heading}</h2>
        <div class="content-with-image">
          <figure class="inline-figure">
            <a href="${img.url}" target="_blank" rel="noopener">
              <img src="${img.thumb}" alt="${img.desc || heading}" loading="lazy"/>
            </a>
            ${img.desc ? `<figcaption>${img.desc}</figcaption>` : ''}
          </figure>
          <div class="inline-text">${bodyHtml}</div>
        </div>`;
      } else {
        html += i === 0
          ? bodyHtml
          : `<h2 class="result-heading">## ${heading}</h2>${bodyHtml}`;
      }
    });
    return html;
  }

  function formatMdBody(text) {
    return text
      .replace(/^### (.+)$/gm, '<h3 class="result-heading-sm">$1</h3>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g,    '<em>$1</em>')
      .replace(/^[-*]\s+(.+)$/gm, '<li>$1</li>')
      .replace(/(<li>[\s\S]*?<\/li>)/g, m => `<ul>${m}</ul>`)
      .replace(/\n\n+/g, '</p><p>')
      .replace(/^(?!<[hup\/li]|<\/[hup\/li])(.+)$/gm, '<p>$1</p>')
      .replace(/<p><\/p>/g, '');
  }

  function formatMd(text) {
    return text
      .replace(/^## (.+)$/gm,  '<h2 class="result-heading">$1</h2>')
      .replace(/^### (.+)$/gm, '<h3 class="result-heading-sm">$1</h3>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g,    '<em>$1</em>')
      .replace(/^[-*]\s+(.+)$/gm, '<li>$1</li>')
      .replace(/(<li>[\s\S]*?<\/li>)/g, m => `<ul>${m}</ul>`)
      .replace(/\n\n+/g, '</p><p>')
      .replace(/^(?!<[hup\/li]|<\/[hup\/li])(.+)$/gm, '<p>$1</p>')
      .replace(/<p><\/p>/g, '');
  }

  // ── TTS SUMMARY (2 min = ~250 words) ─────────────────────────────
  async function buildTTSSummary(content) {
    try {
      const res  = await fetch(GEMINI_FAST_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: content }] }],
          systemInstruction: { parts: [{ text:
            `Write a vivid, dramatic audio narration of approximately 250 words (about 2 minutes when spoken) about this historical location.
Write it like a documentary narrator — dramatic, engaging, full of fascinating details.
No markdown. No bullet points. Pure flowing prose. Make it feel like a BBC documentary.` }] },
          generationConfig: { temperature: 0.8, maxOutputTokens: 400 }
        })
      });
      const data    = await res.json();
      ttsSummaryText = data.candidates?.[0]?.content?.parts?.[0]?.text || content.replace(/[#*]/g,'').substring(0, 800);
    } catch {
      ttsSummaryText = content.replace(/[#*_`]/g, '').substring(0, 800);
    }
  }

  // ── NAVIGATION TABS ───────────────────────────────────────────────
  const tabLinks = document.querySelectorAll('.nav-tab');
  let   leafletMap = null;

  tabLinks.forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      setActiveTab(link.dataset.tab);
    });
  });

  function setActiveTab(tab) {
    tabLinks.forEach(l => l.classList.remove('active'));
    const active = document.querySelector(`.nav-tab[data-tab="${tab}"]`);
    if (active) active.classList.add('active');

    resultsEl.style.display                                        = 'none';
    sourcesEl.style.display                                        = 'none';
    document.getElementById('timeline-panel').style.display       = 'none';
    document.getElementById('artifacts-panel').style.display      = 'none';

    switch(tab) {
      case 'explore':
        resultsEl.style.display = 'block';
        break;
      case 'timeline':
        document.getElementById('timeline-panel').style.display   = 'block';
        buildTimeline();
        break;
      case 'artifacts':
        document.getElementById('artifacts-panel').style.display  = 'block';
        buildArtifacts();
        break;
      case 'sources':
        sourcesEl.style.display = 'block';
        if (!sourcesEl.innerHTML.trim()) {
          sourcesEl.innerHTML = '<p class="no-searches">Search a location first to see sources.</p>';
        }
        break;
    }
  }

  // ── SMARTER TIMELINE ──────────────────────────────────────────────
  async function buildTimeline() {
    const panel = document.getElementById('timeline-panel');
    if (!window.lastResult) { panel.innerHTML = '<p class="no-searches">Search a location first.</p>'; return; }

    panel.innerHTML = `<h2 class="result-heading">🏛️ Historical Timeline of ${window.lastLocation}</h2>
      <div class="loading-container"><div class="compass-spinner">🧭</div><p class="loading-text">Extracting timeline…</p></div>`;

    try {
      const res  = await fetch(GEMINI_FAST_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: window.lastResult }] }],
          systemInstruction: { parts: [{ text:
            `Extract exactly 8 key historical events. Return ONLY a JSON array, nothing else, no markdown.
Format: [{"year":"753 BC","event":"Description under 25 words"}]
Order chronologically. Use BCE/CE notation where applicable.` }] },
          generationConfig: { temperature: 0.1, maxOutputTokens: 600 }
        })
      });
      const data   = await res.json();
      let   raw    = data.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
      raw          = raw.replace(/```json|```/g, '').trim();
      const events = JSON.parse(raw);

      panel.innerHTML = `<h2 class="result-heading">🏛️ Historical Timeline — ${window.lastLocation}</h2>
        <div class="timeline-wrap">
          <div class="timeline-line"></div>
          ${events.map((e, i) => `
            <div class="timeline-event" style="animation-delay:${i * 0.08}s">
              <div class="timeline-dot"></div>
              <div class="timeline-card">
                <div class="timeline-year">${e.year}</div>
                <p>${e.event}</p>
              </div>
            </div>`).join('')}
        </div>`;
    } catch {
      panel.innerHTML = '<p class="no-searches">Could not extract timeline. Please try again.</p>';
    }
  }

  // ── ARTIFACTS SECTION ─────────────────────────────────────────────
  async function buildArtifacts() {
    const panel = document.getElementById('artifacts-panel');
    if (!window.lastLocation) { panel.innerHTML = '<p class="no-searches">Search a location first.</p>'; return; }

    panel.innerHTML = `
      <h2 class="result-heading">🏺 Artifacts — ${window.lastLocation}</h2>

      <!-- Artifact sub-tabs -->
      <div class="artifact-tabs">
        <button class="artifact-tab active" data-atab="maps">🗺️ Maps</button>
        <button class="artifact-tab" data-atab="paintings">🖼️ Paintings & Photos</button>
        <button class="artifact-tab" data-atab="manuscripts">📜 Manuscripts & Articles</button>
        <button class="artifact-tab" data-atab="videos">🎥 Videos</button>
        <button class="artifact-tab" data-atab="others">🏺 Others</button>
      </div>

      <!-- Map section -->
      <div id="artifact-maps" class="artifact-section">
        <div id="leaflet-map" style="height:380px;width:100%;border-radius:8px;border:1px solid var(--border);"></div>
        <div class="map-info" id="map-info"><p>Locating <strong>${window.lastLocation}</strong>…</p></div>
        <div class="hist-maps-section">
          <h3 class="result-heading-sm">📜 Historical Maps from Archives</h3>
          <div id="hist-maps-grid" class="hist-maps-grid"><p class="no-searches">Searching archives…</p></div>
        </div>
      </div>

      <!-- Paintings section -->
      <div id="artifact-paintings" class="artifact-section" style="display:none;">
        <div id="paintings-grid" class="artifact-grid"><p class="no-searches">Searching archives…</p></div>
      </div>

      <!-- Manuscripts section -->
      <div id="artifact-manuscripts" class="artifact-section" style="display:none;">
        <div id="manuscripts-grid" class="artifact-grid"><p class="no-searches">Searching archives…</p></div>
      </div>

      <!-- Videos section -->
      <div id="artifact-videos" class="artifact-section" style="display:none;">
        <div id="videos-grid" class="artifact-grid">
          <p class="no-searches">🎥 Video search opens YouTube in a new tab.</p>
          <a href="https://www.youtube.com/results?search_query=${encodeURIComponent(window.lastLocation + ' history documentary')}" 
             target="_blank" rel="noopener" class="yt-search-btn">
            ▶ Search "${window.lastLocation}" Documentaries on YouTube
          </a>
        </div>
      </div>

      <!-- Others section -->
      <div id="artifact-others" class="artifact-section" style="display:none;">
        <div id="others-grid" class="artifact-grid"><p class="no-searches">Searching archives…</p></div>
      </div>`;

    // Artifact sub-tab switching
    panel.querySelectorAll('.artifact-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        panel.querySelectorAll('.artifact-tab').forEach(t => t.classList.remove('active'));
        panel.querySelectorAll('.artifact-section').forEach(s => s.style.display = 'none');
        tab.classList.add('active');
        document.getElementById(`artifact-${tab.dataset.atab}`).style.display = 'block';
      });
    });

    // Init map
    setTimeout(() => initLeafletMap(window.lastLocation), 150);

    // Fetch Wikimedia content categorised
    fetchWikimediaArtifacts(window.lastLocation);
  }

  function initLeafletMap(location) {
    if (leafletMap) { leafletMap.remove(); leafletMap = null; }

    leafletMap = L.map('leaflet-map').setView([20, 0], 2);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap', maxZoom: 18
    }).addTo(leafletMap);

    fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(location)}&format=json&limit=1`)
      .then(r => r.json())
      .then(data => {
        const info = document.getElementById('map-info');
        if (data?.length) {
          const lat = parseFloat(data[0].lat);
          const lon = parseFloat(data[0].lon);
          leafletMap.setView([lat, lon], 8);
          L.marker([lat, lon]).addTo(leafletMap).bindPopup(`<b>${location}</b>`).openPopup();
          info.innerHTML = `<p><strong>Location:</strong> ${location} &nbsp;|&nbsp; <strong>Coordinates:</strong> ${lat.toFixed(4)}, ${lon.toFixed(4)}</p>`;
        } else {
          info.innerHTML = `<p>Could not locate <strong>${location}</strong> on map.</p>`;
        }
      }).catch(() => {});

    fetchHistoricalMaps(location);
  }

  async function fetchHistoricalMaps(location) {
    const grid = document.getElementById('hist-maps-grid');
    try {
      const apiUrl = `https://commons.wikimedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(location + ' historical map')}&srnamespace=6&srlimit=8&format=json&origin=*`;
      const res    = await fetch(apiUrl);
      const data   = await res.json();
      const results = (data.query?.search || []);

      grid.innerHTML = '';
      let count = 0;
      for (const r of results) {
        if (count >= 6) break;
        const imgData = await fetchWikimediaThumb(r.title);
        if (imgData) {
          grid.appendChild(createWikimediaCard(imgData, 'map'));
          count++;
        }
      }
      if (!count) grid.innerHTML = '<p class="no-searches">No historical maps found in archives.</p>';
    } catch {
      grid.innerHTML = '<p class="no-searches">Could not load historical maps.</p>';
    }
  }

  async function fetchWikimediaArtifacts(location) {
    const categories = {
      paintings: `${location} painting OR portrait OR photograph`,
      manuscripts: `${location} manuscript OR document OR inscription OR artifact`,
      others: `${location} archaeology OR ruin OR monument`
    };

    for (const [type, query] of Object.entries(categories)) {
      const grid = document.getElementById(`${type}-grid`);
      try {
        const apiUrl = `https://commons.wikimedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srnamespace=6&srlimit=10&format=json&origin=*`;
        const res    = await fetch(apiUrl);
        const data   = await res.json();
        const results = data.query?.search || [];

        grid.innerHTML = '';
        let count = 0;
        for (const r of results) {
          if (count >= 6) break;
          // Categorise by file name
          const title = r.title.toLowerCase();
          const isMap  = title.includes('map');
          if (isMap && type !== 'maps') continue; // skip maps in other categories

          const imgData = await fetchWikimediaThumb(r.title);
          if (imgData) {
            grid.appendChild(createWikimediaCard(imgData, type));
            count++;
          }
        }
        if (!count) grid.innerHTML = `<p class="no-searches">No ${type} found for ${location}.</p>`;
      } catch {
        grid.innerHTML = `<p class="no-searches">Could not load ${type}.</p>`;
      }
    }
  }

  async function fetchWikimediaThumb(title) {
    try {
      const url  = `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}&prop=imageinfo&iiprop=url|thumburl|extmetadata&iiurlwidth=320&format=json&origin=*`;
      const res  = await fetch(url);
      const data = await res.json();
      const page = Object.values(data.query?.pages || {})[0];
      const info = page?.imageinfo?.[0];
      if (!info?.thumburl) return null;
      const desc = info.extmetadata?.ImageDescription?.value?.replace(/<[^>]+>/g,'') || title.replace('File:','').replace(/\.[^.]+$/,'');
      return { thumb: info.thumburl, url: info.url, desc: desc.substring(0,80), title: title.replace('File:','') };
    } catch { return null; }
  }

  function createWikimediaCard(item, type) {
    const card = document.createElement('div');
    card.className = 'artifact-card';
    card.innerHTML = `
      <a href="${item.url}" target="_blank" rel="noopener">
        <img src="${item.thumb}" alt="${item.desc}" loading="lazy"/>
        <div class="artifact-card-info">
          <p class="artifact-desc">${item.desc}</p>
        </div>
      </a>`;
    return card;
  }

  // ── SERVICE WORKER ────────────────────────────────────────────────
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/service-worker.js').catch(console.error);
  }

});