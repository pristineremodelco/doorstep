/**
 * Look filters, defined once and drawn three ways.
 *
 * A filter is a short list of colour steps. The live preview shows it as a CSS
 * filter on the video element. Recordings and photos draw it on the graphics
 * card, each step as the colour matrix the CSS specification defines for it,
 * so what the preview shows is what the file holds.
 *
 * The recording used to go through a 2D canvas with ctx.filter, and the preview
 * showed nothing at all. Canvas filters are not something every phone browser
 * can be relied on for, and a filter that shows on screen and is missing from
 * the file is worse than none. WebGL is everywhere a phone can record, and a
 * colour matrix is all any of these looks is.
 */

export type FilterName = 'none' | 'warm' | 'cool' | 'mono' | 'bright' | 'faded'

type Step =
  | ['saturate', number]
  | ['sepia', number]
  | ['grayscale', number]
  | ['hue-rotate', number]
  | ['brightness', number]
  | ['contrast', number]

interface Look { label: string; steps: Step[]; css: string }

const look = (label: string, steps: Step[]): Look => ({
  label,
  steps,
  css: steps.length
    ? steps.map (([f, v]) => f === 'hue-rotate' ? `${f}(${v}deg)` : `${f}(${v})`).join (' ')
    : 'none',
})

export const FILTERS: Record<FilterName, Look> = {
  none:   look ('None',   []),
  warm:   look ('Warm',   [['saturate', 1.25], ['sepia', 0.22], ['contrast', 1.05]]),
  cool:   look ('Cool',   [['saturate', 1.1], ['hue-rotate', -12], ['brightness', 1.04]]),
  mono:   look ('Mono',   [['grayscale', 1], ['contrast', 1.12]]),
  bright: look ('Bright', [['brightness', 1.16], ['contrast', 1.08], ['saturate', 1.1]]),
  faded:  look ('Faded',  [['saturate', 0.75], ['contrast', 0.92], ['brightness', 1.06]]),
}

/** The most steps any look has, which the shader is compiled for. */
const MAX_STEPS = 3

/**
 * One step as a 3 by 3 matrix, row by row, and an offset. The numbers are the
 * Filter Effects specification's, which is what the browser uses for the CSS
 * preview.
 */
function matrix ([f, v]: Step): { m: number[]; o: number[] } {
  const none = { m: [1, 0, 0, 0, 1, 0, 0, 0, 1], o: [0, 0, 0] }
  switch (f) {
    case 'saturate': {
      const s = v
      return { m: [
        0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s,
        0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s,
        0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s,
      ], o: [0, 0, 0] }
    }
    case 'grayscale': {
      const a = 1 - Math.min (1, v)
      return { m: [
        0.2126 + 0.7874 * a, 0.7152 - 0.7152 * a, 0.0722 - 0.0722 * a,
        0.2126 - 0.2126 * a, 0.7152 + 0.2848 * a, 0.0722 - 0.0722 * a,
        0.2126 - 0.2126 * a, 0.7152 - 0.7152 * a, 0.0722 + 0.9278 * a,
      ], o: [0, 0, 0] }
    }
    case 'sepia': {
      const a = 1 - Math.min (1, v)
      return { m: [
        0.393 + 0.607 * a, 0.769 - 0.769 * a, 0.189 - 0.189 * a,
        0.349 - 0.349 * a, 0.686 + 0.314 * a, 0.168 - 0.168 * a,
        0.272 - 0.272 * a, 0.534 - 0.534 * a, 0.131 + 0.869 * a,
      ], o: [0, 0, 0] }
    }
    case 'hue-rotate': {
      const r = (v * Math.PI) / 180
      const c = Math.cos (r)
      const s = Math.sin (r)
      return { m: [
        0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928,
        0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.140, 0.072 - c * 0.072 - s * 0.283,
        0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072,
      ], o: [0, 0, 0] }
    }
    case 'brightness':
      return { m: [v, 0, 0, 0, v, 0, 0, 0, v], o: [0, 0, 0] }
    case 'contrast': {
      const o = 0.5 - 0.5 * v
      return { m: [v, 0, 0, 0, v, 0, 0, 0, v], o: [o, o, o] }
    }
    default:
      return none
  }
}

const VERTEX = `
attribute vec2 a_pos;
uniform float u_mirror;
varying vec2 v_uv;
void main () {
  vec2 uv = vec2 ((a_pos.x + 1.0) / 2.0, 1.0 - (a_pos.y + 1.0) / 2.0);
  if (u_mirror > 0.5) uv.x = 1.0 - uv.x;
  v_uv = uv;
  gl_Position = vec4 (a_pos, 0.0, 1.0);
}`

// Each step clamps, as the browser does between filter functions, so a strong
// step followed by a gentle one matches the preview at the bright end too.
const FRAGMENT = `
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_tex;
uniform mat3 u_m[${MAX_STEPS}];
uniform vec3 u_o[${MAX_STEPS}];
uniform int u_n;
void main () {
  vec3 c = texture2D (u_tex, v_uv).rgb;
  for (int i = 0; i < ${MAX_STEPS}; i++) {
    if (i >= u_n) break;
    c = clamp (u_m[i] * c + u_o[i], 0.0, 1.0);
  }
  gl_FragColor = vec4 (c, 1.0);
}`

