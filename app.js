// ==========================================
// 1. Web Audio API Karplus-Strong 기타 사운드 엔진
// ==========================================
class GuitarAudioEngine {
  constructor() {
    this.ctx = null;
    this.enabled = true;
  }

  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  pluckFrequency(freq, duration = 2.0) {
    if (!this.enabled) return;
    this.init();

    const sampleRate = this.ctx.sampleRate;
    const totalSamples = Math.floor(sampleRate * duration);
    const period = Math.max(2, Math.round(sampleRate / freq));

    const buffer = this.ctx.createBuffer(1, totalSamples, sampleRate);
    const data = buffer.getChannelData(0);

    // 초기 피크 노이즈 버스트 + 로우패스 스무딩
    const delayLine = new Float32Array(period);
    for (let i = 0; i < period; i++) {
      delayLine[i] = Math.random() * 1.4 - 0.7;
    }
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < period; i++) {
        delayLine[i] = 0.5 * (delayLine[i] + delayLine[(i + 1) % period]);
      }
    }

    let idx = 0;
    let prev = 0;
    for (let i = 0; i < totalSamples; i++) {
      const current = delayLine[idx];
      const filtered = 0.994 * 0.5 * (current + prev);
      delayLine[idx] = filtered;
      prev = current;
      data[i] = current * 0.55;
      idx = (idx + 1) % period;
    }

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.ctx.destination);
    source.start();
  }

  pluckString(stringIndex, fret) {
    // 0: 6번줄(E2=40) ~ 5: 1번줄(E4=64)
    const openMidi = [40, 45, 50, 55, 59, 64];
    const midi = openMidi[stringIndex] + fret;
    const freq = 440.0 * Math.pow(2.0, (midi - 69) / 12.0);
    this.pluckFrequency(freq);
  }

  pluckMidi(midi) {
    const freq = 440.0 * Math.pow(2.0, (midi - 69) / 12.0);
    this.pluckFrequency(freq);
  }

  playArpeggio(positions, intervalMs = 220) {
    if (!this.enabled) return;
    positions.forEach((pos, idx) => {
      setTimeout(() => this.pluckString(pos.s, pos.f), idx * intervalMs);
    });
  }
}

const soundEngine = new GuitarAudioEngine();

function toggleSound() {
  soundEngine.enabled = !soundEngine.enabled;
  const btn = document.getElementById('btn-sound');
  if (soundEngine.enabled) {
    btn.textContent = '🔊 소리 켜짐';
    btn.classList.remove('muted');
  } else {
    btn.textContent = '🔇 음소거';
    btn.classList.add('muted');
  }
}

