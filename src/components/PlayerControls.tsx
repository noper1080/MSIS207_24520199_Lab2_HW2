import type { PlayerState } from '../types'

type PlayerControlsProps = {
  state: PlayerState
  trackTitle: string | null
  onPause: () => void
  onResume: () => void
  onRetry: () => void
}

function describeState(state: PlayerState, title: string | null): string {
  switch (state.status) {
    case 'idle':
      return 'Select a track to start.'
    case 'loading':
      return `Loading ${title}…`
    case 'playing':
      return `Playing ${title}`
    case 'paused':
      return `Paused ${title}`
    case 'error':
      return `Could not play ${title}`
  }
}

function PlayerControls({
  state,
  trackTitle,
  onPause,
  onResume,
  onRetry,
}: PlayerControlsProps) {
  const isPlaying = state.status === 'playing'
  const canToggle = isPlaying || state.status === 'paused'

  return (
    <section aria-labelledby="player-heading">
      <h2 id="player-heading">Now playing</h2>
      <p>{describeState(state, trackTitle)}</p>
      {state.status === 'error' ? (
        <>
          <p>{state.message}</p>
          <button type="button" onClick={onRetry}>
            Retry
          </button>
        </>
      ) : (
        <button
          type="button"
          disabled={!canToggle}
          onClick={isPlaying ? onPause : onResume}
        >
          {isPlaying ? 'Pause' : 'Resume'}
        </button>
      )}
    </section>
  )
}

export default PlayerControls
