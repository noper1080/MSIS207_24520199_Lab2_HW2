import type { Track } from '../types'

// Synthetic WAV files in public/tracks. The last entry points to a missing
// file on purpose so the error + retry path can be tested.
export const tracks: Track[] = [
  {
    id: 'rising-sweep',
    title: 'Rising Sweep',
    url: '/tracks/rising-sweep.wav',
  },
  { id: 'major-chord', title: 'Major Chord', url: '/tracks/major-chord.wav' },
  { id: 'arpeggio', title: 'Arpeggio', url: '/tracks/arpeggio.wav' },
  { id: 'pulse-beat', title: 'Pulse Beat', url: '/tracks/pulse-beat.wav' },
  { id: 'broken', title: 'Broken Track', url: '/tracks/missing.wav' },
]
