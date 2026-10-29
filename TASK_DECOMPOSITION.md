# TASK_DECOMPOSITION.md — HW2: Concurrent FIFO Audio Visualizer Queue Engine

> Tuân thủ `rule-lab2.md`. Tài liệu này được viết **trước** khi prompt AI (§9).
> Mỗi task bên dưới = 1 contract = 1 module độc lập = 1 commit.

---

## 1. Phân tích đề bài

| # | Yêu cầu của đề | Diễn giải kỹ thuật | Cách kiểm chứng |
|---|---|---|---|
| R1 | Web Audio API + `AnalyserNode` (FFT 256/512) | Graph: `AudioBufferSourceNode → AnalyserNode → destination`, `analyser.fftSize = 256` (128 bins) | DevTools: log 1 lần `analyser.frequencyBinCount === 128` khi test, xóa trước commit |
| R2 | FIFO Queue cho download + decode | Class `AudioTaskQueue`: `enqueue(url) → Promise<AudioBuffer>`, xử lý tuần tự (`isProcessing`), mỗi task = `fetch` → `arrayBuffer` → `decodeAudioData` | Click nhanh 3 track, tab Network: request đi theo đúng thứ tự |
| R3 | Hủy task lỗi thời bằng `AbortController` | Khi chọn track mới: abort task đang chạy + reject các task đang chờ; kết quả về muộn **không bao giờ** ghi đè lựa chọn mới hơn | Network throttling "Slow 3G", click A rồi B: request A bị `(canceled)`, chỉ B phát |
| R4 | Memory safety | Mỗi `AudioBufferSourceNode` cũ: `onended = null`, `stop()`, `disconnect()`; mọi effect có cleanup; `AudioContext.resume()` chỉ sau user gesture | Memory tab: đổi track 20 lần, heap snapshot không tăng số `AudioBufferSourceNode` |
| R5 | 60fps visualizer bằng `requestAnimationFrame` | `<canvas>` vẽ trong rAF loop, đọc `getByteFrequencyData` vào `Uint8Array` cấp phát sẵn; **không** `setState` mỗi frame | Performance tab: ~60fps, React Profiler không render lại khi đang phát |

### Giả định (cần xác nhận với giảng viên nếu khác)
1. **Concurrency = 1**: theo skeleton đề cho (`isProcessing`, `activeController`), queue xử lý tuần tự từng task; "simultaneous" nghĩa là người dùng có thể yêu cầu nhiều track cùng lúc và queue phải điều phối chúng.
2. Queue chỉ dùng cho **tải + giải mã**, không phải playlist. Phát xong một bài → về `idle`, không tự chuyển bài.
3. Pause/Resume dùng `audioContext.suspend()` / `resume()` (không cần tạo lại source node).
4. Dữ liệu mẫu: 4–5 file audio ngắn đặt trong `public/tracks/` + **1 URL hỏng** để test trạng thái `error`.
5. Không có seek, volume, shuffle, playlist, upload file — không nằm trong đề (§0).

---

## 2. Hướng giải quyết (tổng quan)

Tách thành **4 lớp độc lập**, mỗi lớp một file để live defense chỉ phải sửa một chỗ (§12):

```
 ┌─────────────── UI (React components – chỉ render) ───────────────┐
 │  TrackList   PlayerControls   StatusRegion(aria-live)   Visualizer│
 └───────────────▲───────────────────────────────────────────▲───────┘
                 │ state, dispatch                            │ analyser (ref)
 ┌───────────────┴──────── useAudioPlayer (hook nối dây) ─────┴───────┐
 │  useReducer(transition) + gọi queue + gọi engine + cleanup        │
 └───────▲──────────────────────────▲───────────────────────▲────────┘
         │ pure                      │ Promise<AudioBuffer>   │ play/stop
 ┌───────┴────────┐   ┌──────────────┴─────────┐   ┌─────────┴────────┐
 │ playerMachine  │   │ AudioTaskQueue (FIFO + │   │ audioEngine      │
 │ transition()   │   │ AbortController)       │   │ ctx/analyser/src │
 └────────────────┘   └────────────────────────┘   └──────────────────┘
       (không phụ thuộc React, không phụ thuộc DOM → test & giải thích riêng)
```

### 2.1. State machine (discriminated union, §5.2, §7)

```ts
type PlayerState =
  | { status: 'idle' }
  | { status: 'loading'; trackId: string }
  | { status: 'playing'; trackId: string }
  | { status: 'paused';  trackId: string }
  | { status: 'error';   trackId: string; message: string };

type PlayerEvent =
  | { type: 'SELECT'; trackId: string }
  | { type: 'LOADED'; trackId: string }
  | { type: 'FAILED'; trackId: string; message: string }
  | { type: 'PAUSE' } | { type: 'RESUME' } | { type: 'ENDED' } | { type: 'RETRY' };
```