// ==========================================
// 2. 음악 이론 및 상태 데이터
// ==========================================
const NOTES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const NATURAL_NOTES = new Set(['C', 'D', 'E', 'F', 'G', 'A', 'B']);
const CIRCLE_OF_FOURTHS = ['C', 'F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'B', 'E', 'A', 'D', 'G'];
const OPEN_STRINGS = [4, 9, 2, 7, 11, 4]; // E, A, D, G, B, E
const INLAY_FRETS = [3, 5, 7, 9, 12];

const SOLFEGE_ITEMS = [
  { alpha: 'C', sol: '도', midi: 0, nat: true },
  { alpha: 'D', sol: '레', midi: 2, nat: true },
  { alpha: 'E', sol: '미', midi: 4, nat: true },
  { alpha: 'F', sol: '파', midi: 5, nat: true },
  { alpha: 'G', sol: '솔', midi: 7, nat: true },
  { alpha: 'A', sol: '라', midi: 9, nat: true },
  { alpha: 'B', sol: '시', midi: 11, nat: true },
  { alpha: 'C#', sol: '도#', midi: 1, nat: false },
  { alpha: 'Db', sol: '레b', midi: 1, nat: false },
  { alpha: 'D#', sol: '레#', midi: 3, nat: false },
  { alpha: 'Eb', sol: '미b', midi: 3, nat: false },
  { alpha: 'F#', sol: '파#', midi: 6, nat: false },
  { alpha: 'Gb', sol: '솔b', midi: 6, nat: false },
  { alpha: 'G#', sol: '솔#', midi: 8, nat: false },
  { alpha: 'Ab', sol: '라b', midi: 8, nat: false },
  { alpha: 'A#', sol: '라#', midi: 10, nat: false },
  { alpha: 'Bb', sol: '시b', midi: 10, nat: false }
];

const state = {
  mode: null,
  circleIdx: 0,
  showAllOctaves: false,
  highlightHalfSteps: true,
  selectedInlay: 5,
  quizType: 'findFret', // 'findFret' | 'identifyNote'
  quizTarget: { s: 2, f: 8 },
  quizResult: null, // null | true | false
  quizFeedback: '지판에서 위치를 터치하세요',
  quizStreak: 0,
  solfegeDir: 'mix',
  includeAcc: false,
  solfegeQuestion: SOLFEGE_ITEMS[0],
  isAlphaPrompt: true,
  solfegeOptions: [],
  solfegeAnswered: false,
  solfegeStreak: 0
};

function noteAt(s, f) {
  return NOTES[(OPEN_STRINGS[s] + f) % 12];
}

function getPrimaryVerticalPath(targetNote) {
  const path = [];
  for (let s = 0; s < 6; s++) {
    for (let f = 0; f < 12; f++) {
      if (noteAt(s, f) === targetNote) {
        path.push({ s, f });
        break;
      }
    }
  }
  return path;
}

// ==========================================
// 3. 화면 전환 라우팅
// ==========================================
function goHome() {
  state.mode = null;
  document.getElementById('home-view').style.display = 'block';
  document.getElementById('training-view').style.display = 'none';
  document.getElementById('solfege-view').style.display = 'none';
  document.getElementById('btn-back').style.display = 'none';
  document.getElementById('header-title').textContent = '지판 입체 시각화 트레이너';
}

function openMode(mode) {
  state.mode = mode;
  document.getElementById('home-view').style.display = 'none';
  document.getElementById('btn-back').style.display = 'inline-block';

  const titles = {
    octave: '1. 옥타브 도형 시각화',
    natural: '2. 자연음 랜드마크',
    inlay: '3. 인레이 세로줄 기준',
    quiz: '4. 지판 인출 퀴즈',
    solfege: '5. 계이름 ↔ 알파벳'
  };
  document.getElementById('header-title').textContent = titles[mode];

  if (mode === 'solfege') {
    document.getElementById('training-view').style.display = 'none';
    document.getElementById('solfege-view').style.display = 'flex';
    generateSolfegeQuiz();
  } else {
    document.getElementById('solfege-view').style.display = 'none';
    document.getElementById('training-view').style.display = 'flex';
    if (mode === 'quiz') generateFretQuiz();
    renderAll();
  }
}

// ==========================================
// 4. SVG 기타 지판 렌더링 (원형 도트 인레이)
// ==========================================
function renderFretboard() {
  const svg = document.getElementById('fretboard-svg');
  const W = 760, H = 250;
  const leftMargin = 34, topMargin = 24, nutW = 12;
  const boardW = W - leftMargin - nutW;
  const boardH = H - topMargin;
  const fretW = boardW / 12;
  const strSpacing = boardH / 6;

  const pt = (s, f) => {
    const row = 5 - s;
    const y = topMargin + strSpacing * (row + 0.5);
    const x = f === 0 ? leftMargin + nutW * 0.5 : leftMargin + nutW + fretW * (f - 0.5);
    return { x, y };
  };

  let html = `
    <defs>
      <linearGradient id="woodGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#3d261c"/>
        <stop offset="100%" stop-color="#2b1914"/>
      </linearGradient>
    </defs>
    <!-- 로즈우드 지판 -->
    <rect x="${leftMargin}" y="${topMargin}" width="${boardW + nutW}" height="${boardH}" rx="10" fill="url(#woodGrad)" />
    <!-- 0프렛 너트 -->
    <rect x="${leftMargin}" y="${topMargin}" width="${nutW}" height="${boardH}" fill="#ede6d1" />
  `;

  // 원형 도트 인레이 (3, 5, 7, 9 단일 점 / 12 더블 도트)
  INLAY_FRETS.forEach(f => {
    const cx = leftMargin + nutW + fretW * (f - 0.5);
    if (f === 12) {
      html += `<circle cx="${cx}" cy="${topMargin + boardH * (2/6)}" r="7" fill="rgba(255,255,255,0.28)" />`;
      html += `<circle cx="${cx}" cy="${topMargin + boardH * (4/6)}" r="7" fill="rgba(255,255,255,0.28)" />`;
    } else {
      html += `<circle cx="${cx}" cy="${topMargin + boardH * 0.5}" r="7" fill="rgba(255,255,255,0.22)" />`;
    }
  });

  // 프렛 와이어 및 번호
  for (let f = 0; f <= 12; f++) {
    const lineX = f === 0 ? leftMargin + nutW : leftMargin + nutW + fretW * f;
    if (f > 0) {
      html += `<line x1="${lineX}" y1="${topMargin}" x2="${lineX}" y2="${H}" stroke="rgba(200,200,200,0.65)" stroke-width="2" />`;
    }
    const labelX = f === 0 ? leftMargin + nutW * 0.5 : leftMargin + nutW + fretW * (f - 0.5);
    const isInlay = INLAY_FRETS.includes(f);
    html += `<text x="${labelX}" y="15" text-anchor="middle" font-size="11" font-weight="700" fill="${isInlay ? '#f3f4f6' : '#9ca3af'}">${f}</text>`;
  }

  // 기타 줄 및 줄 번호
  for (let s = 0; s < 6; s++) {
    const row = 5 - s;
    const y = topMargin + strSpacing * (row + 0.5);
    const thick = (6 - s) * 0.45 + 0.9;
    html += `<text x="15" y="${y + 4}" text-anchor="middle" font-size="11" font-weight="700" fill="#9ca3af">${6 - s}번</text>`;
    html += `<line x1="${leftMargin}" y1="${y}" x2="${W}" y2="${y}" stroke="#cbd5e1" stroke-width="${thick}" stroke-opacity="0.85" />`;
  }

  // 모드별 오버레이 (옥타브 연결선 / 인레이 세로 박스)
  const targetNote = CIRCLE_OF_FOURTHS[state.circleIdx];
  const primaryPath = getPrimaryVerticalPath(targetNote);

  if (state.mode === 'octave') {
    const pts = primaryPath.map(p => {
      const c = pt(p.s, p.f);
      return `${c.x},${c.y}`;
    }).join(' ');
    html += `<polyline points="${pts}" fill="none" stroke="#f97316" stroke-width="3.5" stroke-dasharray="6,4" stroke-linecap="round" stroke-linejoin="round" opacity="0.9" />`;
  }

  if (state.mode === 'inlay') {
    const colX = leftMargin + nutW + fretW * (state.selectedInlay - 1) + 4;
    html += `<rect x="${colX}" y="${topMargin + 4}" width="${fretW - 8}" height="${boardH - 8}" rx="8" fill="rgba(59,130,246,0.18)" stroke="#3b82f6" stroke-width="2.5" />`;
  }

  // 각 프렛 노드
  for (let s = 0; s < 6; s++) {
    for (let f = 0; f <= 12; f++) {
      const c = pt(s, f);
      const n = noteAt(s, f);

      if (state.mode === 'octave') {
        const isPrimary = primaryPath.some(p => p.s === s && p.f === f);
        const isMatch = (n === targetNote);
        if (isPrimary || (state.showAllOctaves && isMatch)) {
          const fill = isPrimary ? '#f97316' : 'rgba(249,115,22,0.55)';
          html += `
            <g class="note-node" onclick="onTapFret(${s}, ${f})">
              <circle cx="${c.x}" cy="${c.y}" r="13" fill="${fill}" />
              <text x="${c.x}" y="${c.y + 4}" text-anchor="middle" font-size="11" font-weight="800" fill="#fff">${n}</text>
            </g>`;
        } else {
          html += `<circle class="note-node" cx="${c.x}" cy="${c.y}" r="11" fill="rgba(255,255,255,0.06)" onclick="onTapFret(${s}, ${f})" />`;
        }
      } else if (state.mode === 'natural') {
        if (NATURAL_NOTES.has(n)) {
          const isHalf = state.highlightHalfSteps && (n === 'E' || n === 'B');
          const fill = isHalf ? '#34d399' : '#f8fafc';
          html += `
            <g class="note-node" onclick="onTapFret(${s}, ${f})">
              <circle cx="${c.x}" cy="${c.y}" r="12.5" fill="${fill}" />
              <text x="${c.x}" y="${c.y + 4}" text-anchor="middle" font-size="11" font-weight="800" fill="#111827">${n}</text>
            </g>`;
        } else {
          html += `<circle class="note-node" cx="${c.x}" cy="${c.y}" r="11" fill="transparent" onclick="onTapFret(${s}, ${f})" />`;
        }
      } else if (state.mode === 'inlay') {
        if (f === state.selectedInlay) {
          html += `
            <g class="note-node" onclick="onTapFret(${s}, ${f})">
              <circle cx="${c.x}" cy="${c.y}" r="13" fill="#3b82f6" />
              <text x="${c.x}" y="${c.y + 4}" text-anchor="middle" font-size="11" font-weight="800" fill="#fff">${n}</text>
            </g>`;
        } else {
          html += `<circle class="note-node" cx="${c.x}" cy="${c.y}" r="11" fill="rgba(255,255,255,0.05)" onclick="onTapFret(${s}, ${f})" />`;
        }
      } else if (state.mode === 'quiz') {
        const isTarget = (state.quizTarget.s === s && state.quizTarget.f === f);
        if (state.quizType === 'identifyNote' && isTarget) {
          const fill = state.quizResult === true ? '#22c55e' : '#eab308';
          const label = state.quizResult === true ? n : '?';
          html += `
            <g class="note-node" onclick="onTapFret(${s}, ${f})">
              <circle cx="${c.x}" cy="${c.y}" r="14" fill="${fill}" />
              <text x="${c.x}" y="${c.y + 4}" text-anchor="middle" font-size="12" font-weight="900" fill="#111827">${label}</text>
            </g>`;
        } else if (state.quizType === 'findFret' && state.quizResult === true && isTarget) {
          html += `
            <g class="note-node" onclick="onTapFret(${s}, ${f})">
              <circle cx="${c.x}" cy="${c.y}" r="14" fill="#22c55e" />
              <text x="${c.x}" y="${c.y + 4}" text-anchor="middle" font-size="11" font-weight="800" fill="#fff">${n}</text>
            </g>`;
        } else {
          html += `<circle class="note-node" cx="${c.x}" cy="${c.y}" r="13" fill="rgba(255,255,255,0.08)" onclick="onTapFret(${s}, ${f})" />`;
        }
      }
    }
  }

  svg.innerHTML = html;
}

// ==========================================
// 5. 우측 콤팩트 컨트롤 패널 렌더링
// ==========================================
function renderControlPanel() {
  const panel = document.getElementById('control-panel');

  if (state.mode === 'octave') {
    const note = CIRCLE_OF_FOURTHS[state.circleIdx];
    const chips = CIRCLE_OF_FOURTHS.map((n, idx) =>
      `<button class="chip-btn ${idx === state.circleIdx ? 'active-orange' : ''}" onclick="setCircleIdx(${idx})">${n}</button>`
    ).join('');

    panel.innerHTML = `
      <div class="row-between">
        <button class="btn" onclick="stepCircle(-1)">◀</button>
        <div>
          <div class="sub-label">${state.circleIdx + 1}/12</div>
          <div class="big-note">${note}</div>
        </div>
        <button class="btn btn-primary" onclick="stepCircle(1)">▶</button>
      </div>
      <button class="btn btn-outline-orange" onclick="playOctaveArp()">▶ 수직 옥타브 듣기</button>
      <div class="grid-4">${chips}</div>
      <label class="toggle-row">
        <span>12프렛 중복 표시</span>
        <input type="checkbox" ${state.showAllOctaves ? 'checked' : ''} onchange="toggleAllOctaves(this.checked)" />
      </label>
    `;
  } else if (state.mode === 'natural') {
    panel.innerHTML = `
      <label class="toggle-row" style="font-weight:700;">
        <span>E-F / B-C 반음 강조</span>
        <input type="checkbox" ${state.highlightHalfSteps ? 'checked' : ''} onchange="toggleHalfSteps(this.checked)" />
      </label>
      <div style="font-size:12px; color:var(--muted); line-height:1.5;">
        • 7개 자연음(흰건반) 압정을 먼저 고정하세요.<br/>
        • 임시표(#/b)는 자연음에서 좌우 1칸만 이동하면 됩니다.<br/>
        • 각 점을 누르면 실제 소리가 납니다.
      </div>
    `;
  } else if (state.mode === 'inlay') {
    const frets = [3, 5, 7, 12];
    const btns = frets.map(f =>
      `<button class="chip-btn ${state.selectedInlay === f ? 'active-blue' : ''}" style="padding:9px 0;" onclick="setInlay(${f})">${f}프렛</button>`
    ).join('');
    const seq = [0, 1, 2, 3, 4, 5].map(s => noteAt(s, state.selectedInlay)).join(' - ');

    panel.innerHTML = `
      <div class="grid-2">${btns}</div>
      <div style="margin-top:6px; text-align:center;">
        <div class="sub-label">6번 → 1번 줄 배열</div>
        <div style="font-size:15px; font-weight:800; color:var(--blue); margin-top:4px;">${seq}</div>
      </div>
    `;
  } else if (state.mode === 'quiz') {
    const targetNote = noteAt(state.quizTarget.s, state.quizTarget.f);
    const strNum = 6 - state.quizTarget.s;
    const promptText = state.quizType === 'findFret'
      ? `${strNum}번 줄 [ ${targetNote} ]`
      : `${strNum}번 줄 ${state.quizTarget.f}프렛 <button class="btn" style="padding:2px 6px;" onclick="soundEngine.pluckString(${state.quizTarget.s}, ${state.quizTarget.f})">🔊</button>`;

    const fbClass = state.quizResult === true ? 'ok' : (state.quizResult === false ? 'err' : '');
    const noteBtns = state.quizType === 'identifyNote'
      ? `<div class="grid-4">${NOTES.map(n => `<button class="chip-btn" onclick="checkQuizNote('${n}')">${n}</button>`).join('')}</div>`
      : '';

    panel.innerHTML = `
      <div class="grid-2">
        <button class="chip-btn ${state.quizType === 'findFret' ? 'active-blue' : ''}" onclick="setQuizType('findFret')">음 → 프렛</button>
        <button class="chip-btn ${state.quizType === 'identifyNote' ? 'active-blue' : ''}" onclick="setQuizType('identifyNote')">프렛 → 음</button>
      </div>
      <div class="row-between">
        <span class="sub-label">연속 정답</span>
        <span class="badge-streak">${state.quizStreak}🔥</span>
      </div>
      <div class="quiz-prompt">${promptText}</div>
      <div class="quiz-feedback ${fbClass}">${state.quizFeedback}</div>
      ${noteBtns}
      <button class="btn" style="width:100%;" onclick="generateFretQuiz()">↻ 건너뛰기</button>
    `;
  }
}

function renderAll() {
  renderFretboard();
  renderControlPanel();
}

// ==========================================
// 6. 인터랙션 핸들러 (모드 1~4)
// ==========================================
function stepCircle(delta) {
  state.circleIdx = (state.circleIdx + delta + 12) % 12;
  renderAll();
}

function setCircleIdx(idx) {
  state.circleIdx = idx;
  renderAll();
}

function playOctaveArp() {
  const path = getPrimaryVerticalPath(CIRCLE_OF_FOURTHS[state.circleIdx]);
  soundEngine.playArpeggio(path, 220);
}

function toggleAllOctaves(val) {
  state.showAllOctaves = val;
  renderFretboard();
}

function toggleHalfSteps(val) {
  state.highlightHalfSteps = val;
  renderFretboard();
}

function setInlay(f) {
  state.selectedInlay = f;
  renderAll();
}

function setQuizType(type) {
  state.quizType = type;
  generateFretQuiz();
}

function generateFretQuiz() {
  state.quizTarget = {
    s: Math.floor(Math.random() * 6),
    f: Math.floor(Math.random() * 12) + 1
  };
  state.quizResult = null;
  if (state.quizType === 'findFret') {
    state.quizFeedback = '지판에서 위치를 터치하세요';
  } else {
    state.quizFeedback = '아래 음 이름을 선택하세요';
    soundEngine.pluckString(state.quizTarget.s, state.quizTarget.f);
  }
  renderAll();
}

function onTapFret(s, f) {
  soundEngine.pluckString(s, f);
  if (state.mode !== 'quiz' || state.quizType !== 'findFret' || state.quizResult !== null) return;

  const targetNote = noteAt(state.quizTarget.s, state.quizTarget.f);
  const tappedNote = noteAt(s, f);

  if (s === state.quizTarget.s && tappedNote === targetNote) {
    state.quizResult = true;
    state.quizStreak += 1;
    state.quizFeedback = `정답! ${6 - s}번줄 ${f}F = ${targetNote}`;
    renderAll();
    setTimeout(generateFretQuiz, 850);
  } else {
    state.quizResult = false;
    state.quizStreak = 0;
    state.quizFeedback = `오답! 여기는 ${6 - s}번줄 ${f}F (${tappedNote})`;
    renderAll();
    setTimeout(() => {
      state.quizResult = null;
      renderAll();
    }, 900);
  }
}

function checkQuizNote(chosenNote) {
  if (state.quizResult !== null) return;
  const correctNote = noteAt(state.quizTarget.s, state.quizTarget.f);
  if (chosenNote === correctNote) {
    state.quizResult = true;
    state.quizStreak += 1;
    state.quizFeedback = `정답! ${correctNote}`;
    soundEngine.pluckString(state.quizTarget.s, state.quizTarget.f);
    renderAll();
    setTimeout(generateFretQuiz, 850);
  } else {
    state.quizResult = false;
    state.quizStreak = 0;
    state.quizFeedback = `오답! ${chosenNote}이 아닙니다`;
    renderAll();
    setTimeout(() => {
      state.quizResult = null;
      renderAll();
    }, 900);
  }
}

// ==========================================
// 7. 계이름 ↔ 알파벳 4지선다 퀴즈 (모드 5)
// ==========================================
function setSolfegeDir(dir) {
  state.solfegeDir = dir;
  document.querySelectorAll('#solfege-dir-group .seg-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.dir === dir);
  });
  generateSolfegeQuiz();
}

