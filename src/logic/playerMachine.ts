import type { PlayerEvent, PlayerState } from '../types'

export const initialPlayerState: PlayerState = { status: 'idle' }

// Pure state machine. Illegal transitions return the same state object,
// so React skips the re-render and callers can detect "rejected" by identity.
export function transition(
  state: PlayerState,
  event: PlayerEvent,
): PlayerState {
  switch (event.type) {
    case 'SELECT':
      // Re-selecting the track that is already active does nothing.
      if (
        (state.status === 'loading' ||
          state.status === 'playing' ||
          state.status === 'paused') &&
        state.trackId === event.trackId
      ) {
        return state
      }
      return { status: 'loading', trackId: event.trackId }

    case 'LOADED':
      // A late result for an older selection must never overwrite the current one.
      if (state.status === 'loading' && state.trackId === event.trackId) {
        return { status: 'playing', trackId: state.trackId }
      }
      return state

    case 'FAILED':
      if (state.status === 'loading' && state.trackId === event.trackId) {
        return {
          status: 'error',
          trackId: state.trackId,
          message: event.message,
        }
      }
      return state

    case 'PAUSE':
      if (state.status === 'playing') {
        return { status: 'paused', trackId: state.trackId }
      }
      return state

    case 'RESUME':
      if (state.status === 'paused') {
        return { status: 'playing', trackId: state.trackId }
      }
      return state

    case 'ENDED':
      if (state.status === 'playing') {
        return { status: 'idle' }
      }
      return state

    case 'RETRY':
      if (state.status === 'error') {
        return { status: 'loading', trackId: state.trackId }
      }
      return state

    default: {
      const unhandled: never = event
      return unhandled
    }
  }
}
