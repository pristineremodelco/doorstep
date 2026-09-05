/**
 * Camera capture.
 *
 * The awkward part of this file is that browsers disagree about what a video
 * file is. Safari's MediaRecorder emits MP4 with H.264; Chrome and Firefox have
 * historically emitted WebM. A WebM recorded on an Android phone will not play
 * on an iPhone, which for a video messaging app is not a rough edge, it is the
 * product failing. So MP4 is asked for first everywhere, and WebM is accepted
 * only as the fallback that keeps older Chrome working at all.
 *
 * The other awkward part is duration. A WebM written by MediaRecorder carries no
 * duration in its header, so the element reports Infinity until it is coaxed.
 * Rather than fight the container, the wall clock is timed here and the answer
 * is stored alongside the file.
 */

/** Longest a single message may run. Short is the point of the format. */
export const MAX_DURATION_MS = 5 * 60 * 1000

const PREFERRED_TYPES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4;codecs=avc1,mp4a',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
]

export function pickMimeType (): string | null {
  if (typeof MediaRecorder === 'undefined') return null
  for (const type of PREFERRED_TYPES) {
    if (MediaRecorder.isTypeSupported (type)) return type
  }
  return null
}

export function isRecordingSupported (): boolean {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    pickMimeType () !== null
  )
}

export type CaptureKind = 'video' | 'photo' | 'voice'

export interface Capture {
  kind: CaptureKind
  blob: Blob
  mimeType: string
  /** Zero for a photo. */
  durationMs: number
  /** Zero for voice, which has no picture. */
  width: number
  height: number
  /** A JPEG of the last frame, for the tile in the thread. Null for a photo,
   *  where the blob is already the image. */
  poster: Blob | null
}

export type RecorderState = 'idle' | 'ready' | 'recording' | 'stopping'

/**
 * Standard is 720p, high is 1080p.
 *
 * This is the one setting that changes the bill. High is about 2.3 times the
 * bytes of standard for the same minute, kept for the same year, re-downloaded
 * on every rewatch. It is offered because the difference is visible on a face,
 * and named honestly rather than sold as HD.
 */
export type VideoQuality = 'standard' | 'high'

export const QUALITY: Record<VideoQuality, { width: number; height: number }> = {
  standard: { width: 1280, height: 720 },
  high: { width: 1920, height: 1080 },
}

/**
 * Look filters.
 *
 * Applied by drawing each frame through a canvas, which is the only way to bake
 * one into the file rather than only into the preview. That pipeline is engaged
 * only when a filter is actually chosen: with None the stream goes straight to
 * the recorder exactly as before, so the ordinary case keeps the timing that
 * was tuned to get audio and picture in step.
 */
export type FilterName = 'none' | 'warm' | 'cool' | 'mono' | 'bright' | 'faded'

export const FILTERS: Record<FilterName, { label: string; css: string }> = {
  none:   { label: 'None',   css: 'none' },
  warm:   { label: 'Warm',   css: 'saturate(1.25) sepia(0.22) contrast(1.05)' },
  cool:   { label: 'Cool',   css: 'saturate(1.1) hue-rotate(-12deg) brightness(1.04)' },
  mono:   { label: 'Mono',   css: 'grayscale(1) contrast(1.12)' },
  bright: { label: 'Bright', css: 'brightness(1.16) contrast(1.08) saturate(1.1)' },
  faded:  { label: 'Faded',  css: 'saturate(0.75) contrast(0.92) brightness(1.06)' },
}

/**
 * Which way round the picture goes.
 *
 * The effect has a name: mirroring, or a horizontal flip. Every phone shows a
 * front camera mirrored, because that is how a mirror behaves and anything else
 * feels wrong while you are looking at yourself. Almost every phone then saves
 * the file unmirrored, because that is how other people see you, and because
 * writing held up to the lens has to read the right way round.
 *
 * The cost of that split is the surprise this fixes: you record one thing and
 * watch back another.
 *
 *   mirror   what you saw is what sends. Writing comes out backwards.
 *   true     no mirroring anywhere. What you see is already what others see.
 */
export type Facing = 'mirror' | 'true'

export interface RecorderOptions {
  facing?: 'user' | 'environment'
  quality?: VideoQuality
  filter?: FilterName
  /** Defaults to mirroring, so the recording matches the preview. */
  selfie?: Facing
  maxDurationMs?: number
  onState?: (state: RecorderState) => void
  onElapsed?: (ms: number) => void
  /** Fires when the cap is hit, so the shell can say why it stopped. */
  onCapped?: () => void
}

