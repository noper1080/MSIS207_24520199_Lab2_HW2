export type Track = {
  id: string
  title: string
  url: string
}

// Mutually exclusive player states: every state except idle belongs to one track.
export type PlayerState =
  | { status: 'idle' }
  | { status: 'loading'; trackId: string }
  | { status: 'playing'; trackId: string }
  | { status: 'paused'; trackId: string }
  | { status: 'error'; trackId: string; message: string }

export type PlayerEvent =
  | { type: 'SELECT'; trackId: string }
  | { type: 'LOADED'; trackId: string }
  | { type: 'FAILED'; trackId: string; message: string }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'ENDED' }
  | { type: 'RETRY' }

// One pending download + decode job inside the FIFO queue.
export type AudioTask = {
  trackUrl: string
  controller: AbortController
  resolve: (buffer: AudioBuffer) => void
  reject: (reason: unknown) => void
}
