import { useEffect, useReducer, useRef, useState } from 'react'
import { AudioTaskQueue, isAbortError } from '../audio/audio-queue-controller'
import { createAudioEngine, type AudioEngine } from '../audio/audioEngine'
import { initialPlayerState, transition } from '../logic/playerMachine'
import type { PlayerState, Track } from '../types'

type AudioRuntime = { engine: AudioEngine; queue: AudioTaskQueue }

export type AudioPlayer = {
  state: PlayerState
  analyser: AnalyserNode | null
  select: (trackId: string) => void
  pause: () => void
  resume: () => void
  retry: () => void
}

export function useAudioPlayer(tracks: Track[]): AudioPlayer {
  const [state, dispatch] = useReducer(transition, initialPlayerState)
  // Changes once (when the engine is created), so it is fine as React state.
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null)
  const runtimeRef = useRef<AudioRuntime | null>(null)
  // The most recent selection; a buffer for any other track is never played.
  const latestIdRef = useRef<string | null>(null)

  useEffect(() => {
    return () => {
      const runtime = runtimeRef.current
      runtimeRef.current = null
      runtime?.queue.cancelAll()
      void runtime?.engine.dispose()
    }
  }, [])

  // Called only from click handlers: AudioContext is created/resumed after a user gesture.
  function getRuntime(): AudioRuntime {
    if (!runtimeRef.current) {
      const engine = createAudioEngine()
      runtimeRef.current = { engine, queue: new AudioTaskQueue(engine.ctx) }
      setAnalyser(engine.analyser)
    }
    void runtimeRef.current.engine.resume()
    return runtimeRef.current
  }

  async function load(track: Track): Promise<void> {
    const { engine, queue } = getRuntime()
    latestIdRef.current = track.id
    queue.cancelAll()
    engine.stopCurrent()

    try {
      const buffer = await queue.enqueue(track.url)
      if (latestIdRef.current !== track.id) return
      dispatch({ type: 'LOADED', trackId: track.id })
      engine.play(buffer, () => dispatch({ type: 'ENDED' }))
    } catch (err) {
      if (isAbortError(err)) return
      dispatch({
        type: 'FAILED',
        trackId: track.id,
        message: err instanceof Error ? err.message : 'Unknown error',
      })
    }
  }

  function select(trackId: string): void {
    const track = tracks.find((t) => t.id === trackId)
    if (!track) return
    const isActive =
      (state.status === 'loading' ||
        state.status === 'playing' ||
        state.status === 'paused') &&
      state.trackId === trackId
    if (isActive) return
    dispatch({ type: 'SELECT', trackId })
    void load(track)
  }

  function retry(): void {
    if (state.status !== 'error') return
    const track = tracks.find((t) => t.id === state.trackId)
    if (!track) return
    dispatch({ type: 'RETRY' })
    void load(track)
  }

  function pause(): void {
    if (state.status !== 'playing' || !runtimeRef.current) return
    dispatch({ type: 'PAUSE' })
    void runtimeRef.current.engine.pause()
  }

  function resume(): void {
    if (state.status !== 'paused' || !runtimeRef.current) return
    dispatch({ type: 'RESUME' })
    void runtimeRef.current.engine.resume()
  }

  return { state, analyser, select, pause, resume, retry }
}
