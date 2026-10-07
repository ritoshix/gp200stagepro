const APP_VERSION = 'v1.9';
const STORAGE_KEY = 'gp200_stage_pro_sets';
const $ = id => document.getElementById(id);

let wakeLock = null;

const log = msg => {
    const l = $('log'); if(!l) return;
    const time = new Date().toLocaleTimeString();
    l.innerHTML += `<div style="margin-bottom:2px; border-bottom:1px solid var(--border-line); padding-bottom:1px;"><span style="color:var(--text-muted);">[${time}]</span> <span style="color:var(--accent-cyan);">${msg}</span></div>`;
    l.scrollTop = l.scrollHeight;
};

const state = {
    pro: localStorage.getItem('gp200_pro') === '1',
    bank: 1, activeGlobal: null, isSetlistMode: false, setIdx: 0, sets: [],
    mods: {}, expB: false,
    audio: null, padBuffers: {}, activeSource: null, padGain: null, padFilterNode: null,
    padKey: null, padVol: 0.8, padTone: 0.5, padFreqOffset: 0,
    midi: null, port: null, tap: [], timer: null, alertCb: null
};

const pads = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const letters = ['A', 'B', 'C', 'D'];

window.onload = async () => {
    try {
        await loadChangelogs();
        updateHeaderEdition();
        buildUI();
        initSets();
        initMIDI();
        preloadAllPadBuffers();
        requestWakeLock();

        // Handle visibility changes without cutting background playback
        document.addEventListener('visibilitychange', async () => {
            if (!document.hidden) {
                if (state.audio && state.audio.state === 'suspended') {
                    await state.audio.resume();
                    log('App focused: Audio context resumed.');
                }
                await requestWakeLock();
            }
        });

        log(`System Boot Complete. ${APP_VERSION} Pro Ready.`);
    } catch (err) {
        log("BOOT ERROR: " + err.message);
    }
};

function initAudioContext() {
    if (!state.audio) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        state.audio = new AudioCtx();
    }
    // Only try to resume if it exists, letting user interaction handle the initial unlock
    if (state.audio.state === 'suspended') {
        state.audio.resume().catch(() => {
            // Will automatically resume on the next user tap/gesture
        });
    }
}

async function requestWakeLock() {
    try {
        if ('wakeLock' in navigator) {
            wakeLock = await navigator.wakeLock.request('screen');
            wakeLock.addEventListener('release', () => {
                log('Screen Wake Lock released.');
            });
            log('Screen Wake Lock active (prevents screen sleep & app reset).');
        }
    } catch (err) {
        log(`Wake Lock error: ${err.name}, ${err.message}`);
    }
}

async function preloadAllPadBuffers() {
    const cacheStatus = $('cacheStatus');
    const progressBar = $('cacheProgressBar');
    if (cacheStatus) cacheStatus.innerText = `Status: Loading audio into memory...`;

    let successCount = 0;
    const total = pads.length;

    for (let i = 0; i < total; i++) {
        const k = pads[i];
        const url = `audio/pad_${k}.mp3`;
        try {
            const response = await fetch(url);
            if (response.ok) {
                const arrayBuffer = await response.arrayBuffer();
                if (state.audio) {
                    state.padBuffers[k] = await state.audio.decodeAudioData(arrayBuffer);
                    successCount++;
                }
            }
        } catch (e) {
            log(`Cache warning: Could not preload pad ${k}`);
        }

        let percent = Math.round((successCount / total) * 100);
        if (cacheStatus) cacheStatus.innerText = `Status: Loaded (${successCount}/${total} - ${percent}%)`;
        if (progressBar) progressBar.style.width = percent + '%';
    }

    if (cacheStatus) cacheStatus.innerText = `Status: Ready for Instant Playback (${successCount}/12 Loaded)`;
    if (progressBar) progressBar.style.width = '100%';
    log(`Audio Preload: Successfully loaded ${successCount} of 12 pads into memory.`);
}

