import PlayerControls from './components/PlayerControls'
import TrackList from './components/TrackList'
import Visualizer from './components/Visualizer'
import { tracks } from './data/tracks'
import { useAudioPlayer } from './hooks/useAudioPlayer'

function App() {
  const player = useAudioPlayer(tracks)
  const { state } = player
  const currentTrack =
    state.status === 'idle'
      ? undefined
      : tracks.find((track) => track.id === state.trackId)

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      <header>
        <h1>Audio Visualizer Queue</h1>
      </header>
      <main id="main" tabIndex={-1}>
        <PlayerControls
          state={state}
          trackTitle={currentTrack?.title ?? null}
          onPause={player.pause}
          onResume={player.resume}
          onRetry={player.retry}
        />
        <Visualizer
          analyser={player.analyser}
          active={state.status === 'playing'}
        />
        <TrackList tracks={tracks} state={state} onSelect={player.select} />
      </main>
    </>
  )
}

export default App