export class VideoRecorder {
  private stream: MediaStream | null = null
  /**
   * A hidden video element bound to the stream for as long as the camera is
   * open, because both the poster and the photo are read from it.
   *
   * Building one on demand costs a few hundred milliseconds of load and play
   * before a frame can be drawn, which for a photo means capturing the moment
   * after the one the finger asked for.
   */
  private frameSource: HTMLVideoElement | null = null
  private recorder: MediaRecorder | null = null
  private voice = false
  /** Only built while a filter is in use, and torn down with the recording. */
  private painter: { canvas: HTMLCanvasElement; stop: () => void } | null = null
  private chunks: Blob[] = []
  private startedAt = 0
  private ticker: number | null = null
  private capTimer: number | null = null
  private opts: RecorderOptions
  private state: RecorderState = 'idle'

  constructor (opts: RecorderOptions = {}) {
    this.opts = opts
  }

  private setState (s: RecorderState) {
    this.state = s
    this.opts.onState?.(s)
  }

  get currentState () {
    return this.state
  }

  /**
   * Opens the camera. Must be called from a user gesture: iOS refuses
   * getUserMedia otherwise, and does it silently enough to look like a bug.
   *
   * Two details here are about the recording rather than the preview.
   *
   * Echo cancellation is off. It exists for calls, where a speaker is playing
   * the other person into the same room as the microphone, and none of that is
   * happening while recording a message. What it does instead is run the audio
   * through an adaptive filter that delays it against the video, which is the
   * usual reason a recording ends up with the voice trailing the mouth.
   *
   * The camera is not reported ready until it has actually produced a frame.
   * Audio starts flowing the instant the track is live, but a camera takes a
   * moment to wake and expose, so a recorder started immediately captures
   * sound against nothing and every frame afterwards sits that far behind.
   */
  async open (): Promise<MediaStream> {
    if (this.stream) return this.stream
    const facing = this.opts.facing ?? 'user'

    const want = QUALITY[this.opts.quality ?? 'high']

    this.stream = await navigator.mediaDevices.getUserMedia ({
      video: {
        facingMode: facing,
        // Asked for on the long edge, so a phone held upright is not talked
        // into recording a landscape frame and rotating it.
        width: { ideal: want.width },
        height: { ideal: want.height },
        frameRate: { ideal: 30 },
      },
      audio: {
        echoCancellation: false,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: { ideal: 48000 },
        channelCount: { ideal: 1 },
      },
    })

    await this.waitForFirstFrame (this.stream)
    this.setState ('ready')
    return this.stream
  }