async function downloadAllPadsOffline() {
    initAudioContext();
    log("Manual offline sync triggered...");
    const cacheStatus = $('cacheStatus');
    const progressBar = $('cacheProgressBar');
    if(cacheStatus) cacheStatus.innerText = `Status: Syncing & Preloading All Pads...`;

    let successCount = 0;
    const total = pads.length;

    for (let i = 0; i < total; i++) {
        const k = pads[i];
        const url = `audio/pad_${k}.mp3`;
        try {
            const response = await fetch(url);
            if (response.ok) {
                const arrayBuffer = await response.arrayBuffer();
                if (state.audio) {
                    state.padBuffers[k] = await state.audio.decodeAudioData(arrayBuffer);
                    successCount++;
                }
            }
        } catch(e) {}

        let percent = Math.round((successCount / total) * 100);
        if (cacheStatus) cacheStatus.innerText = `Status: Syncing (${successCount}/${total} - ${percent}%)`;
        if (progressBar) progressBar.style.width = percent + '%';
    }

    if(cacheStatus) cacheStatus.innerText = `Status: Ready for Instant Playback (${successCount}/12 Loaded)`;
    if(progressBar) progressBar.style.width = '100%';
    showAlert("OFFLINE READY", `Successfully synced and preloaded all ${successCount} pad audio files into memory!`);
}

async function loadChangelogs() {
    try {
        const response = await fetch('changelogs.txt');
        if (!response.ok) throw new Error('Failed to load changelogs.txt');
        const text = await response.text();

        const lines = text.split('\n').filter(line => line.trim() !== '');
        const changelogs = lines.map(line => {
            const parts = line.split(':');
            return {
                v: parts[0] ? parts[0].trim() : '',
                d: parts.slice(1).join(':').trim()
            };
        }).filter(c => c.v !== '');

        renderChangelogs(changelogs);
        checkAppUpdate(changelogs);
    } catch (e) {
        log("SYS: Error loading changelogs.txt. Using fallback notes.");
        const fallback = [{ v: APP_VERSION, d: 'Bulletproof offline audio buffering and background controls added.' }];
        renderChangelogs(fallback);
        checkAppUpdate(fallback);
    }
}

function checkAppUpdate(changelogs) {
    if (changelogs.length === 0) return;
    const latestVerFromText = changelogs[0].v;
    const lastVer = localStorage.getItem('gp200_last_version');

    if (lastVer !== latestVerFromText) {
        const updateVersionText = $('updateVersionText');
        const updateNotes = $('updateNotes');

        if (updateVersionText) updateVersionText.innerText = latestVerFromText;
        if (updateNotes) updateNotes.innerHTML = changelogs[0].d;

        openModal('updateModal');
        localStorage.setItem('gp200_last_version', latestVerFromText);
    }
}

function renderChangelogs(changelogs) {
    const clist = $('changelogList');
    if (clist) {
        clist.innerHTML = changelogs.map(c => `
            <div class="changelog-item">
                <span class="changelog-ver">${c.v}</span>
                <span class="changelog-desc">${c.d}</span>
            </div>
        `).join('');
    }
}

function initAudioContext() {
    if (!state.audio) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        state.audio = new AudioCtx();
    }
    if (state.audio.state === 'suspended') {
        state.audio.resume();
    }
}

function updateHeaderEdition() {
    const headerEdition = $('headerEdition');
    if (headerEdition) {
        if (state.pro) {
            headerEdition.innerHTML = '[PRO]';
            headerEdition.style.color = 'var(--accent-purple)';
        } else {
            headerEdition.innerHTML = '[FREE]';
            headerEdition.style.color = 'var(--text-muted)';
        }
    }
}

