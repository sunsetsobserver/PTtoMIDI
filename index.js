let midiData = [];

function convertPTToMIDIData(ptResponse) {

  const groups = {};
  ptResponse.forEach(({ feature_path, data }) => {
    const parts = feature_path.split('/').filter(Boolean);
    if (parts.length < 2) return;
    const prefix = parts.slice(0, -1).join('/');
    const scalar = parts.at(-1);
    (groups[prefix] ||= {})[scalar] = data;
  });

  const events = [];
  let   track  = 0;

  // Helper: deduplicate successive identical metre changes
  function pushTimeSig(t, num, den) {
    const last = events.at(-1);
    if (!(last && last.type === 'timeSig' &&
          last.time === t && last.numerator === num && last.denominator === den)) {
      events.push({ type:'timeSig', time:t, numerator:num, denominator:den });
    }
  }

  // We also need, per *root*, a list of candidate time arrays
  const rootTimePools = {};  // root → [ { time, dur?, vel? }, … ]

  // First pass: metre buckets & time-array pools
  Object.entries(groups).forEach(([prefix, g]) => {
    const root = prefix.split('/')[0];

    // pool non-metre timelines for later note pairing
    if (Array.isArray(g.time) && !g.numerator)
      (rootTimePools[root] ||= []).push(g);

    // metre bucket?
    if (g.numerator && g.denominator && g.time) {
      g.time.forEach((t, i) =>
        pushTimeSig(t, g.numerator[i], g.denominator[i]));
    }
  });

  // Second pass: note buckets
  Object.entries(groups).forEach(([prefix, g]) => {
    if (!g.pitch) return;                       // not a note bucket
    const root = prefix.split('/')[0];

    // choose a matching time array
    let tArr = g.time;
    let dArr = g.duration;
    let vArr = g.velocity;

    if (!tArr) {
      const match = (rootTimePools[root] || [])
        .find(p => p.time.length === g.pitch.length);
      if (!match) {
        console.warn(`No matching time[] for pitch bucket ${prefix}; skipped.`);
        return;
      }
      tArr = match.time;
      dArr = dArr || match.duration;
      vArr = vArr || match.velocity;
    }

    // emit notes
    tArr.forEach((t, i) => events.push({
      type:       'note',
      trackIndex: track,
      channel:    track % 16,
      midinote:   g.pitch[i],
      time:       t,
      duration:   dArr?.[i] ?? 1,
      velocity:   vArr?.[i] ?? 80
    }));
    track++;
  });

  /* ── 3. Guarantee defaults at t = 0 ──────────────────────── */
  if (!events.some(e => e.type === 'tempo'))
    events.push({ type:'tempo',  time:0, bpm:120 });

  if (!events.some(e => e.type === 'timeSig'))
    events.push({ type:'timeSig', time:0, numerator:4, denominator:4 });

  /* ── 4. Sort (time ↑, then tempo → timeSig → note) ───────── */
  const order = { tempo:0, timeSig:1, note:2 };
  events.sort((a, b) => a.time - b.time || order[a.type] - order[b.type]);

  return events;
}

