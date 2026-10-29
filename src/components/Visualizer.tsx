import { useEffect, useRef } from 'react'

const WIDTH = 640
const HEIGHT = 240

type VisualizerProps = {
  analyser: AnalyserNode | null
  active: boolean
}

// Draws frequency bars straight to the canvas on every animation frame.
// No React state changes per frame: the loop only touches the canvas.
function Visualizer({ analyser, active }: VisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    ctx.clearRect(0, 0, WIDTH, HEIGHT)
    if (!analyser || !active) return

    const bins = new Uint8Array(analyser.frequencyBinCount)
    const barWidth = WIDTH / bins.length
    // Bar color comes from the CSS token applied to the canvas `color`.
    ctx.fillStyle = getComputedStyle(canvas).color

    let rafId = 0
    const draw = () => {
      analyser.getByteFrequencyData(bins)
      ctx.clearRect(0, 0, WIDTH, HEIGHT)
      for (let i = 0; i < bins.length; i++) {
        const barHeight = (bins[i] / 255) * HEIGHT
        ctx.fillRect(i * barWidth, HEIGHT - barHeight, barWidth - 1, barHeight)
      }
      rafId = requestAnimationFrame(draw)
    }
    rafId = requestAnimationFrame(draw)

    return () => cancelAnimationFrame(rafId)
  }, [analyser, active])

  return (
    <canvas
      ref={canvasRef}
      width={WIDTH}
      height={HEIGHT}
      role="img"
      aria-label="Frequency bars of the current track"
    />
  )
}

export default Visualizer
