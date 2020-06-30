const minPlaybackRate = 0.35;
const maxPlaybackRate = 1 / minPlaybackRate;
const minIntraTime = 0.175;

var canvas = document.getElementById("c");
var textArea = document.getElementById("ta");
var thresholdSlider = document.getElementById("threshold");
var adjSpeedSlider = document.getElementById("adj-speed");
var smoothSlider = document.getElementById("smooth");
var targetBpmSlider = document.getElementById("target-bpm");
var audioCtx = new AudioContext();
var gfxCtx = canvas.getContext("2d");
var srcNode = audioCtx.createBufferSource();
var filter1 = audioCtx.createBiquadFilter();
filter1.frequency.value = 150;
filter1.Q.value = 1;
filter1.type = "lowpass";
srcNode.connect(filter1);
var filter2 = audioCtx.createBiquadFilter();
filter2.frequency.value = 100;
filter2.Q.value = 1;
filter2.type = "highpass";
filter1.connect(filter2);

var analyzer = audioCtx.createAnalyser();
analyzer.fftSize = 256;
analyzer.smoothingTimeConstant = 0.1;
filter2.connect(analyzer);

srcNode.connect(audioCtx.destination);
var data = new Uint8Array(analyzer.fftSize);

var peakRingBuffer = new CBuffer(500);
var bpmRingBuffer = new CBuffer(300);
var peakIndex = 0;
let currentBpm = 0;

function getPopFreq(array) {
  const counter = {};
  array.forEach((a) => (counter[a] = (counter[a] || 0) + 1));
  return counter;
}

function rms(arr) {
  const sum = arr.map((val) => val * val).reduce((acum, val) => acum + val);
  return Math.sqrt(sum / arr.length);
}

function average(arr) {
  const sum = arr.reduce((acum, val) => acum + val, 0);
  return sum / arr.length;
}

function getLookbackY(value, max) {
  return 500 - (value / max) * 500;
}

function analyzeLookback(lookback, minBpm, maxBpm) {
  const lookbackValues = lookback.map((v) => v.value);
  const max = Math.max.apply(null, lookbackValues);
  const threshold = max * thresholdSlider.valueAsNumber;
  //average(lookbackValues);

  var inPeak = false;
  var lastPeakEnd = -1;
  var peakSamples = [];
  var barW = Math.ceil(Math.max(1, canvas.width / lookback.length));
  gfxCtx.strokeStyle = "blue";
  gfxCtx.lineWidth = 1;
  var thresholdLineY = Math.round(getLookbackY(threshold, max)) + 0.5;
  gfxCtx.beginPath();
  gfxCtx.moveTo(0, thresholdLineY);
  gfxCtx.lineTo(canvas.width, thresholdLineY);
  gfxCtx.stroke();

  for (let i = 0; i < lookback.length; i++) {
    const sample = lookback[i];
    const peaky = sample.value > threshold;
    let ch = " ";
    if (peaky) {
      if (!inPeak) {
        if (sample.time - lastPeakEnd < minIntraTime) {
          ch = "x";
        } else {
          peakSamples.push(sample);
          inPeak = true;
          ch = "!";
        }
      } else {
        ch = ".";
      }
    } else {
      if (inPeak) {
        inPeak = false;
        lastPeakEnd = sample.time;
        ch = "-";
      }
    }
    // const textLine = `${sample.index} ${sample.value.toFixed(2)} ${peaky ? '!' : '.'} ${ch} ${"#".repeat(30 * sample.value)}`;
    // peakTextLines.push(textLine);

    switch (ch) {
      case "!":
        gfxCtx.fillStyle = "red";
        break;
      case ".":
        gfxCtx.fillStyle = "yellow";
        break;
      case "x":
        gfxCtx.fillStyle = "silver";
        break;
      default:
        gfxCtx.fillStyle = "rgba(255,255,255,0.5)";
        break;
    }
    const barY = 500 - getLookbackY(sample.value, max);
    gfxCtx.fillRect(i * barW, 500 - barY, barW, 500);
  }
  const intraPeakTimes = [];
  for (let i = 1; i < peakSamples.length; i++) {
    const intraTime = peakSamples[i].time - peakSamples[i - 1].time;
    if (intraTime > minIntraTime) {
      intraPeakTimes.push(intraTime);
    }
  }
  const intraPeakBPM = intraPeakTimes.map((t) => {
    let guessedBpm = 60 / t;
    if (guessedBpm < minBpm) {
      while (guessedBpm < minBpm) {
        guessedBpm *= 2;
      }
    } else {
      while (guessedBpm > maxBpm) {
        guessedBpm /= 2;
      }
    }
    return Math.round(guessedBpm);
  });
  // logBuffer += JSON.stringify(intraPeakTimes) + "\n";
  logBuffer += JSON.stringify(intraPeakBPM) + "\n";
  // + "\n" + peakTextLines.slice(10).join("\n");
  return intraPeakBPM;
}

