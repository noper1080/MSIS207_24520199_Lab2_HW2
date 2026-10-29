import type { PlayerState, Track } from '../types'

type TrackListProps = {
  tracks: Track[]
  state: PlayerState
  onSelect: (trackId: string) => void
}

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
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default TrackList
