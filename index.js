let midiData = [];

function convertPTToMIDIData(ptResponse) {
  const scalarMap = {
    pitch:    'midinote',
    time:     'time',
    duration: 'duration',
    velocity: 'velocity'
  };

  // root → [ { time?, midinote?, … }, … ]
  const notesByRoot = new Map();

  ptResponse.forEach(({ feature_path, data }) => {
    const parts  = feature_path.split('/').filter(Boolean);
    if (parts.length < 2) return;
    const root   = parts[0];
    const scalar = parts[parts.length - 1];
    const field  = scalarMap[scalar];
    if (!field) return;

    if (!notesByRoot.has(root)) notesByRoot.set(root, []);
    const arr = notesByRoot.get(root);

    data.forEach((val, i) => {
      if (!arr[i]) arr[i] = {};
      arr[i][field] = val;
    });
  });

  // flatten into real notes
  const result = [];
  let trackIndex = 0;
  for (let [root, arr] of notesByRoot) {
    arr.forEach(entry => {
      if (entry.midinote != null && entry.time != null) {
        result.push({
          type:      'note',
          trackIndex,
          channel:   trackIndex % 16,
          midinote:  entry.midinote,
          time:      entry.time,
          duration:  entry.duration != null ? entry.duration : 1,
          velocity:  entry.velocity != null ? entry.velocity : 80
        });
      }
    });
    trackIndex++;
  }
  return result;
}


function downloadMIDI(data) {
    // Type 1 SMF — multi-track
    let smf = JZZ.MIDI.SMF(1, 960);
    
    // Create conductor track (track 0)
    let conductor = new JZZ.MIDI.SMF.MTrk();
    smf.push(conductor);
    conductor.add(0, JZZ.MIDI.smfSeqName('PTtoMIDI'));

    // Collect all tracks by trackIndex
    const trackMap = new Map();

    for (let note of data) {
        if (note.type === "note") {
            if (!trackMap.has(note.trackIndex)) {
                const newTrk = new JZZ.MIDI.SMF.MTrk();
                smf.push(newTrk);
                trackMap.set(note.trackIndex, newTrk);
                newTrk.add(0, JZZ.MIDI.smfInstrName(`Instrument ${note.trackIndex + 1}`));
                if (note.channel !== undefined && note.program !== undefined) {
                    newTrk.add(0, JZZ.MIDI.program(note.channel, note.program));
                }
            }
        }
    }

    // Write events
    for (let note of data) {
        let tick = Math.round(960 * note.time / 4);

        if (note.type === "tempo") {
            conductor.add(tick, JZZ.MIDI.smfBPM(note.bpm));
        }
        else if (note.type === "timeSig") {
            conductor.add(tick, JZZ.MIDI.smfTimeSignature(note.numerator, note.denominator));
        }
        else if (note.type === "keySig") {
            conductor.add(tick, JZZ.MIDI.smfKeySignature(note.key));
        }
        else if (note.type === "text") {
            conductor.add(tick, JZZ.MIDI.smfText(note.text));
        }
        else if (note.type === "note") {
            const trk = trackMap.get(note.trackIndex);
            const velocity = note.velocity ?? 80;
            const channel = note.channel ?? 0;
            const duration = Math.round(960 * note.duration / 4);
            trk.add(tick, JZZ.MIDI.noteOn(channel, note.midinote, velocity));
            trk.add(tick + duration, JZZ.MIDI.noteOff(channel, note.midinote));
        }
    }

    // Add EndOfTrack to all tracks
    for (let trk of smf) {
        trk.add(0, JZZ.MIDI.smfEndOfTrack());
    }

    // Export
    const str = smf.dump();
    const b64 = JZZ.lib.toBase64(str);
    const uri = 'data:audio/midi;base64,' + b64;
    const link = document.createElement('a');
    link.href = uri;
    link.download = 'PTtoMIDI.mid';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}




function getMIDIuri(data){ // time / midinote / duration / velocity 
    // Type 1 SMF — multi-track
    let smf = JZZ.MIDI.SMF(1, 960);
    
    // Create conductor track (track 0)
    let conductor = new JZZ.MIDI.SMF.MTrk();
    smf.push(conductor);
    conductor.add(0, JZZ.MIDI.smfSeqName('PTtoMIDI'));

    // Collect all tracks by trackIndex
    const trackMap = new Map();

    for (let note of data) {
        if (note.type === "note") {
            if (!trackMap.has(note.trackIndex)) {
                const newTrk = new JZZ.MIDI.SMF.MTrk();
                smf.push(newTrk);
                trackMap.set(note.trackIndex, newTrk);
                newTrk.add(0, JZZ.MIDI.smfInstrName(`Instrument ${note.trackIndex + 1}`));
                if (note.channel !== undefined && note.program !== undefined) {
                    newTrk.add(0, JZZ.MIDI.program(note.channel, note.program));
                }
            }
        }
    }

    // Write events
    for (let note of data) {
        let tick = Math.round(960 * note.time / 4);

        if (note.type === "tempo") {
            conductor.add(tick, JZZ.MIDI.smfBPM(note.bpm));
        }
        else if (note.type === "timeSig") {
            conductor.add(tick, JZZ.MIDI.smfTimeSignature(note.numerator, note.denominator));
        }
        else if (note.type === "keySig") {
            conductor.add(tick, JZZ.MIDI.smfKeySignature(note.key));
        }
        else if (note.type === "text") {
            conductor.add(tick, JZZ.MIDI.smfText(note.text));
        }
        else if (note.type === "note") {
            const trk = trackMap.get(note.trackIndex);
            const velocity = note.velocity ?? 80;
            const channel = note.channel ?? 0;
            const duration = Math.round(960 * note.duration / 4);
            trk.add(tick, JZZ.MIDI.noteOn(channel, note.midinote, velocity));
            trk.add(tick + duration, JZZ.MIDI.noteOff(channel, note.midinote));
        }
    }

    // Add EndOfTrack to all tracks
    for (let trk of smf) {
        trk.add(0, JZZ.MIDI.smfEndOfTrack());
    }

    // Export
    const str = smf.dump();
    const b64 = JZZ.lib.toBase64(str);
    const uri = 'data:audio/midi;base64,' + b64;
    return uri;
}


