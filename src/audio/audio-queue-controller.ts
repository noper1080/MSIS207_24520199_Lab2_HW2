import type { AudioTask } from '../types'

export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError'
}

// FIFO queue that downloads and decodes one track at a time.
// Every task owns an AbortController so obsolete work can be cancelled.
export class AudioTaskQueue {
  private queue: AudioTask[] = []
  private isProcessing = false
  private activeController: AbortController | null = null
  private readonly ctx: BaseAudioContext

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx
  }

  enqueue(trackUrl: string): Promise<AudioBuffer> {
    const controller = new AbortController()
    return new Promise((resolve, reject) => {
      this.queue.push({ trackUrl, controller, resolve, reject })
      void this.processNext()
    })
  }

  // Abort the running task and reject every waiting task with AbortError.
  cancelAll(): void {
    this.activeController?.abort()
    const pending = this.queue
    this.queue = []
    for (const task of pending) {
      task.controller.abort()
      task.reject(new DOMException('Task cancelled', 'AbortError'))
    }
  }

  private async processNext(): Promise<void> {
    if (this.isProcessing) return
    const task = this.queue.shift()
    if (!task) return

    this.isProcessing = true
    this.activeController = task.controller
    const { signal } = task.controller

    try {
      const response = await fetch(task.trackUrl, { signal })
      if (!response.ok) {
        throw new Error(`Download failed (HTTP ${response.status})`)
      }
      const data = await response.arrayBuffer()
      const buffer = await this.decode(data)
      // decodeAudioData cannot be aborted, so check again once it finishes.
      signal.throwIfAborted()
      task.resolve(buffer)
    } catch (err) {
      task.reject(err)
    } finally {
      this.isProcessing = false
      this.activeController = null
      void this.processNext()
    }
  }

  private async decode(data: ArrayBuffer): Promise<AudioBuffer> {
    try {
      return await this.ctx.decodeAudioData(data)
    } catch {
      throw new Error('Unsupported or corrupt audio file')
    }
  }
}
