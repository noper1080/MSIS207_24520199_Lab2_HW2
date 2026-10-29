import type { PlayerState, Track } from '../types'

type TrackListProps = {
  tracks: Track[]
  state: PlayerState
  onSelect: (trackId: string) => void
}

const STATUS_LABEL = {
  loading: 'Loading',
  playing: 'Playing',
  paused: 'Paused',
  error: 'Error',
} as const

function TrackList({ tracks, state, onSelect }: TrackListProps) {
  const currentId = state.status === 'idle' ? null : state.trackId

  return (
    <section aria-labelledby="tracks-heading">
      <h2 id="tracks-heading">Tracks</h2>
      <ul>
        {tracks.map((track) => (
          <li key={track.id}>
            <button
              type="button"
              aria-pressed={track.id === currentId}
              onClick={() => onSelect(track.id)}
            >
              {track.title}
              {/* Text marker so the current track is not shown by color alone. */}
              {state.status !== 'idle' && track.id === currentId && (
                <span> {STATUS_LABEL[state.status]}</span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default TrackList