**Bảng chuyển trạng thái hợp lệ** (mọi cặp khác = illegal → trả về nguyên `state`):

| Từ | Event | Đến | Ghi chú |
|---|---|---|---|
| `idle` | `SELECT(id)` | `loading(id)` | |
| `loading(a)` | `SELECT(b)` | `loading(b)` | task `a` bị abort |
| `loading(a)` | `LOADED(a)` | `playing(a)` | |
| `loading(a)` | `LOADED(b≠a)` | `loading(a)` (bỏ qua) | **chặn late result** |
| `loading(a)` | `FAILED(a, msg)` | `error(a, msg)` | `AbortError` không bao giờ dispatch `FAILED` |
| `loading(a)` | `FAILED(b≠a)` | `loading(a)` (bỏ qua) | |
| `playing(a)` | `PAUSE` | `paused(a)` | `ctx.suspend()` |
| `paused(a)` | `RESUME` | `playing(a)` | `ctx.resume()` |
| `playing(a)` | `ENDED` | `idle` | |
| `playing/paused(a)` | `SELECT(b)` | `loading(b)` | stop + disconnect source cũ |
| `error(a)` | `RETRY` | `loading(a)` | nút Retry |
| `error(a)` | `SELECT(b)` | `loading(b)` | |

### 2.2. FIFO Queue + hủy task (chống race condition)

- `enqueue(url)` tạo `AbortController` riêng, đẩy `{url, controller, resolve, reject}` vào cuối mảng, gọi `processNext()`.
- `processNext()`: nếu `isProcessing` hoặc queue rỗng → return; ngược lại `shift()` task đầu (FIFO), gán `activeController`, `fetch(url, { signal })` → `arrayBuffer()` → `ctx.decodeAudioData()`.
- `decodeAudioData` **không nhận signal** → sau khi decode xong phải kiểm tra `signal.aborted`; nếu đã abort thì reject `AbortError`, không resolve.
- `finally`: `isProcessing = false`, `activeController = null`, gọi `processNext()`.
- `cancelAll()`: abort task đang chạy + reject mọi task đang chờ bằng `AbortError`, làm rỗng queue. Gọi khi chọn track mới và khi unmount.
- **Hai lớp bảo vệ late result**: (1) abort ở queue, (2) `transition()` bỏ qua `LOADED` có `trackId` khác track đang chọn.

### 2.3. Audio engine & memory safety

- `AudioContext` tạo **lười** trong click handler đầu tiên (user gesture), gọi `resume()` tại đó.
- Một `AnalyserNode` dùng chung, `fftSize = 256`, nối sẵn vào `destination`.
- `play(buffer, onEnded)`: dừng source cũ trước → tạo source mới → `connect(analyser)` → `start()`.
- `stopCurrent()`: `src.onended = null; src.stop(); src.disconnect(); current = null` (bọc `try` vì `stop()` 2 lần sẽ throw).
- `onended` chỉ dispatch `ENDED` nếu source đó vẫn là source hiện tại.
- Unmount: `cancelAll()` + `stopCurrent()` + `ctx.close()`.

### 2.4. Visualizer 60fps không thrash state

- Component `<Visualizer analyser={…} active={…}>` sở hữu `canvasRef`, `rafIdRef`.
- `useEffect`: tạo `Uint8Array(analyser.frequencyBinCount)` **một lần**, vòng `draw()` gọi `getByteFrequencyData` + vẽ cột lên canvas + `requestAnimationFrame(draw)`.
- Cleanup: `cancelAnimationFrame(rafIdRef.current)`.
- React state chỉ đổi ở các sự kiện hiếm (chọn bài, play/pause, lỗi). Màu vẽ đọc từ CSS custom property một lần (`getComputedStyle`), không hardcode hex.
- Canvas có kích thước cố định (`width`/`height` + `aspect-ratio`) để CLS = 0; có `role="img"` + `aria-label` mô tả.

### 2.5. Cấu trúc thư mục dự kiến

```
public/tracks/            # 4–5 file audio ngắn (user tự chuẩn bị, bản quyền tự do)
src/
  types.ts                # Track, PlayerState, PlayerEvent, AudioTask
  data/tracks.ts          # danh sách track mẫu (+1 URL hỏng)
  logic/playerMachine.ts  # transition() thuần
  audio/audio-queue-controller.ts  # AudioTaskQueue
  audio/audioEngine.ts    # AudioContext, analyser, play/stop source
  hooks/useAudioPlayer.ts # nối machine + queue + engine
  components/TrackList.tsx
  components/PlayerControls.tsx
  components/Visualizer.tsx
  App.tsx                 # layout landmarks, skip link, aria-live
  index.css               # reset + :root tokens + layout
```