  /**
   * A still, taken from the frame already on screen.
   *
   * Full sensor resolution, or as close as the granted stream gets. JPEG at 92
   * because a photograph of a face shows banding well before it shows file
   * size, and these are looked at rather than streamed.
   */
  async snapshot (): Promise<Capture> {
    const track = this.stream?.getVideoTracks ()[0]
    const video = this.frameSource
    if (!track || !video) throw new Error ('camera is not open')

    const { width = 1280, height = 720 } = track.getSettings ()
    const canvas = document.createElement ('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext ('2d')
    if (!ctx) throw new Error ('cannot draw the frame')
    ctx.drawImage (video, 0, 0, width, height)

    const blob = await new Promise<Blob | null> ((resolve) =>
      canvas.toBlob ((b) => resolve (b), 'image/jpeg', 0.92)
    )
    if (!blob) throw new Error ('could not save the picture')

    return {
      kind: 'photo',
      blob,
      mimeType: 'image/jpeg',
      durationMs: 0,
      width,
      height,
      poster: null,
    }
  }

  /**
   * Resolves once the camera has delivered a real frame, or after a moment if
   * it never says so. Bounded, because a device that will not report a frame
   * must still be recordable rather than stuck behind a spinner forever.
   */
  private async waitForFirstFrame (stream: MediaStream): Promise<void> {
    const video = document.createElement ('video')
    video.srcObject = stream
    video.muted = true
    video.playsInline = true
    this.frameSource = video
    void video.play ().catch (() => undefined)
    await withTimeout (
      waitFor (video, ['loadeddata', 'canplay']),
      FIRST_FRAME_TIMEOUT_MS
    )
    // loadeddata can fire a beat before the sensor has settled on exposure.
    await new Promise ((r) => setTimeout (r, CAMERA_SETTLE_MS))
  }

  /**
   * Bits per second for the resolution actually granted.
   *
   * A fixed number is wrong at both ends: it starves 1080p into mush and wastes
   * bytes on a device that only offered 480p. Roughly 0.08 bits per pixel per
   * frame is the point where H.264 stops looking soft on faces.
   */
  private videoBitrate (): number {
    const s = this.stream?.getVideoTracks ()[0]?.getSettings ()
    const pixels = (s?.width ?? 1280) * (s?.height ?? 720)
    const fps = s?.frameRate ?? 30
    return Math.round (Math.min (8_000_000, Math.max (1_200_000, pixels * fps * 0.08)))
  }

  /**
   * What the camera can do beyond point and shoot.
   *
   * Zoom exists on phone hardware and not on most laptop webcams, so it is
   * asked for rather than assumed. Where there is none, this returns null and
   * the gesture is simply not wired up.
   */
  zoomRange (): { min: number; max: number; step: number } | null {
    const track = this.stream?.getVideoTracks ()[0]
    const caps = (track?.getCapabilities?.() ?? {}) as
      { zoom?: { min: number; max: number; step?: number } }
    if (!caps.zoom) return null
    const { min, max, step } = caps.zoom
    return max > min ? { min, max, step: step || 0.1 } : null
  }

  zoom (): number {
    const track = this.stream?.getVideoTracks ()[0]
    const s = (track?.getSettings?.() ?? {}) as { zoom?: number }
    return s.zoom ?? this.zoomRange ()?.min ?? 1
  }

  /**
   * Sets zoom on the live track, so the recording zooms with the preview.
   *
   * Scaling the preview instead would record the wide shot and show a close
   * one, which is the sort of bug nobody notices until they watch it back.
   */
  async setZoom (value: number): Promise<void> {
    const range = this.zoomRange ()
    const track = this.stream?.getVideoTracks ()[0]
    if (!range || !track) return
    const clamped = Math.min (range.max, Math.max (range.min, value))
    try {
      await track.applyConstraints (
        { advanced: [{ zoom: clamped }] } as unknown as MediaTrackConstraints
      )
    } catch {
      // A device that advertised zoom and then refused it is not worth an
      // error in the middle of a recording.
    }
  }

  /**
   * Swaps front and back.
   *
   * Refused mid-recording, because closing the stream to reopen it would
   * discard the clip in progress with nothing to show for it. If the other
   * camera cannot be opened, which is normal on a laptop with only one, the
   * previous one is restored rather than leaving a dead preview.
   */
  async flip (): Promise<MediaStream> {
    if (this.state === 'recording' || this.state === 'stopping') {
      throw new Error ('cannot flip the camera while recording')
    }
    const previous = this.opts.facing ?? 'user'
    const next = previous === 'environment' ? 'user' : 'environment'
    this.close ()
    this.opts.facing = next
    try {
      return await this.open ()
    } catch (e) {
      this.opts.facing = previous
      try {
        return await this.open ()
      } catch {
        throw e
      }
    }
  }

  /**
   * Begins recording.
   *
   * Voice drops the video track from the recorder rather than turning the
   * camera off, so the preview keeps running and letting go still returns you
   * to a live picture. It is also about thirty times smaller per minute than
   * video, which matters when the bill is storage.
   */
  start (opts: { voice?: boolean } = {}) {
    if (!this.stream) throw new Error ('camera is not open')
    // Starting again while the previous clip is still being finalised would
    // hand the finishing recorder an emptied buffer. Hold to record makes fast
    // repeat presses ordinary, so this is refused rather than raced.
    if (this.state === 'recording' || this.state === 'stopping') return

    const mimeType = pickMimeType ()
    if (!mimeType) throw new Error ('this browser cannot record video')

    // Each recording owns its own array. Sharing one on the instance meant a
    // stop still settling resolved its Blob from whatever the next recording
    // had already reset, which silently produced empty or truncated clips.
    const chunks: Blob[] = []
    this.chunks = chunks
    this.voice = opts.voice === true

    const filter = this.opts.filter ?? 'none'
    // Only the back camera is ever left alone: nobody expects a mirror when
    // pointing away from themselves.
    const mirror =
      (this.opts.selfie ?? 'mirror') === 'mirror' &&
      (this.opts.facing ?? 'user') === 'user'

    const source = this.voice
      ? new MediaStream (this.stream.getAudioTracks ())
      : filter === 'none' && !mirror
        ? this.stream
        : this.filtered (FILTERS[filter].css, mirror)

    const type = this.voice ? pickAudioMimeType () ?? mimeType : mimeType

    this.recorder = new MediaRecorder (source, this.voice
      ? { mimeType: type, audioBitsPerSecond: 128_000 }
      : { mimeType, videoBitsPerSecond: this.videoBitrate (), audioBitsPerSecond: 128_000 })
    this.recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push (e.data)
    }
    // A timeslice means a crash mid-recording still leaves usable chunks
    // instead of one buffer that was never flushed.
    this.recorder.start (1000)
    this.startedAt = Date.now ()
    this.setState ('recording')

    this.ticker = window.setInterval (() => {
      this.opts.onElapsed?.(Date.now () - this.startedAt)
    }, 100)

    const cap = this.opts.maxDurationMs ?? MAX_DURATION_MS
    this.capTimer = window.setTimeout (() => {
      // Losing the race with a real stop is normal, not an error worth
      // surfacing: the clip is already safely on its way.
      if (this.state !== 'recording') return
      this.opts.onCapped?.()
      void this.stop ().catch (() => undefined)
    }, cap)
  }