function buildUI() {
    const padsContainer = $('padsContainer');
    if(padsContainer) {
        padsContainer.innerHTML = pads.map(k => `<div class="pad-btn" id="pad_${k}" onclick="togglePad('${k}')">${k}</div>`).join('');
    }

    const standardGrid = $('standardGrid');
    if(standardGrid) {
        standardGrid.innerHTML = letters.map((l, i) => `
            <div class="patch-btn" id="stdBtn_${i}" onclick="selectPatch(${i})">
                <div class="patch-num rajdhani" id="stdLoc_${i}">1${l}</div>
                <div class="patch-name">Preset ${l}</div>
            </div>`).join('');
    }

    const setlistGrid = $('setlistGrid');
    if(setlistGrid) {
        setlistGrid.innerHTML = letters.map((l, i) => `
            <div class="patch-btn" id="setBtn_${i}" onclick="playSetSlot(${i})">
                <div class="patch-num rajdhani" id="setLoc_${i}">1${l}</div>
                <div class="patch-name" id="setName_${i}">PATCH ${i+1}</div>
                <div class="patch-sub-lbl"><span id="setPad_${i}">--</span><span id="setBpm_${i}"></span></div>
            </div>`).join('');
    }

    const moduleGrid = $('moduleGrid');
    if(moduleGrid) {
        const mods = [
            [57,'WAH',0,''], [48,'PRE',0,''], [49,'DIST',0,''], [50,'AMP',0,''],
            [51,'GATE',0,''], [52,'CAB',0,''], [53,'EQ',0,''], [54,'MOD',0,''],
            [55,'DLY',0,''], [56,'RVB',0,'']
        ];
        moduleGrid.innerHTML = mods.map(m => `
            <div class="mod-btn ${m[3]}" id="mod_${m[0]}" onclick="toggleMod(${m[0]}, ${m[2]}, '${m[1]}')">
                ${m[1]} ${m[2] ? '<span class="pro-badge" style="font-size:5px; background:var(--warning);">PRO</span>' : ''}
            </div>`).join('');
    }

    const toolsGrid = $('toolsGrid');
    if(toolsGrid) {
        const tools = [
            [58, 'TUNER', 1, 'tuner-mod'],
            [59, 'LOOPER', 1, 'looper-mod']
        ];
        toolsGrid.innerHTML = tools.map(t => `
            <div class="mod-btn ${t[3]}" id="mod_${t[0]}" onclick="toggleMod(${t[0]}, ${t[2]}, '${t[1]}')" style="padding: 7px 4px;">
                ${t[1]} <span class="pro-badge" style="font-size:5px; background:var(--warning);">PRO</span>
            </div>`).join('');
    }

    const knobsContainer = $('knobsContainer');
    if(knobsContainer) {
        knobsContainer.innerHTML = [16, 18, 20].map((cc, i) => `
            <div class="slider-group">
                <div class="slider-lbl"><span>Param ${i+1}</span> <span class="slider-val" id="valK${i}">50</span></div>
                <input type="range" min="0" max="127" value="50" class="slider" id="slK${i}" oninput="updateUIVal('K${i}', this.value)" onchange="sendCC(${cc}, this.value, 'Param ${i+1}')">
            </div>
        `).join('');
    }
}

function toggleFaq(element) {
    element.classList.toggle('open');
    const indicator = element.querySelector('.faq-question span');
    if(indicator) indicator.innerText = element.classList.contains('open') ? '-' : '+';
}

const openModal = id => { const m = $(id); if(m) m.style.display = 'flex'; };
const closeModal = id => { const m = $(id); if(m) m.style.display = 'none'; };

function showAlert(title, msg, type = 'alert', defaultVal = '') {
    return new Promise(res => {
        const alertTitle = $('alertTitle'), alertMsg =$('alertMsg');
        if(alertTitle) alertTitle.innerText = title; if(alertMsg) alertMsg.innerText = msg;
        const inp = $('alertInput'), cancel =$('alertCancel');
        if(inp) inp.style.display = type === 'prompt' ? 'block' : 'none';
        if(cancel) cancel.style.display = (type === 'prompt' || type === 'confirm') ? 'block' : 'none';
        if (type === 'prompt' && inp) { inp.value = defaultVal; setTimeout(() => inp.select(), 100); }
        state.alertCb = res; openModal('alertModal');
    });
}

function resolveAlert(res) {
    closeModal('alertModal');
    if (state.alertCb) {
        const inp = $('alertInput');
        state.alertCb(res ? (inp && inp.style.display === 'block' ? inp.value.trim() : true) : false);
        state.alertCb = null;
    }
}