var logBuffer = "";

function clamp(val, min, max) {
  if (val < min) return min;
  if (val > max) return max;
  return val;
}

function getPeak(data) {
  var nBinsUse = 5;
  var peakSum = 0;
  var lowpassMul = 0.2;
  for (var i = 0; i < nBinsUse; i++) {
    var binIndex = Math.floor((i / nBinsUse) * (data.length * lowpassMul));
    var level = data[binIndex] / 255;
    peakSum += level;
    gfxCtx.fillStyle = "red";
    gfxCtx.fillRect(0, i * 10, level * 400, 9);
  }

  peakSum /= nBinsUse;
  // peakSum *= 2; // TODO: Autotune this modifier
  peakSum = Math.pow(peakSum, 3);
  // peakSum = Math.min(peakSum, 1);
  return peakSum;
}

function loop() {
  const targetBpm = targetBpmSlider.valueAsNumber || 110;
  const minBpm = Math.round(Math.max(75, targetBpm / 2));
  const maxBpm = Math.round(Math.min(210, targetBpm * 2));
  logBuffer = "";
  gfxCtx.clearRect(0, 0, canvas.width, canvas.height);
  analyzer.getByteFrequencyData(data);
  const peakSum = getPeak(data);
  peakRingBuffer.push({
    index: peakIndex++,
    time: audioCtx.currentTime,
    value: peakSum,
  });
  const lookbackLength = 128;
  const lookback = peakRingBuffer.slice(
    peakRingBuffer.length - lookbackLength,
    peakRingBuffer.length
  );
  const bpmGuesses = analyzeLookback(lookback, minBpm, maxBpm);
  bpmGuesses.forEach((bpm) => bpmRingBuffer.push(bpm));
  if (bpmRingBuffer.length) {
    const bpmPop = Object.entries(getPopFreq(bpmRingBuffer)).sort(
      (a, b) => b[1] - a[1]
    );
    const mostLikelyBpm = parseInt(bpmPop[0][0]);
    if (!currentBpm) {
      currentBpm = mostLikelyBpm;
    } else {
      const smoothingFactor = smoothSlider.valueAsNumber;
      currentBpm =
        (currentBpm * (smoothingFactor - 1) + mostLikelyBpm) / smoothingFactor;
    }
    //const correction = bpmPid.update(currentBpm);
    // srcNode.playbackRate.value = Math.round(targetBpm / currentBpm * 100) / 100;
    let playbackRate = srcNode.playbackRate.value;
    if (Math.abs(currentBpm - targetBpm) > 1) {
      const finalAdjSpeed = 0.0001 * adjSpeedSlider.valueAsNumber;
      playbackRate += finalAdjSpeed * (currentBpm > targetBpm ? -1 : 1);
    }
    srcNode.playbackRate.value = clamp(
      playbackRate,
      minPlaybackRate,
      maxPlaybackRate
    );

    logBuffer += `
Most likely current BPM: ${mostLikelyBpm} (range ${minBpm}..${maxBpm})
Smoothed current BPM: ${currentBpm.toFixed(2)}
Target BPM: ${targetBpm}
Target drift: ${(currentBpm / targetBpm - 1).toFixed(3)}
Playback Rate: ${playbackRate.toFixed(3)}
`;
  }
  textArea.value = logBuffer;
}

function setGoDisabled(flag) {
  document.getElementById("go-button").disabled = flag;
}

function defaultInit() {
  var url = "./07%20-%20The%20Rurals%20-%20Sweeter%20Sound.mp3";
  fetch(url)
    .then((r) => r.arrayBuffer())
    .then(async (arrBuf) => {
      srcNode.buffer = await audioCtx.decodeAudioData(arrBuf);

      setGoDisabled(false);
    });
}

function loadFile(file) {
  if (!file) return;
  const fr = new FileReader();
  setGoDisabled(true);
  fr.readAsArrayBuffer(file);
  fr.onload = async () => {
    srcNode.buffer = await audioCtx.decodeAudioData(fr.result);
    setGoDisabled(false);
  };
}

// defaultInit();

var started = false;

function go() {
  if (started) return;
  setInterval(loop, 1000 / 60);
  audioCtx.resume();
  srcNode.start();
  started = true;
}