  async stop (): Promise<Capture> {
    const rec = this.recorder
    if (!rec || this.state !== 'recording') throw new Error ('not recording')
    this.setState ('stopping')
    this.clearTimers ()

    // Stop first, and take the clock reading in the same breath.
    //
    // Grabbing the poster before this cost about a second of drift: the
    // recorder keeps running while the frame is captured, so the file ended up
    // longer than the duration recorded against it and the scrubber disagreed
    // with the label on the tile. The stream stays live after stop(), only
    // close() ends it, so the poster can be taken afterwards from the same
    // frame the camera is still showing.
    const durationMs = Date.now () - this.startedAt
    const chunks = this.chunks
    const blob = await new Promise<Blob> ((resolve) => {
      // onstop can fail to arrive if the recorder errors out. Waiting on it
      // forever would strand the clip with no way back to the camera, so the
      // chunks already flushed by the timeslice are used instead. A short clip
      // beats a hung screen.
      const settle = () => resolve (new Blob (chunks, { type: rec.mimeType }))
      const guard = window.setTimeout (settle, STOP_TIMEOUT_MS)
      rec.onstop = () => { window.clearTimeout (guard); settle () }
      rec.onerror = () => { window.clearTimeout (guard); settle () }
      rec.stop ()
    })

    // Voice has no picture, so nothing is grabbed and nothing is stored for a
    // tile that would only ever show a frame the sender did not choose to send.
    const poster = this.voice ? null : await this.grabFrame ()

    const track = this.stream?.getVideoTracks ()[0]
    const settings = this.voice ? {} : track?.getSettings () ?? {}
    const wasVoice = this.voice

    this.recorder = null
    this.voice = false
    this.stopPainting ()
    this.setState ('ready')

    return {
      kind: wasVoice ? 'voice' : 'video',
      blob,
      mimeType: rec.mimeType,
      durationMs,
      width: settings.width ?? 0,
      height: settings.height ?? 0,
      poster,
    }
  }

