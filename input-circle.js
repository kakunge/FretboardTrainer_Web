const circleInput = {
  device: document.getElementById('input-circle-device'),
  channel: document.getElementById('input-circle-channel'),
  sensitivity: document.getElementById('input-circle-sensitivity'),
  toggle: document.getElementById('input-circle-toggle'),
  progress: document.getElementById('input-circle-progress'),
  target: document.getElementById('input-circle-target'),
  detected: document.getElementById('input-circle-detected'),
  feedback: document.getElementById('input-circle-feedback'),
  step: 0,
  matches: 0,
  attackUntil: -Infinity,
  session: null
};

function renderInputCircle() {
  const total = CIRCLE_OF_FOURTHS.length;
  circleInput.progress.textContent = `진행 ${circleInput.step} / ${total}`;
  circleInput.target.textContent = CIRCLE_OF_FOURTHS[circleInput.step] ?? '한 바퀴 완료!';
}

function resetInputCircle() {
  circleInput.step = 0;
  circleInput.matches = 0;
  circleInput.attackUntil = -Infinity;
  circleInput.detected.textContent = '감지한 음 · —';
  circleInput.feedback.textContent = circleInput.session?.stream
    ? 'C를 피킹하세요.'
    : '입력 시작을 눌러 기타 신호를 연결하세요.';
  renderInputCircle();
}

function stopCircleInput() {
  const session = circleInput.session;
  circleInput.session = null;
  circleInput.matches = 0;
  circleInput.attackUntil = -Infinity;
  if (session) {
    cancelAnimationFrame(session.frame);
    session.stream?.getTracks().forEach(track => track.stop());
    if (session.context.state !== 'closed') {
      session.context.close().catch(() => {});
    }
  }
  circleInput.toggle.textContent = '입력 시작';
}

async function refreshCircleDevices(media, session) {
  try {
    const devices = await media.enumerateDevices();
    if (circleInput.session !== session) return;
    const previous = circleInput.device.value;
    const options = devices.filter(device => device.kind === 'audioinput' && device.deviceId);
    circleInput.device.replaceChildren(new Option('시스템 기본 입력', ''), ...options.map(
      (device, index) => new Option(device.label || `오디오 입력 ${index + 1}`, device.deviceId)
    ));
    if (options.some(device => device.deviceId === previous)) circleInput.device.value = previous;
  } catch {
    // The system default remains available if device enumeration fails.
  }
}

async function startCircleInput() {
  const media = navigator.mediaDevices;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!media?.getUserMedia || !AudioCtx) {
    circleInput.feedback.textContent = '오디오 입력을 지원하는 브라우저에서 HTTPS 또는 localhost로 열어 주세요.';
    return;
  }

  let session;
  try {
    session = { context: new AudioCtx() };
    circleInput.session = session;
    circleInput.toggle.textContent = '입력 취소';
    circleInput.feedback.textContent = '오디오 입력 권한을 기다리는 중…';
    circleInput.detected.textContent = '감지한 음 · —';
    const deviceId = circleInput.device.value;
    const stream = await media.getUserMedia({
      video: false,
      audio: {
        ...(deviceId && { deviceId: { exact: deviceId } }),
        channelCount: { ideal: 2 },
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    });
    if (circleInput.session !== session) {
      stream.getTracks().forEach(track => track.stop());
      return;
    }

    session.stream = stream;
    const track = stream.getAudioTracks()[0];
    track.addEventListener('ended', () => {
      if (circleInput.session !== session) return;
      stopCircleInput();
      circleInput.feedback.textContent = '오디오 입력 연결이 끊겼습니다. 장치를 확인한 뒤 다시 시작하세요.';
    });

    const { context } = session;
    const source = context.createMediaStreamSource(stream);
    const splitter = context.createChannelSplitter(2);
    source.connect(splitter);
    const analysers = [0, 1].map(channel => {
      const analyser = context.createAnalyser();
      analyser.fftSize = 8192;
      splitter.connect(analyser, channel);
      return analyser;
    });
    const samples = new Float32Array(8192);
    const pitchSamples = samples.subarray(samples.length - 4096);
    const reduced = new Float32Array(pitchSamples.length / 4);
    const differences = new Float32Array(Math.ceil(context.sampleRate / 4 / 65) + 1);
    await context.resume();
    if (circleInput.session !== session) return;

    circleInput.toggle.textContent = '입력 중지';
    circleInput.feedback.textContent = '목표음을 한 음씩 피킹하세요.';
    refreshCircleDevices(media, session);
    let lastRead = -Infinity;
    function listen(now) {
      if (now - lastRead >= 27) {
        lastRead = now;
        analysers[Number(circleInput.channel.value)].getFloatTimeDomainData(samples);
        const threshold = Number(circleInput.sensitivity.value);
        if (hasCircleAttack(samples, context.sampleRate, threshold)) {
          circleInput.attackUntil = now + 230;
          circleInput.matches = 0;
        }
        const midi = detectCirclePitch(pitchSamples, reduced, differences, context.sampleRate);
        checkCirclePitch(midi, now);
      }
      if (circleInput.session === session) session.frame = requestAnimationFrame(listen);
    }
    session.frame = requestAnimationFrame(listen);
  } catch (error) {
    if (circleInput.session !== (session ?? null)) return;
    stopCircleInput();
    circleInput.feedback.textContent = error.name === 'NotAllowedError'
      ? '브라우저에서 오디오 입력 권한을 허용한 뒤 다시 시작하세요.'
      : '오디오 입력을 열 수 없습니다. 장치 연결과 입력 설정을 확인하세요.';
  }
}