async function activatePro() {
    const proInput = $('proInput');
    if (proInput && proInput.value.trim().toUpperCase() === 'GP200PRO') {
        localStorage.setItem('gp200_pro', '1'); state.pro = true;
        updateHeaderEdition();
        closeModal('proModal'); showAlert("ACTIVATED", "Pro features unlocked successfully.");
    } else showAlert("ERROR", "Invalid license code.");
}

async function activateProInline() {
    const proInputInline = $('proInputInline');
    if (proInputInline && proInputInline.value.trim().toUpperCase() === 'GP200PRO') {
        localStorage.setItem('gp200_pro', '1'); state.pro = true;
        updateHeaderEdition();
        proInputInline.value = '';
        showAlert("ACTIVATED", "Pro features unlocked successfully.");
    } else {
        showAlert("ERROR", "Invalid Pro license code.");
    }
}

function switchTab(id, el) {
    document.querySelectorAll('.tab-content, .tab-btn').forEach(e => e.classList.remove('active'));
    const targetTab = $(id); if(targetTab) targetTab.classList.add('active');
    if(el) {
        el.classList.add('active');
    } else {
        document.querySelectorAll('.tab-btn').forEach(btn => {
            if (btn.innerText.toLowerCase() === id.replace('tab-', '')) btn.classList.add('active');
        });
    }
}

function switchMode(mode) {
    if (mode === 'setlist' && !state.pro) return openModal('proModal');
    state.isSetlistMode = (mode === 'setlist');

    const bankView = $('bankViewContainer');
    const setlistView = $('setlistViewContainer');
    const modeBankBtn = $('modeBankBtn');
    const modeSetBtn = $('modeSetBtn');
    const modeTitle = $('modeTitle');

    if (state.isSetlistMode) {
        if(bankView) bankView.style.display = 'none';
        if(setlistView) setlistView.style.display = 'block';
        if(modeBankBtn) { modeBankBtn.style.background = 'var(--bg-elevated)'; modeBankBtn.style.color = 'var(--text-muted)'; }
        if(modeSetBtn) { modeSetBtn.style.background = 'var(--accent-cyan)'; modeSetBtn.style.color = '#000'; }
        if(modeTitle) modeTitle.innerText = 'SETLIST MODE';
    } else {
        if(bankView) bankView.style.display = 'block';
        if(setlistView) setlistView.style.display = 'none';
        if(modeBankBtn) { modeBankBtn.style.background = 'var(--accent-cyan)'; modeBankBtn.style.color = '#000'; }
        if(modeSetBtn) { modeSetBtn.style.background = 'var(--bg-elevated)'; modeSetBtn.style.color = 'var(--text-muted)'; }
        if(modeTitle) modeTitle.innerText = 'STANDARD BANK';
    }
    refreshUI();
}

async function initMIDI() {
    try {
        if (navigator.requestMIDIAccess) {
            state.midi = await navigator.requestMIDIAccess({ sysex: false });
            const sel = $('midiOut'); if(!sel) return; sel.innerHTML = '';
            for (let port of state.midi.outputs.values()) {
                if (!state.port) state.port = port;
                sel.innerHTML += `<option value="${port.id}">${port.name}</option>`;
            }
            const status = $('midiStatusText');
            if (state.port) {
                if(status) { status.innerText = 'MIDI ONLINE'; status.style.color = 'var(--accent-cyan)'; }
                log(`MIDI Linked: ${state.port.name}`);
            } else {
                if(status) { status.innerText = 'MIDI OFFLINE'; status.style.color = 'var(--danger)'; }
            }
        }
    } catch (e) { log("MIDI API Blocked/Not Supported."); }
}

function sendCC(cc, val, name) {
    if (state.port) state.port.send([0xB0, cc, parseInt(val)]);
    log(`TX: ${name} [CC ${cc}] -> ${val}`);
}

function togglePad(k) {
    if (!state.pro) return openModal('proModal');
    initAudioContext();

    if (state.padKey === k) {
        stopPad();
    } else {
        playPad(k);
    }
}