  /**
   * A stream of the camera redrawn through a filter, plus the original audio.
   *
   * The paint loop runs on animation frames, so it pauses with the tab. That is
   * the right behaviour: a backgrounded recording has nothing to draw anyway,
   * and the audio track carries its own timing regardless.
   */
  private filtered (css: string, mirror = false): MediaStream {
    const video = this.frameSource!
    const track = this.stream!.getVideoTracks ()[0]
    const { width = 1280, height = 720, frameRate = 30 } = track.getSettings ()

    const canvas = document.createElement ('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext ('2d')!

    // Set once rather than per frame: resetting the transform every frame costs
    // nothing visible but adds work sixty times a second for no reason.
    if (mirror) {
      ctx.translate (width, 0)
      ctx.scale (-1, 1)
    }

    let raf = 0
    const paint = () => {
      ctx.filter = css
      try {
        ctx.drawImage (video, 0, 0, width, height)
      } catch {
        // A frame that is not ready is skipped rather than ending the loop.
      }
      raf = requestAnimationFrame (paint)
    }
    paint ()

    this.painter = { canvas, stop: () => cancelAnimationFrame (raf) }

    const out = canvas.captureStream (frameRate)
    for (const a of this.stream!.getAudioTracks ()) out.addTrack (a)
    return out
  }

  private stopPainting () {
    this.painter?.stop ()
    this.painter = null
  }

  /** Throws the recording away without producing a file. */
  cancel () {
    this.clearTimers ()
    this.stopPainting ()
    try {
      this.recorder?.stop ()
    } catch {
      // Already stopped. Nothing to unwind.
    }
    this.recorder = null
    this.chunks = []
    if (this.stream) this.setState ('ready')
  }

  close () {
    this.clearTimers ()
    this.stopPainting ()
    this.recorder = null
    this.chunks = []
    if (this.frameSource) {
      this.frameSource.pause ()
      this.frameSource.srcObject = null
      this.frameSource = null
    }
    this.stream?.getTracks ().forEach ((t) => t.stop ())
    this.stream = null
    this.setState ('idle')
  }

  private clearTimers () {
    if (this.ticker !== null) window.clearInterval (this.ticker)
    if (this.capTimer !== null) window.clearTimeout (this.capTimer)
    this.ticker = null
    this.capTimer = null
  }

  /**
   * Draws the current frame to a canvas so the thread has a tile to show.
   *
   * Every wait in here is bounded. A poster is decoration and the send is not:
   * awaiting play() unbounded stalled stop() indefinitely whenever the tab was
   * throttled, which on a phone means any time the screen locks or the app goes
   * to the background mid-recording. Nothing cosmetic gets to hold the video
   * hostage, so a slow frame is simply given up on.
   */
  private async grabFrame (): Promise<Blob | null> {
    const track = this.stream?.getVideoTracks ()[0]
    const video = this.frameSource
    if (!track || !video || video.readyState < 2) return null
    const { width = 640, height = 480 } = track.getSettings ()
    try {
      const canvas = document.createElement ('canvas')
      canvas.width = width
      canvas.height = height
      canvas.getContext ('2d')?.drawImage (video, 0, 0, width, height)
      return await withTimeout (
        new Promise<Blob | null> ((resolve) =>
          canvas.toBlob ((b) => resolve (b), 'image/jpeg', 0.7)
        ),
        POSTER_TIMEOUT_MS
      )
    } catch {
      // A poster is a nicety. Losing it must never lose the recording.
      return null
    }
  }
}

/** Longest the poster grab may hold up a send before it is abandoned. */
const POSTER_TIMEOUT_MS = 600

/** Longest to wait for onstop before settling on the chunks already flushed. */
const STOP_TIMEOUT_MS = 3000

/** Longest to wait for the camera's first frame before allowing a record. */
const FIRST_FRAME_TIMEOUT_MS = 2500

/** Let exposure and white balance settle after the first frame arrives. */
const CAMERA_SETTLE_MS = 220

function waitFor (target: EventTarget, events: string[]): Promise<boolean> {
  return new Promise ((resolve) => {
    const done = () => {
      for (const e of events) target.removeEventListener (e, done)
      resolve (true)
    }
    for (const e of events) target.addEventListener (e, done, { once: true })
  })
}

function withTimeout<T> (p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race ([
    p,
    new Promise<null> ((resolve) => setTimeout (() => resolve (null), ms)),
  ])
}

const AUDIO_TYPES = [
  'audio/mp4',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/webm;codecs=opus',
  'audio/webm',
]

/** Safari records audio as mp4, everything else prefers opus in webm. */
export function pickAudioMimeType (): string | null {
  if (typeof MediaRecorder === 'undefined') return null
  for (const type of AUDIO_TYPES) {
    if (MediaRecorder.isTypeSupported (type)) return type
  }
  return null
}

export function extensionFor (mimeType: string): string {
  if (mimeType.startsWith ('audio/')) {
    return mimeType.includes ('mp4') ? 'm4a' : 'weba'
  }
  return mimeType.includes ('mp4') ? 'mp4' : 'webm'
}

export function formatDuration (ms: number): string {
  const total = Math.round (ms / 1000)
  const m = Math.floor (total / 60)
  const s = total % 60
  return `${m}:${String (s).padStart (2, '0')}`
}