---

## 3. WBS (Work Breakdown Structure)

```
HW2 Audio Visualizer Queue
├── 1. Khởi tạo
│   ├── T-01 Scaffold Vite + TS strict + ESLint + Prettier
│   └── T-02 Tài liệu đặc tả (file này)
├── 2. Contract
│   └── T-03 Types
├── 3. Logic thuần (không React)
│   ├── T-04 State machine transition()
│   ├── T-05 AudioTaskQueue (FIFO + AbortController)
│   └── T-06 audioEngine (context, analyser, source cleanup)
├── 4. Tích hợp
│   └── T-07 useAudioPlayer hook
├── 5. Giao diện
│   ├── T-08 Dữ liệu mẫu + HTML/JSX semantic
│   ├── T-09 Visualizer canvas rAF
│   ├── T-10 CSS (tokens, mobile-first 375px)
│   └── T-11 Accessibility (aria-live, focus, keyboard)
└── 6. Kiểm chứng
    └── T-12 Kiểm thử thủ công theo kịch bản
```

---

### T-01 — Scaffold dự án
- **Files:** `package.json`, `tsconfig*.json`, `vite.config.ts`, `eslint.config.js`, `.prettierrc`, `index.html`, `.gitignore`
- **Contract:** `npm create vite@latest` (template `react-ts`), `strict: true`; ESLint có `eslint-plugin-react-hooks`; Prettier. Xóa code demo của Vite. `index.html` có `lang="en"` + viewport meta.
- **Acceptance:** `npm run dev`, `npm run lint`, `npx tsc --noEmit` chạy sạch. Không thêm dependency nào khác.
- **Commit:** `chore(setup): scaffold vite react-ts with eslint and prettier`

### T-02 — Đặc tả
- **Files:** `TASK_DECOMPOSITION.md`, `rule-lab2.md`
- **Acceptance:** có bảng transition, contract từng task, WBS.
- **Commit:** `docs(spec): add task decomposition and rules`

### T-03 — Types (contract first)
- **Files:** `src/types.ts`
- **Contract:** `Track { id; title; url }`, `PlayerState`, `PlayerEvent` (mục 2.1), `AudioTask { trackUrl; controller: AbortController; resolve(buf: AudioBuffer): void; reject(err: unknown): void }`.
- **Acceptance:** không `any`; state là discriminated union theo `status`.
- **Commit:** `feat(types): define track, player state machine and audio task types`

### T-04 — State machine
- **Files:** `src/logic/playerMachine.ts`
- **Contract:** `transition(state: PlayerState, event: PlayerEvent): PlayerState` — thuần, không side effect, đúng bảng 2.1; illegal → trả về chính `state` (cùng reference).
- **Acceptance:** kiểm tra bằng tay trong console/ghi chú: `LOADED('a')` khi đang `loading('b')` → không đổi; `PAUSE` khi `idle` → không đổi; `switch` có nhánh `never` để TS bắt thiếu case.
- **Commit:** `feat(state): implement pure player transition function`

### T-05 — AudioTaskQueue
- **Files:** `src/audio/audio-queue-controller.ts`
- **Contract:** `class AudioTaskQueue { constructor(ctx: BaseAudioContext); enqueue(url: string): Promise<AudioBuffer>; cancelAll(): void }`; nội bộ `queue: AudioTask[]`, `isProcessing`, `activeController`, `processNext()` (mục 2.2).
- **Acceptance:** FIFO đúng thứ tự; `cancelAll()` → request đang chạy hiện `(canceled)` ở Network, promise reject `AbortError`; decode xong sau khi abort → vẫn reject; HTTP lỗi (`!res.ok`) → reject `Error` có message đọc được. Không import React.
- **Commit:** `feat(queue): add fifo audio task queue with abort support`

### T-06 — Audio engine
- **Files:** `src/audio/audioEngine.ts`
- **Contract:** `createAudioEngine(): { ctx; analyser; play(buf, onEnded): void; stopCurrent(): void; pause(): Promise<void>; resume(): Promise<void>; dispose(): Promise<void> }`. Gọi lần đầu **trong** click handler. `fftSize = 256`.
- **Acceptance:** đổi track 20 lần → chỉ có tối đa 1 source sống; `onended` của source cũ không dispatch; không có cảnh báo autoplay trong console.
- **Commit:** `feat(audio): add audio engine with analyser and source cleanup`