async function playPad(k) {
    initAudioContext();
    const now = state.audio.currentTime;
    const crossfadeDuration = 1.5;

    if (state.padGain && state.activeSource) {
        const oldGain = state.padGain;
        oldGain.gain.cancelScheduledValues(now);
        oldGain.gain.setValueAtTime(oldGain.gain.value, now);
        oldGain.gain.linearRampToValueAtTime(0.0001, now + crossfadeDuration);
        const oldSrc = state.activeSource;
        setTimeout(() => { try { oldSrc.stop(); oldSrc.disconnect(); } catch(e){} }, (crossfadeDuration + 0.1) * 1000);
    }

    state.padKey = k;
    document.querySelectorAll('.pad-btn').forEach(b => b.classList.remove('active-pad'));
    const padEl = $(`pad_${k}`); if(padEl) padEl.classList.add('active-pad');
    const padStatus = $('padStatus'), stopPadBtn =$('stopPadBtn');
    if(padStatus) padStatus.innerText = `PLAYING [${k}]`; if(stopPadBtn) stopPadBtn.style.display = 'block';
    log(`PAD: Started [${k}] in background`);

    let buffer = state.padBuffers[k];
    if (!buffer) {
        try {
            let response = await fetch(`audio/pad_${k}.mp3`);
            if (!response.ok) throw new Error("File not found");
            const arrayBuffer = await response.arrayBuffer();
            buffer = await state.audio.decodeAudioData(arrayBuffer);
            state.padBuffers[k] = buffer;
        } catch(e) {
            log(`ERROR: Offline or missing file for pad ${k}`);
            showAlert("AUDIO ERROR", `Cannot play pad ${k}. Ensure audio files are available offline.`);
            stopPad(false);
            return;
        }
    }

    const source = state.audio.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    const filter = state.audio.createBiquadFilter();
    filter.type = 'lowpass';
    const filterCut = 150 + (state.padTone * 2500);
    filter.frequency.value = filterCut;
    filter.Q.value = 0.6;
    state.padFilterNode = filter;

    const gainNode = state.audio.createGain();
    gainNode.gain.setValueAtTime(0.0001, now);
    gainNode.gain.linearRampToValueAtTime(Math.max(0.001, state.padVol * 0.8), now + crossfadeDuration);

    source.connect(filter);
    filter.connect(gainNode);
    gainNode.connect(state.audio.destination);

    source.start(now);
    state.activeSource = source;
    state.padGain = gainNode;

    // --- MEDIA SESSION NOTIFICATION & LOCK SCREEN CONTROLS ---
    if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
            title: `Worship Pad [${k} Key]`,
            artist: 'GP-200 Stage Pro',
            album: 'Live Ambient Pads'
        });

        navigator.mediaSession.playbackState = 'playing';

        navigator.mediaSession.setActionHandler('stop', () => {
            stopPad();
        });
        
        navigator.mediaSession.setActionHandler('pause', () => {
            stopPad();
        });
    }
}

function stopPad(logIt = true) {
    if (state.padGain && state.activeSource && state.audio) {
        const now = state.audio.currentTime;
        state.padGain.gain.cancelScheduledValues(now);
        state.padGain.gain.setValueAtTime(state.padGain.gain.value, now);
        state.padGain.gain.linearRampToValueAtTime(0.0001, now + 2.0);

        const src = state.activeSource;
        const g = state.padGain;
        state.activeSource = null;
        state.padGain = null;

        setTimeout(() => {
            try { src.stop(); src.disconnect(); g.disconnect(); } catch(e){}
        }, 2100);
    }
    state.padKey = null;
    state.padFilterNode = null;
    document.querySelectorAll('.pad-btn').forEach(b => b.classList.remove('active-pad'));
    const padStatus = $('padStatus'), stopPadBtn =$('stopPadBtn');
    if(padStatus) padStatus.innerText = `STATUS: OFF`; if(stopPadBtn) stopPadBtn.style.display = 'none';

    if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'none';
    }

    if (logIt) log(`PAD: Stopped`);
}