// Function to load and display the generated MIDI file
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


/* function convertSoundsToMidiNotes(array) {

	var allPitchesInRange = [
		"G3", "G#3", "Ab3", "A3", "A#3", "Bb3", "B3", 
		"C4", "C#4", "Db4", "D4", "D#4", "Eb4", "E4", "F4", "F#4", "Gb4", "G4", "G#4", "Ab4", "A4", "A#4", "Bb4", "B4",
		"C5", "C#5", "Db5", "D5", "D#5", "Eb5", "E5", "F5", "F#5", "Gb5", "G5", "G#5", "Ab5", "A5", "A#5", "Bb5", "B5",
		"C6", "C#6", "Db6", "D6", "D#6", "Eb6", "E6",
		"F6", "F#6", "Gb6", "G6", "G#6", "Ab6", "A6", "A#6", "Bb6", "B6", "C7"
	];
	
	var midiNotes = [
		55, 56, 56, 57, 58, 58, 59, 
		60, 61, 61, 62, 63, 63, 64, 65, 66, 66, 67, 68, 68, 69, 70, 70, 71,
		72, 73, 73, 74, 75, 75, 76, 77, 78, 78, 79, 80, 80, 81, 82, 82, 83,
		84, 85, 85, 86, 87, 87, 88,
		89, 90, 90, 91, 92, 92, 93, 94, 94, 95, 96
	];	

    // Create a mapping between pitches and MIDI notes
    var pitchToMidiNote = {};
    allPitchesInRange.forEach((pitch, index) => {
        pitchToMidiNote[pitch] = midiNotes[index];
    });

    // Use map to convert frequencies to MIDI notes and replace the frequency with midiNote in each object
    return array.map(obj => ({
        ...obj,
        midinote: pitchToMidiNote[obj.frequency], // Add the MIDI note
        // Remove the frequency property by destructuring it out and capturing the rest of the properties with 'rest'
    })).map(({ frequency, ...rest }) => rest);
} */


/* let data = [
    { type: "tempo", time: 0, bpm: 120 },
    { type: "timeSig", time: 0, numerator: 4, denominator: 4 },
    { time: 0, midinote: 60, duration: 1, velocity: 90 },
    { time: 1, midinote: 62, duration: 1 },
    { time: 2, midinote: 64, duration: 1 },
    { time: 3, midinote: 68, duration: 1 },
    { type: "timeSig", time: 4, numerator: 3, denominator: 4 },
    { time: 4, midinote: 64, duration: 1 },
    { time: 5, midinote: 65, duration: 1 },
    { time: 6, midinote: 67, duration: 1 }
]; */

/* let data = [
    { type: "tempo", time: 0, bpm: 120 },
    { type: "timeSig", time: 0, numerator: 4, denominator: 4 },
    { type: "note", trackIndex: 0, channel: 0, time: 0, midinote: 60, duration: 8 },
    { type: "note", trackIndex: 1, channel: 1, time: 1, midinote: 65, duration: 7 },
    { type: "note", trackIndex: 2, channel: 2, time: 2, midinote: 67, duration: 6}
]; */
  

// Fetch PT API response
const ptInput = document.getElementById('pt-input');

function updateFromTextarea() {
  try {
    const parsed = JSON.parse(ptInput.value);
    midiData = convertPTToMIDIData(parsed);
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

/* const ptResponse = [
    { feature_path: "siema/test0/pitch",    data: [60, 61, 62, 63] },
    { feature_path: "siema/test0/time",     data: [ 0,  0,  0,  0] },
    { feature_path: "siema/test0/duration", data: [ 4,  4,  4,  4] },
    { feature_path: "siema/test0/velocity", data: [80, 85, 90, 95] },

    { feature_path: "siema/test1/pitch",    data: [72, 73, 74, 75] },
    { feature_path: "siema/test1/time",     data: [ 4,  4,  4,  4] },
    { feature_path: "siema/test1/duration", data: [ 4,  4,  4,  4] },
    { feature_path: "siema/test1/velocity", data: [80, 85, 90, 95] },

    { feature_path: "/textureA/pitch", data: [72, 73, 74]    },
    { feature_path: "/textureA/time",  data: [ 0,  1,  2]    },
    { feature_path: "/textureA/duration", data: [1,1,1]     }
]; */