function toggleAccidentals() {
  state.includeAcc = !state.includeAcc;
  const btn = document.getElementById('btn-accidental');
  btn.textContent = `임시표(#/b): ${state.includeAcc ? 'ON' : 'OFF'}`;
  btn.classList.toggle('btn-primary', state.includeAcc);
  generateSolfegeQuiz();
}

function replaySolfegeSound() {
  soundEngine.pluckMidi(60 + state.solfegeQuestion.midi);
}

function generateSolfegeQuiz() {
  const pool = state.includeAcc ? SOLFEGE_ITEMS : SOLFEGE_ITEMS.filter(i => i.nat);
  const candidates = pool.filter(i => i.alpha !== state.solfegeQuestion.alpha);
  const q = candidates[Math.floor(Math.random() * candidates.length)];

  if (state.solfegeDir === 'a2s') state.isAlphaPrompt = true;
  else if (state.solfegeDir === 's2a') state.isAlphaPrompt = false;
  else state.isAlphaPrompt = Math.random() < 0.5;

  const qDisp = state.isAlphaPrompt ? q.sol : q.alpha;
  const distractors = [];
  const shuffled = [...pool].sort(() => Math.random() - 0.5);

  for (const item of shuffled) {
    const disp = state.isAlphaPrompt ? item.sol : item.alpha;
    if (disp !== qDisp && !distractors.some(d => (state.isAlphaPrompt ? d.sol : d.alpha) === disp)) {
      distractors.push(item);
    }
    if (distractors.length === 3) break;
  }

  state.solfegeQuestion = q;
  state.solfegeOptions = [q, ...distractors].sort(() => Math.random() - 0.5);
  state.solfegeAnswered = false;

  document.getElementById('solfege-prompt-label').textContent =
    state.isAlphaPrompt ? '이 알파벳의 계이름은?' : '이 계이름의 알파벳은?';
  const qEl = document.getElementById('solfege-question-text');
  qEl.textContent = state.isAlphaPrompt ? q.alpha : q.sol;
  qEl.style.color = state.isAlphaPrompt ? 'var(--orange)' : 'var(--blue)';

  const fb = document.getElementById('solfege-feedback');
  fb.textContent = '1초 안에 바로 골라보세요!';
  fb.className = 'quiz-feedback';

  const optContainer = document.getElementById('solfege-options');
  optContainer.innerHTML = state.solfegeOptions.map((opt, idx) => {
    const label = state.isAlphaPrompt ? opt.sol : opt.alpha;
    return `<button class="opt-btn" id="opt-${idx}" onclick="checkSolfege(${idx})">${label}</button>`;
  }).join('');

  soundEngine.pluckMidi(60 + q.midi);
}