function updatePad(type, val) {
    const v = val / 100;
    if (type === 'Vol') {
        state.padVol = v;
        $('valPADVOL').innerText = val + '%';
        if (state.padGain && state.audio) {
            state.padGain.gain.setValueAtTime(Math.max(0.001, v * 0.8), state.audio.currentTime);
        }
    } else if (type === 'Tone') {
        state.padTone = v;
        $('valPADTONE').innerText = val + '%';
        const filterCut = 150 + (v * 2500);
        if (state.padFilterNode && state.audio) {
            state.padFilterNode.frequency.setTargetAtTime(filterCut, state.audio.currentTime, 0.1);
        }
    } else if (type === 'Freq') {
        state.padFreqOffset = parseInt(val);
        $('valPADFREQ').innerText = val + ' Hz';
        if (state.activeSource && state.padKey && state.audio) {
            let rate = 1.0 + (state.padFreqOffset * 0.005);
            try { state.activeSource.playbackRate.setValueAtTime(rate, state.audio.currentTime); } catch(e){}
        }
    }
}

function updateUIVal(id, val) { const el = $('val' + id); if(el) el.innerText = val; }

async function promptJumpBank() {
    let res = await showAlert("JUMP BANK", "Enter Bank (1 - 64):", "prompt", state.bank);
    if (res && !isNaN(res)) {
        let parsed = parseInt(res);
        if(parsed >= 1 && parsed <= 64) { state.bank = parsed; refreshUI(); }
    }
}

function changeBank(amt) {
    let n = state.bank + amt; if (n >= 1 && n <= 64) { state.bank = n; refreshUI(); }
}

function selectPatch(idx, isSet = false) {
    let total = (state.bank - 1) * 4 + parseInt(idx);
    if (state.port) {
        state.port.send([0xB0, 0, Math.floor(total / 128)]);
        state.port.send([0xC0, total % 128]);
    }
    log(`TX: PATCH -> ${state.bank}${letters[idx]}`);
    state.activeGlobal = isSet ? (state.setIdx * 4) + idx : `std_${state.bank}_${idx}`;

    for (let k in state.mods) state.mods[k] = false;
    document.querySelectorAll('.mod-btn').forEach(b => b.classList.remove('active'));
    [0,1,2].forEach(i => { let s=$('slK' + i); if(s) s.value=50; updateUIVal('K' + i, 50); });

    refreshUI();
}

function toggleMod(cc, isPro, name) {
    if (isPro && !state.pro) return openModal('proModal');
    if (!state.mods[cc] && !state.pro && Object.values(state.mods).filter(Boolean).length >= 3) return showAlert("FREE LIMIT", "Max 3 modules in Free version.");
    state.mods[cc] = !state.mods[cc];
    if (state.port) state.port.send([0xB0, cc, state.mods[cc] ? 127 : 0]);
    const modBtn = $('mod_' + cc); if(modBtn) modBtn.classList.toggle('active', state.mods[cc]);
    log(`TX: ${name} -> ${state.mods[cc] ? 'ON' : 'OFF'}`);
}

function triggerBpm(bpm) {
    if (!bpm || isNaN(bpm)) return;
    clearInterval(state.timer);
    const bpmDisplay = $('bpmDisplay'); if(bpmDisplay) bpmDisplay.innerText = `${bpm} BPM`;
    const btn = $('tapBtn'), interval = 60000 / bpm;
    state.timer = setInterval(() => {
        if(btn) { btn.classList.add('pulsing'); setTimeout(() => btn.classList.remove('pulsing'), 100); }
    }, interval);
    log(`METRONOME: Set to ${bpm} BPM`);
}