function downloadMIDI(data) {
  const PPQ = 960;
  // 1) Create a new Type-1 SMF
  const smf       = JZZ.MIDI.SMF(1, PPQ);
  // --- conductor track (track 0) ---
  const conductor = new JZZ.MIDI.SMF.MTrk();
  smf.push(conductor);
  conductor.add(0, JZZ.MIDI.smfSeqName('PTtoMIDI'));

  // 2) Build a map of note-tracks
  const trackMap  = new Map(); // trackIndex → MTrk
  let   maxTick   = 0;

  // First, create one MTrk per trackIndex you actually use
  data.forEach(evt => {
    if (evt.type === 'note' && !trackMap.has(evt.trackIndex)) {
      const trk = new JZZ.MIDI.SMF.MTrk();
      smf.push(trk);
      // (optional) name the track
      trk.add(0, JZZ.MIDI.smfInstrName(`Instrument ${evt.trackIndex+1}`));
      trackMap.set(evt.trackIndex, trk);
    }
  });

  // 3) Dump all events in absolute‐time order
  //    (tempo/timeSig go to conductor; notes to their tracks)
  //    We assume you've already sorted `data` by evt.time ascending.
  data.forEach(evt => {
    const tick = Math.round(PPQ * evt.time / 4);
    maxTick = Math.max(maxTick, tick);

    if (evt.type === 'tempo') {
      conductor.add(tick, JZZ.MIDI.smfBPM(evt.bpm));
    }
    else if (evt.type === 'timeSig') {
      conductor.add(tick, JZZ.MIDI.smfTimeSignature(evt.numerator, evt.denominator));
    }
    else if (evt.type === 'keySig') {
      conductor.add(tick, JZZ.MIDI.smfKeySignature(evt.key));
    }
    else if (evt.type === 'text') {
      conductor.add(tick, JZZ.MIDI.smfText(evt.text));
    }
    else if (evt.type === 'note') {
      const trk    = trackMap.get(evt.trackIndex);
      const absOn  = tick;
      // ← FIXED: calculate absolute Off‐time as time+duration
      const absOff = Math.round(PPQ * (evt.time + evt.duration) / 4);
      maxTick = Math.max(maxTick, absOff);

      // noteOn at absOn
      trk.add(absOn,  JZZ.MIDI.noteOn (evt.channel, evt.midinote, evt.velocity));
      // noteOff at absOff (must include velocity = 0)
      trk.add(absOff, JZZ.MIDI.noteOff(evt.channel, evt.midinote, 0));
    }
  });

  // 4) Add EndOfTrack at maxTick+1 on every track
  conductor.add(maxTick + 1, JZZ.MIDI.smfEndOfTrack());
  for (let trk of smf) {
    if (trk !== conductor) {
      trk.add(maxTick + 1, JZZ.MIDI.smfEndOfTrack());
    }
  }

  // 5) Export as a downloadable .mid
  const b64  = JZZ.lib.toBase64(smf.dump());
  const uri  = 'data:audio/midi;base64,' + b64;
  const link = document.createElement('a');
  link.href     = uri;
  link.download = 'PTtoMIDI.mid';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/** Build a data-URI for the same MIDI, for the browser visualizer. */
function getMIDIuri(data) {
  const PPQ = 960;
  const smf = JZZ.MIDI.SMF(1, PPQ);
  const conductor = new JZZ.MIDI.SMF.MTrk();
  smf.push(conductor);
  conductor.add(0, JZZ.MIDI.smfSeqName('PTtoMIDI'));

  const trackMap = new Map();
  let maxTick = 0;

  data.forEach(evt => {
    if (evt.type === 'note' && !trackMap.has(evt.trackIndex)) {
      const trk = new JZZ.MIDI.SMF.MTrk();
      smf.push(trk);
      trk.add(0, JZZ.MIDI.smfInstrName(`Instrument ${evt.trackIndex+1}`));
      trackMap.set(evt.trackIndex, trk);
    }
  });

  data.forEach(evt => {
    const tick = Math.round(PPQ * evt.time / 4);
    maxTick = Math.max(maxTick, tick);

    if (evt.type === 'tempo') {
      conductor.add(tick, JZZ.MIDI.smfBPM(evt.bpm));
    }
    else if (evt.type === 'timeSig') {
      conductor.add(tick, JZZ.MIDI.smfTimeSignature(evt.numerator, evt.denominator));
    }
    else if (evt.type === 'note') {
      const trk    = trackMap.get(evt.trackIndex);
      const absOn  = tick;
      const absOff = Math.round(PPQ * (evt.time + evt.duration) / 4);
      maxTick = Math.max(maxTick, absOff);

      trk.add(absOn,  JZZ.MIDI.noteOn (evt.channel, evt.midinote, evt.velocity));
      trk.add(absOff, JZZ.MIDI.noteOff(evt.channel, evt.midinote, 0));
    }
  });

  conductor.add(maxTick + 1, JZZ.MIDI.smfEndOfTrack());
  for (let trk of smf) {
    if (trk !== conductor) {
      trk.add(maxTick + 1, JZZ.MIDI.smfEndOfTrack());
    }
  }

  return 'data:audio/midi;base64,' + JZZ.lib.toBase64(smf.dump());
}

function loadGeneratedMidiFile(midiFileUri) {
	// Convert the data URI to a Blob
	const byteCharacters = atob(midiFileUri.split(',')[1]);
	const byteNumbers = new Array(byteCharacters.length);
	for (let i = 0; i < byteCharacters.length; i++) {
	  byteNumbers[i] = byteCharacters.charCodeAt(i);
	}
	const byteArray = new Uint8Array(byteNumbers);
	const midiBlob = new Blob([byteArray], { type: 'audio/midi' });
  
	// Create a URL from the Blob
	const midiUrl = URL.createObjectURL(midiBlob);
  
	// Load the MIDI file into the player and visualizer
	document.querySelector('midi-player').src = midiUrl;
	document.querySelectorAll('midi-visualizer').forEach((visualizer) => {
	  visualizer.src = midiUrl;
	});
}

// Fetch PT API response
const ptInput = document.getElementById('pt-input');

function updateFromTextarea() {
  try {
    const parsed = JSON.parse(ptInput.value);
    midiData = convertPTToMIDIData(parsed);
    console.log(midiData);
    const uri = getMIDIuri(midiData);
    loadGeneratedMidiFile(uri);
  } catch (err) {
    console.warn('PT JSON invalid:', err);
  }
}

// re-generate on every edit:
ptInput.addEventListener('input', updateFromTextarea);

// initial render:
window.addEventListener('DOMContentLoaded', updateFromTextarea);

// make download use the latest midiData
document.getElementById("download_midi").addEventListener("click", () => downloadMIDI(midiData));
