export const FFT_SIZE = 256

export type AudioEngine = {
  ctx: AudioContext
  analyser: AnalyserNode
  play: (buffer: AudioBuffer, onEnded: () => void) => void
  stopCurrent: () => void
  pause: () => Promise<void>
  resume: () => Promise<void>
  dispose: () => Promise<void>
}

// Must be called from a user gesture (click) so the browser allows audio.
// Graph: AudioBufferSourceNode -> AnalyserNode -> destination.
export function createAudioEngine(): AudioEngine {
  const ctx = new AudioContext()
  const analyser = ctx.createAnalyser()
  analyser.fftSize = FFT_SIZE
  analyser.connect(ctx.destination)

  let current: AudioBufferSourceNode | null = null

  function stopCurrent(): void {
    const source = current
    if (!source) return
    current = null
    source.onended = null
    try {
      source.stop()
    } catch {
      // Already stopped: stop() throws if called twice.
    }
    source.disconnect()
  }

  function play(buffer: AudioBuffer, onEnded: () => void): void {
    stopCurrent()
    // A new track selected while paused needs the context running again.
    if (ctx.state === 'suspended') void ctx.resume()

    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(analyser)
    source.onended = () => {
      // Only the source that is still current may report the end of a track.
      if (current !== source) return
      current = null
      source.disconnect()
      onEnded()
    }
    current = source
    source.start()
  }

  return {
    ctx,
    analyser,
    play,
    stopCurrent,
    pause: () => ctx.suspend(),
    resume: () => ctx.resume(),
    dispose: async () => {
      stopCurrent()
      analyser.disconnect()
      await ctx.close()
    },
  }
}