function handleTapTempo() {
    const now = performance.now();
    if (state.tap.length && now - state.tap[state.tap.length-1] > 2500) { state.tap = []; clearInterval(state.timer); }
    state.tap.push(now); if (state.tap.length > 4) state.tap.shift();
    const btn = $('tapBtn'); if(btn) { btn.classList.add('pulsing'); setTimeout(() => btn.classList.remove('pulsing'), 100); }
    if (state.tap.length > 1) {
        let diffs = []; for(let i=1; i<state.tap.length; i++) diffs.push(state.tap[i] - state.tap[i-1]);
        let bpm = Math.max(40, Math.min(240, Math.round(60000 / (diffs.reduce((a,b)=>a+b)/diffs.length))));
        triggerBpm(bpm);
    } else {
        const bpmDisplay = $('bpmDisplay'); if(bpmDisplay) bpmDisplay.innerText = `TAP...`;
    }
    if (state.port) state.port.send([0xB0, 75, 127]);
}

function toggleExp() {
    state.expB = !state.expB; sendCC(13, state.expB ? 127 : 0, 'EXP_TGT');
    const b = $('expToggleBtn');
    if(b) {
        b.innerText = `TARGET: ${state.expB ? 'B' : 'A'}`;
        b.style.color = state.expB ? 'var(--accent-cyan)' : 'var(--text-muted)';
        b.style.borderColor = state.expB ? 'var(--accent-cyan)' : 'var(--border-line)';
    }
}

function initSets() {
    const randBpm = () => Math.floor(Math.random() * (138 - 68 + 1)) + 68;
    const def = [{
        name: "SUNDAY WORSHIP",
        patches: [
            { n: "CLEAN INTRO", b: 1, p: 0, k: "C", bpm: randBpm() },
            { n: "VERSE AMBIENT", b: 1, p: 1, k: "G", bpm: randBpm() },
            { n: "CHORUS DRIVE", b: 2, p: 2, k: "D", bpm: randBpm() },
            { n: "BIG ANTHEM", b: 2, p: 3, k: "A", bpm: randBpm() }
        ]
    }];
    try {
        const ls = JSON.parse(localStorage.getItem(STORAGE_KEY));
        if (Array.isArray(ls) && ls.length > 0) {
            state.sets = ls.map(s => ({
                name: s.name || "SETLIST",
                patches: Array(4).fill(0).map((_, i) => {
                    const p = (s.patches && s.patches[i]) ? s.patches[i] : {};
                    return {
                        n: p.n || `PRESET ${i+1}`,
                        b: p.b || 1,
                        p: (p.p !== undefined) ? p.p : i,
                        k: p.k || "",
                        bpm: (p.bpm !== undefined && p.bpm > 0) ? p.bpm : randBpm()
                    };
                })
            }));
        } else {
            state.sets = def;
        }
    } catch(e) {
        state.sets = def;
    }
    saveSets();
    renderSetTabs();
    refreshUI();
}
const saveSets = () => localStorage.setItem(STORAGE_KEY, JSON.stringify(state.sets));

function renderSetTabs() {
    const setlistTabs = $('setlistTabs'); if(!setlistTabs) return;
    setlistTabs.innerHTML = state.sets.map((s, i) => `<div class="set-tab ${state.setIdx === i ? 'active' : ''}" onclick="state.setIdx=${i}; renderSetTabs(); refreshUI();">${s.name}</div>`).join('') +
    `<div class="set-tab" style="border: 1px dashed var(--accent-cyan); color: var(--accent-cyan); background: transparent;" onclick="addSet()">+ ADD SET</div>`;
}

async function addSet() {
    let res = await showAlert("NEW SET", "Enter Set Name:", "prompt", `SET ${state.sets.length + 1}`);
    if (res !== false) {
        const randBpm = () => Math.floor(Math.random() * (138 - 68 + 1)) + 68;
        state.sets.push({
            name: (res && res.trim() !== '') ? res.trim().toUpperCase() : `SET ${state.sets.length + 1}`,
            patches: Array(4).fill(0).map((_,i) => ({ n: `PRESET ${i+1}`, b: state.sets.length+1, p: i, k: "", bpm: randBpm() }))
        });
        state.setIdx = state.sets.length - 1; saveSets(); renderSetTabs(); refreshUI();
    }
}