function hasCircleAttack(samples, sampleRate, threshold) {
  const blockSize = Math.round(sampleRate * 0.005);
  const recentBlocks = Math.min(10, Math.floor(samples.length / blockSize) - 3);
  const start = samples.length - (recentBlocks + 3) * blockSize;
  if (recentBlocks < 1) return false;

  // Compare each 5 ms block with the preceding 15 ms of input.
  const energy = [0];
  for (let i = start; i < samples.length; i += blockSize) {
    let power = 0;
    for (let j = i; j < i + blockSize; j++) power += samples[j] * samples[j];
    energy.push(energy[energy.length - 1] + power);
  }
  for (let i = 3; i <= recentBlocks + 2; i++) {
    const level = Math.sqrt((energy[i + 1] - energy[i]) / blockSize);
    const baseline = Math.sqrt((energy[i] - energy[i - 3]) / (3 * blockSize));
    if (level >= threshold && level - baseline >= threshold * 0.6 && level >= baseline * 1.8) return true;
  }
  return false;
}

// YIN pitch detection using a cumulative mean normalized difference.
function detectCirclePitch(samples, reduced, differences, sampleRate) {
  let power = 0;
  for (let i = 0; i < reduced.length; i++) {
    const offset = i * 4;
    const value = (samples[offset] + samples[offset + 1] + samples[offset + 2] + samples[offset + 3]) / 4;
    reduced[i] = value;
    power += value * value;
  }
  if (power / reduced.length < 0.000001) return null;

  const rate = sampleRate / 4;
  const maxLag = Math.min(differences.length - 1, Math.floor(reduced.length / 2));
  const minLag = Math.max(2, Math.floor(rate / 1400));
  const windowLength = reduced.length - maxLag;
  let total = 0;
  for (let lag = 1; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i < windowLength; i++) {
      const delta = reduced[i] - reduced[i + lag];
      sum += delta * delta;
    }
    total += sum;
    differences[lag] = total > 0 ? sum * lag / total : 1;
  }

  for (let lag = minLag; lag < maxLag; lag++) {
    if (differences[lag] >= 0.15) continue;
    while (lag < maxLag && differences[lag + 1] < differences[lag]) lag++;
    const before = differences[lag - 1];
    const middle = differences[lag];
    const after = lag < maxLag ? differences[lag + 1] : middle;
    const curvature = before + after - 2 * middle;
    const period = lag + (curvature > 0 ? (before - after) / (2 * curvature) : 0);
    return 69 + 12 * Math.log2(rate / period / 440);
  }
  return null;
}

function checkCirclePitch(midi, now) {
  const nearest = Math.round(midi);
  const note = midi === null ? null : NOTES[((nearest % 12) + 12) % 12];
  circleInput.detected.textContent = note
    ? `감지한 음 · ${note}${Math.floor(nearest / 12) - 1}`
    : '감지한 음 · —';

  const target = CIRCLE_OF_FOURTHS[circleInput.step];
  const inTune = midi !== null && note === target && Math.abs(midi - nearest) <= 0.45;
  circleInput.matches = inTune && now <= circleInput.attackUntil ? circleInput.matches + 1 : 0;
  if (circleInput.matches < 3) return;

  circleInput.matches = 0;
  circleInput.attackUntil = -Infinity;
  circleInput.step++;
  renderInputCircle();
  if (circleInput.step === CIRCLE_OF_FOURTHS.length) {
    stopCircleInput();
    circleInput.feedback.textContent = `${target} 정답! 12음을 모두 연주했습니다.`;
    return;
  }
  circleInput.feedback.textContent = `${target} 정답! 다음은 ${CIRCLE_OF_FOURTHS[circleInput.step]}입니다.`;
}

circleInput.toggle.addEventListener('click', () => {
  if (circleInput.session) {
    stopCircleInput();
    circleInput.feedback.textContent = '입력을 중지했습니다.';
    circleInput.detected.textContent = '감지한 음 · —';
    return;
  }
  if (circleInput.step === CIRCLE_OF_FOURTHS.length) resetInputCircle();
  startCircleInput();
});

circleInput.device.addEventListener('change', () => {
  if (!circleInput.session) return;
  stopCircleInput();
  startCircleInput();
});
circleInput.channel.addEventListener('change', () => {
  circleInput.matches = 0;
  circleInput.attackUntil = -Infinity;
  circleInput.detected.textContent = '감지한 음 · —';
});
circleInput.sensitivity.addEventListener('change', () => {
  circleInput.matches = 0;
  circleInput.attackUntil = -Infinity;
});
const showCircleDetected = document.getElementById('input-circle-show-detected');
function updateCircleDetectedVisibility() {
  circleInput.detected.hidden = !showCircleDetected.checked;
}
showCircleDetected.addEventListener('change', updateCircleDetectedVisibility);
updateCircleDetectedVisibility();

const showCircleLandmarks = document.getElementById('input-circle-show-landmarks');
function updateCircleLandmarks() {
  document.getElementById('input-circle-landmarks').hidden = !showCircleLandmarks.checked;
  if (showCircleLandmarks.checked) {
    renderFretboard(document.getElementById('input-circle-landmarks-svg'), 'natural');
  }
}
showCircleLandmarks.addEventListener('change', updateCircleLandmarks);

document.getElementById('input-circle-reset').addEventListener('click', resetInputCircle);
window.addEventListener('pagehide', () => {
  if (circleInput.session) {
    stopCircleInput();
    circleInput.detected.textContent = '감지한 음 · —';
    circleInput.feedback.textContent = '입력 시작을 눌러 연습을 이어가세요.';
  }
});