/**
 * Draws video frames through a look onto its own canvas.
 *
 * WebGL where there is WebGL. Where there is not, a 2D canvas with ctx.filter,
 * which is right on the browsers that have it and at worst unfiltered, never
 * broken.
 */
export class LookPainter {
  readonly canvas: HTMLCanvasElement
  private gl: WebGLRenderingContext | null = null
  private ctx: CanvasRenderingContext2D | null = null
  private program: WebGLProgram | null = null
  private name: FilterName
  private mirror: boolean

  constructor (width: number, height: number, name: FilterName, mirror: boolean) {
    this.canvas = document.createElement ('canvas')
    this.canvas.width = width
    this.canvas.height = height
    this.name = name
    this.mirror = mirror
    // preserveDrawingBuffer, because a captured stream or a drawImage reads the
    // canvas after the frame is presented, which some browsers otherwise clear.
    const gl = this.canvas.getContext ('webgl', { preserveDrawingBuffer: true, antialias: false, alpha: false })
    if (gl && this.setUp (gl)) {
      this.gl = gl
    } else {
      this.ctx = this.canvas.getContext ('2d')
    }
  }

  /** Whether the graphics card is drawing, rather than the 2D fallback. */
  get accelerated (): boolean {
    return this.gl !== null
  }

  setLook (name: FilterName) {
    this.name = name
    if (this.gl && this.program) this.upload (this.gl, this.program)
  }

  draw (source: HTMLVideoElement) {
    const { width, height } = this.canvas
    if (this.gl && this.program) {
      const gl = this.gl
      try {
        gl.texImage2D (gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, source)
      } catch {
        return
      }
      gl.viewport (0, 0, width, height)
      gl.drawArrays (gl.TRIANGLE_STRIP, 0, 4)
      return
    }
    const ctx = this.ctx
    if (!ctx) return
    ctx.save ()
    if (this.mirror) { ctx.translate (width, 0); ctx.scale (-1, 1) }
    ctx.filter = FILTERS[this.name].css
    try { ctx.drawImage (source, 0, 0, width, height) } catch { /* frame not ready */ }
    ctx.restore ()
  }

  /** Frees the graphics context now rather than whenever the page is collected. */
  dispose () {
    this.gl?.getExtension ('WEBGL_lose_context')?.loseContext ()
    this.gl = null
    this.ctx = null
  }

  private setUp (gl: WebGLRenderingContext): boolean {
    const compile = (type: number, src: string) => {
      const s = gl.createShader (type)
      if (!s) return null
      gl.shaderSource (s, src)
      gl.compileShader (s)
      return gl.getShaderParameter (s, gl.COMPILE_STATUS) ? s : null
    }
    const vs = compile (gl.VERTEX_SHADER, VERTEX)
    const fs = compile (gl.FRAGMENT_SHADER, FRAGMENT)
    const program = gl.createProgram ()
    if (!vs || !fs || !program) return false
    gl.attachShader (program, vs)
    gl.attachShader (program, fs)
    gl.linkProgram (program)
    if (!gl.getProgramParameter (program, gl.LINK_STATUS)) return false
    gl.useProgram (program)

    const quad = gl.createBuffer ()
    gl.bindBuffer (gl.ARRAY_BUFFER, quad)
    gl.bufferData (gl.ARRAY_BUFFER, new Float32Array ([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const pos = gl.getAttribLocation (program, 'a_pos')
    gl.enableVertexAttribArray (pos)
    gl.vertexAttribPointer (pos, 2, gl.FLOAT, false, 0, 0)

    // Video frames are rarely a power of two, which WebGL 1 only samples with
    // clamping and no mipmaps.
    const tex = gl.createTexture ()
    gl.bindTexture (gl.TEXTURE_2D, tex)
    gl.texParameteri (gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri (gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri (gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri (gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)

    this.program = program
    this.upload (gl, program)
    return true
  }

  private upload (gl: WebGLRenderingContext, program: WebGLProgram) {
    const steps = FILTERS[this.name].steps.slice (0, MAX_STEPS).map (matrix)
    gl.useProgram (program)
    gl.uniform1i (gl.getUniformLocation (program, 'u_n'), steps.length)
    gl.uniform1f (gl.getUniformLocation (program, 'u_mirror'), this.mirror ? 1 : 0)
    steps.forEach (({ m, o }, i) => {
      // GLSL reads matrices column first.
      const columns = [m[0]!, m[3]!, m[6]!, m[1]!, m[4]!, m[7]!, m[2]!, m[5]!, m[8]!]
      gl.uniformMatrix3fv (gl.getUniformLocation (program, `u_m[${i}]`), false, columns)
      gl.uniform3fv (gl.getUniformLocation (program, `u_o[${i}]`), o)
    })
  }
}