function checkSolfege(idx) {
  if (state.solfegeAnswered) return;
  state.solfegeAnswered = true;

  const chosen = state.solfegeOptions[idx];
  const q = state.solfegeQuestion;
  const fb = document.getElementById('solfege-feedback');

  if (chosen === q) {
    state.solfegeStreak += 1;
    document.getElementById(`opt-${idx}`).classList.add('correct');
    fb.textContent = `정답! ${q.alpha} = ${q.sol}`;
    fb.className = 'quiz-feedback ok';
    soundEngine.pluckMidi(60 + q.midi);
  } else {
    state.solfegeStreak = 0;
    document.getElementById(`opt-${idx}`).classList.add('wrong');
    const ansIdx = state.solfegeOptions.findIndex(o => o === q);
    if (ansIdx >= 0) document.getElementById(`opt-${ansIdx}`).classList.add('correct');
    const ansText = state.isAlphaPrompt ? q.sol : q.alpha;
    fb.textContent = `오답! 정답: [ ${ansText} ]`;
    fb.className = 'quiz-feedback err';
    soundEngine.pluckMidi(60 + chosen.midi);
  }

  document.getElementById('solfege-streak').textContent = `${state.solfegeStreak}🔥`;
  setTimeout(generateSolfegeQuiz, chosen === q ? 750 : 1150);
}