async function renameCurrentSet() {
    let curr = state.sets[state.setIdx].name;
    let res = await showAlert("RENAME SET", "Enter new set name:", "prompt", curr);
    if (res !== false && res.trim() !== '') {
        state.sets[state.setIdx].name = res.trim().toUpperCase();
        saveSets(); renderSetTabs(); refreshUI();
        log(`SYS: Set renamed to ${state.sets[state.setIdx].name}`);
    }
}

async function deleteSet() {
    if (state.sets.length <= 1) return showAlert("DENIED", "Keep at least 1 set.");
    if (await showAlert("DELETE", `Delete ${state.sets[state.setIdx].name}?`, "confirm")) {
        state.sets.splice(state.setIdx, 1); state.setIdx = 0; saveSets(); refreshUI();
    }
}

function playSetSlot(i) {
    const p = state.sets[state.setIdx].patches[i];
    state.bank = p.b; selectPatch(p.p, true);
    if (state.pro && p.k) playPad(p.k); else stopPad();
    if (p.bpm) triggerBpm(p.bpm);
}

function openEditModal() { const editSlot = $('editSlot'); if(editSlot) editSlot.value = 0; loadSlotData(); openModal('editModal'); }

function loadSlotData() {
    const editSlot = $('editSlot'); if(!editSlot) return;
    const p = state.sets[state.setIdx].patches[editSlot.value]; if(!p) return;
    const editName = $('editName'), editBank = $('editBank'), editPatch =$('editPatch'), editPadKey = $('editPadKey'), editBpm =$('editBpm');
    if(editName) editName.value = p.n; if(editBank) editBank.value = p.b; if(editPatch) editPatch.value = p.p; if(editPadKey) editPadKey.value = p.k || ""; if(editBpm) editBpm.value = p.bpm || "";
}

function saveSlotData() {
    const editSlot = $('editSlot'); if(!editSlot) return;
    const editName = $('editName'), editBank = $('editBank'), editPatch =$('editPatch'), editPadKey = $('editPadKey'), editBpm =$('editBpm');
    state.sets[state.setIdx].patches[editSlot.value] = {
        n: editName ? editName.value.trim().toUpperCase() : "PRESET",
        b: editBank ? parseInt(editBank.value)||1 : 1,
        p: editPatch ? parseInt(editPatch.value) : 0,
        k: editPadKey ? editPadKey.value : "",
        bpm: editBpm ? parseInt(editBpm.value) || 0 : 0
    };
    saveSets(); refreshUI(); closeModal('editModal'); log("SYS: Preset & BPM updated.");
}

function refreshUI() {
    let fb = state.bank < 10 ? '0'+state.bank : state.bank;
    const bankDisp = $('bankDisplay'); if(bankDisp) bankDisp.innerText = `BANK ${fb}`;
    [0,1,2,3].forEach(i => {
        const stdLoc = $('stdLoc_' + i); if(stdLoc) stdLoc.innerText = `${state.bank}${letters[i]}`;
        const btn = $('stdBtn_' + i); if(btn) btn.classList.toggle('active-patch', !state.isSetlistMode && state.activeGlobal === `std_${state.bank}_${i}`);
    });
    const set = state.sets[state.setIdx];
    if (set) {
        const activeSetTitle = $('activeSetTitle'); if(activeSetTitle) activeSetTitle.innerText = `// ${set.name} PRESETS`;
        [0,1,2,3].forEach(i => {
            const p = set.patches[i];
            const setName = $('setName_' + i), setLoc = $('setLoc_' + i), setPad =$('setPad_' + i), setBpm = $('setBpm_' + i), setBtn =$('setBtn_' + i);
            if(setName) setName.innerText = p.n; if(setLoc) setLoc.innerText = `${p.b}${letters[p.p]}`;
            if(setPad) setPad.innerText = p.k ? `PAD: ${p.k}` : '--';
            if(setBpm) setBpm.innerText = p.bpm ? `${p.bpm} BPM` : '';
            if(setBtn) setBtn.classList.toggle('active-patch', state.isSetlistMode && state.activeGlobal === (state.setIdx * 4) + i);
        });
    }
}