### T-07 — Hook tích hợp
- **Files:** `src/hooks/useAudioPlayer.ts`
- **Contract:** `useAudioPlayer(): { state; analyser: AnalyserNode | null; select(id); pause(); resume(); retry() }`. Dùng `useReducer(transition)`; engine + queue giữ trong `useRef`; `select`: `cancelAll()` → `stopCurrent()` → dispatch `SELECT` → `enqueue` → dispatch `LOADED`/`FAILED` (bỏ qua `AbortError`) → `play`.
- **Acceptance:** effect unmount gọi `cancelAll` + `dispose`; click A–B–C nhanh trên Slow 3G → chỉ C phát; không có warning hooks.
- **Commit:** `feat(state): wire player machine, queue and engine in hook`

### T-08 — Dữ liệu mẫu + markup
- **Files:** `src/data/tracks.ts`, `src/App.tsx`, `src/components/TrackList.tsx`, `src/components/PlayerControls.tsx`, `public/tracks/*`
- **Contract:** `<header>` (h1) + `<main>`; danh sách `<ul>` các `<button type="button" aria-pressed>`; nút Play/Pause là `<button>`; trạng thái `error` hiển thị message + nút **Retry**; `key={track.id}`; tên track render dạng text.
- **Acceptance:** không `innerHTML`, không `<div onClick>`; thử tên track `<img src=x onerror=alert(1)>` → hiện nguyên chữ.
- **Commit:** `feat(html): add semantic track list and player controls`

### T-09 — Visualizer
- **Files:** `src/components/Visualizer.tsx`
- **Contract:** `Visualizer({ analyser: AnalyserNode | null; active: boolean })` — mục 2.4.
- **Acceptance:** Performance tab ~60fps; React Profiler không ghi render trong lúc phát; chuyển track/unmount → `cancelAnimationFrame` được gọi (không còn loop mồ côi).
- **Commit:** `feat(visualizer): draw frequency bars on canvas via requestAnimationFrame`

### T-10 — CSS
- **Files:** `src/index.css`
- **Contract:** reset theo §4, màu/spacing là custom property trong `:root`, Flex/Grid + `gap`, mobile-first, canvas `width: 100%` + `aspect-ratio`.
- **Acceptance:** 375px không cuộn ngang; contrast chữ ≥ 4.5:1, UI ≥ 3:1; không hex trong rule component; focus luôn thấy được.
- **Commit:** `feat(css): add tokens and mobile-first layout`

### T-11 — Accessibility
- **Files:** `src/App.tsx`, `src/components/*.tsx` (chỉ thuộc tính a11y)
- **Contract:** skip link là phần tử focus đầu tiên; vùng `aria-live="polite"` thông báo "Loading X / Playing X / Paused / Error: …"; track đang phát không chỉ phân biệt bằng màu (thêm chữ/biểu tượng + `aria-pressed`); canvas `role="img"` + `aria-label`.
- **Acceptance:** dùng được hoàn toàn bằng Tab/Enter/Space; Lighthouse Accessibility + Best Practices = 100.
- **Commit:** `feat(a11y): add live region, skip link and focus styles`

### T-12 — Kiểm thử theo kịch bản
- **Files:** (không sửa code; nếu phát hiện lỗi → commit `fix(...)` riêng)

| # | Kịch bản | Kỳ vọng |
|---|---|---|
| K1 | Slow 3G, click A rồi B ngay | A `(canceled)`, chỉ B phát, status = Playing B |
| K2 | Click A, B, C liên tiếp | Chỉ C phát; không có âm thanh chồng |
| K3 | Chọn track URL hỏng | `error` + message + Retry; Retry → `loading` lại |
| K4 | Đổi track 20 lần | Heap snapshot không tích lũy source node / detached canvas |
| K5 | Đang phát | Performance ~60fps, React không re-render mỗi frame |
| K6 | Tải trang chưa click | `AudioContext` chưa tạo, không có warning autoplay |
| K7 | Chỉ dùng bàn phím, viewport 375px | Thao tác đủ, focus luôn thấy, không cuộn ngang |
| K8 | Console | 0 error, 0 `console.log` còn sót; `lint` + `tsc` sạch |

- **Commit (nếu cần):** `fix(<scope>): <mô tả lỗi>`

---

## 4. Thứ tự thực hiện & phụ thuộc

```
T-02 → T-01 → T-03 → T-04 ─┐
                   ├→ T-05 ─┼→ T-07 → T-08 → T-09 → T-10 → T-11 → T-12
                   └→ T-06 ─┘
```
T-04, T-05, T-06 độc lập với nhau (chỉ phụ thuộc T-03) → có thể làm và kiểm chứng riêng lẻ.

## 5. Ngoài phạm vi (KHÔNG làm — §0)
Playlist tự chuyển bài, seek bar, volume, upload file, theme sáng/tối, router, backend, thư viện state/audio/UI, animation trang trí, `useMemo`/`useCallback` khi chưa profiling.
