import { useCallback, useEffect, useRef, useState } from 'react'
import { YT_STATE, loadYouTubeApi, parseYouTubeId, type YTPlayer } from '#/lib/youtube'

type Mode = 'stop' | 'play' | 'rew' | 'ff'

const DEMO_DURATION = 30 * 60 // one side of a C-60
const WIND_SPEED = 16 // fast-wind multiplier

// Cassette face, in a 400 × 256 box (the real one is 100.4 × 63.8 mm).
const W = 400
const H = 256
const HUB_L = { x: 122, y: 110 }
const HUB_R = { x: 278, y: 110 }
const R_MIN = 17 // bare hub
const R_MAX = 80 // full pack
const TAPE_WIN = { x: 164, y: 94, w: 72, h: 32 }


// Seen from just below, the shell's 12 mm thickness shows as a strip under the face.
const EDGE = 16

// Where the tape is exposed along the bottom edge: [x, width].
const EDGE_OPENINGS: [number, number][] = [
  [94, 26],
  [150, 16],
  [182, 36],
  [234, 16],
  [280, 26],
]

// Tape length is conserved, so pack radius follows area, not position.
const packRadius = (fill: number) =>
  Math.sqrt(R_MIN * R_MIN + (R_MAX * R_MAX - R_MIN * R_MIN) * fill)

// Pixel heart, 11 × 10 cells. k outline, r red, d shade, w highlight.
const HEART = [
  '..kkk.kkk..',
  '.krrrkrrrk.',
  'krwwrrrrrrk',
  'krwrrrrrrdk',
  'krrrrrrrrdk',
  '.krrrrrrdk.',
  '..krrrrdk..',
  '...krrdk...',
  '....kdk....',
  '.....k.....',
]
const HEART_COLORS: Record<string, string> = {
  k: 'var(--ink)',
  r: 'var(--heart)',
  d: 'var(--heart-shade)',
  w: '#ffffff',
}
const HEART_CELLS = HEART.flatMap((row, y) => [...row].map((c, x) => ({ x, y, c }))).filter((p) => p.c !== '.')
const filled = new Set(HEART_CELLS.map(({ x, y }) => `${x},${y}`))
// one-cell white border all round, like a sticker
const HEART_HALO = [...new Set(
  HEART_CELLS.flatMap(({ x, y }) =>
    [-1, 0, 1].flatMap((dx) => [-1, 0, 1].map((dy) => `${x + dx},${y + dy}`)),
  ),
)].filter((k) => !filled.has(k)).map((k) => k.split(',').map(Number))

function Heart({ x, y, cell }: { x: number; y: number; cell: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${cell})`} stroke="none" shapeRendering="crispEdges">
      {HEART_HALO.map(([hx, hy]) => (
        <rect key={`h${hx},${hy}`} x={hx} y={hy} width={1.02} height={1.02} fill="#ffffff" />
      ))}
      {HEART_CELLS.map(({ x: cx, y: cy, c }) => (
        <rect
          key={`${cx},${cy}`}
          x={cx}
          y={cy}
          width={1.02}
          height={1.02}
          fill={HEART_COLORS[c]}
        />
      ))}
    </g>
  )
}

function Screw({ x, y, r = 5 }: { x: number; y: number; r?: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle r={r} fill="var(--paper)" />
      <path d={`M${-r * 0.55} 0 H${r * 0.55} M0 ${-r * 0.55} V${r * 0.55}`} strokeWidth={1} />
    </g>
  )
}

// Hub hole in the shell; the hub has a ring of slots and a toothed drive hole.
function Hub({ at, reel }: { at: { x: number; y: number }; reel: React.RefObject<SVGGElement | null> }) {
  return (
    <g transform={`translate(${at.x} ${at.y})`}>
      <circle r={26} fill="var(--paper)" strokeWidth={1.3} />
      <g ref={reel}>
        <circle r={22} strokeWidth={1.2} />
        {Array.from({ length: 12 }, (_, i) => (
          <rect key={i} x={-1.6} y={-19} width={3.2} height={4.5} rx={0.8} fill="var(--ink)" stroke="none" transform={`rotate(${i * 30})`} />
        ))}
        <circle r={11.5} strokeWidth={1.2} />
        {Array.from({ length: 6 }, (_, i) => (
          <path key={i} d="M-2 -11.5 V-7.5 H2 V-11.5" fill="var(--ink)" strokeWidth={0.8} transform={`rotate(${i * 60 + 30})`} />
        ))}
      </g>
    </g>
  )
}

const ICONS: Record<string, string> = {
  rew: 'M11 6 L3 12 L11 18 Z M20 6 L12 12 L20 18 Z',
  play: 'M8 5 L19 12 L8 19 Z',
  pause: 'M7 5 H10.5 V19 H7 Z M13.5 5 H17 V19 H13.5 Z',
  stop: 'M6.5 6.5 H17.5 V17.5 H6.5 Z',
  ff: 'M4 6 L12 12 L4 18 Z M13 6 L21 12 L13 18 Z',
  eject: 'M12 5 L19 13 H5 Z M5 16 H19 V19 H5 Z',
  'vol-down': 'M3 9 H7 L12 5 V19 L7 15 H3 Z M15 11 H21 V13 H15 Z',
  'vol-up': 'M3 9 H7 L12 5 V19 L7 15 H3 Z M15 11 H21 V13 H15 Z M17 9 H19 V15 H17 Z',
}

export function CassettePlayer() {
  const [mode, setMode] = useState<Mode>('stop')
  const [title, setTitle] = useState<string | null>(null)
  const [source, setSource] = useState<'file' | 'yt' | null>(null)
  const [volume, setVolume] = useState(8) // 0–10 steps
  const volumeRef = useRef(8)
  volumeRef.current = volume
  const [linkError, setLinkError] = useState(false)

  const audioRef = useRef<HTMLAudioElement>(null)
  const ytRef = useRef<YTPlayer | null>(null)
  const ytHost = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const urlRef = useRef<string | null>(null)

  const leftReel = useRef<SVGGElement>(null)
  const rightReel = useRef<SVGGElement>(null)
  const leftPack = useRef<SVGCircleElement>(null)
  const rightPack = useRef<SVGCircleElement>(null)

  const pos = useRef(0)
  const angle = useRef({ l: 0, r: 0 })
  const modeRef = useRef<Mode>('stop')
  modeRef.current = mode

  const duration = () => {
    const d =
      source === 'file' ? audioRef.current?.duration : source === 'yt' ? ytRef.current?.getDuration?.() : 0
    return d && Number.isFinite(d) ? d : DEMO_DURATION
  }

  // Draw the current tape state straight to the DOM — no re-render per frame.
  const paint = useCallback(() => {
    const p = Math.min(1, Math.max(0, pos.current / duration()))
    const rl = packRadius(1 - p)
    const rr = packRadius(p)
    leftPack.current?.setAttribute('r', String(rl))
    rightPack.current?.setAttribute('r', String(rr))
    leftReel.current?.setAttribute('transform', `rotate(${angle.current.l})`)
    rightReel.current?.setAttribute('transform', `rotate(${angle.current.r})`)
    return { rl, rr }
  }, [source])

  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      const m = modeRef.current
      const audio = audioRef.current
      const d = duration()

      if (m === 'play') {
        if (source === 'file' && audio) pos.current = audio.currentTime
        else if (source === 'yt' && ytRef.current?.getCurrentTime) pos.current = ytRef.current.getCurrentTime()
        else pos.current += dt
      } else if (m === 'ff' || m === 'rew') {
        pos.current += (m === 'ff' ? 1 : -1) * WIND_SPEED * dt * (d / 120)
      }

      if (pos.current >= d) {
        pos.current = d
        if (m === 'play' || m === 'ff') setMode('stop')
      } else if (pos.current <= 0) {
        pos.current = 0
        if (m === 'rew') setMode('stop')
      }

      const { rl, rr } = paint()
      if (m !== 'stop') {
        // Constant linear tape speed → the fuller reel turns slower.
        const k = (m === 'play' ? 1 : m === 'ff' ? WIND_SPEED : -WIND_SPEED) * 1800
        angle.current.l += (k / rl) * dt
        angle.current.r += (k / rr) * dt
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [paint, source])

  // Keep whichever player is loaded in step with the transport.
  useEffect(() => {
    if (source === 'file') {
      const audio = audioRef.current
      if (!audio) return
      if (mode === 'play') {
        audio.currentTime = pos.current
        audio.play().catch(() => setMode('stop'))
      } else {
        audio.pause()
        if (mode === 'stop') audio.currentTime = pos.current
      }
    } else if (source === 'yt') {
      const yt = ytRef.current
      if (!yt?.playVideo) return
      if (mode === 'play') {
        yt.seekTo(pos.current, true)
        yt.playVideo()
      } else {
        yt.pauseVideo()
      }
    }
  }, [mode, source])

  const press = (m: Mode) => setMode((cur) => (cur === m ? 'stop' : m))
  const eject = () => fileRef.current?.click()
  const nudgeVolume = (step: number) => setVolume((v) => Math.min(10, Math.max(0, v + step)))

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume / 10
    ytRef.current?.setVolume?.(volume * 10)
  }, [volume])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return
      // arrows do nothing on a focused key, so volume works after clicking one
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault()
        nudgeVolume(e.key === 'ArrowUp' ? 1 : -1)
        return
      }
      if (e.target instanceof HTMLButtonElement) return
      const map: Record<string, Mode> = { ' ': 'play', ArrowLeft: 'rew', ArrowRight: 'ff', Escape: 'stop' }
      const m = map[e.key]
      if (!m) return
      e.preventDefault()
      if (m === 'stop') setMode('stop')
      else press(m)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const load = (file: File) => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    const url = URL.createObjectURL(file)
    urlRef.current = url
    setMode('stop')
    pos.current = 0
    ytRef.current?.stopVideo?.()
    if (audioRef.current) audioRef.current.src = url
    setSource('file')
    setTitle(file.name.replace(/\.[^.]+$/, ''))
  }

  // The YouTube player plays off-screen, so only the audio comes through.
  const loadYouTube = async (videoId: string) => {
    setMode('stop')
    pos.current = 0
    audioRef.current?.pause()
    setSource('yt')
    setTitle('loading…')
    const YT = await loadYouTubeApi()
    if (ytRef.current) {
      ytRef.current.cueVideoById(videoId)
      return
    }
    // YT replaces the element it is given, so hand it one React does not own.
    const el = document.createElement('div')
    ytHost.current?.appendChild(el)
    ytRef.current = new YT.Player(el, {
      width: 356,
      height: 200,
      videoId,
      playerVars: { playsinline: 1, rel: 0, controls: 0, modestbranding: 1 },
      events: {
        onReady: (e) => {
          e.target.setVolume(volumeRef.current * 10)
          setTitle(e.target.getVideoData().title || 'YouTube')
        },
        onStateChange: (e) => {
          const t = e.target.getVideoData().title
          if (t) setTitle(t)
          // clicks on the video itself should move the keys too
          if (e.data === YT_STATE.ended) setMode('stop')
          else if (e.data === YT_STATE.playing && modeRef.current !== 'play') setMode('play')
          else if (e.data === YT_STATE.paused && modeRef.current === 'play') setMode('stop')
        },
      },
    })
  }

  const tryLink = (text: string) => {
    const id = parseYouTubeId(text)
    if (id) void loadYouTube(id)
    setLinkError(!id)
    return !!id
  }

  // Paste a YouTube link anywhere on the page.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (e.target instanceof HTMLInputElement) return
      const id = parseYouTubeId(e.clipboardData?.getData('text') ?? '')
      if (!id) return
      e.preventDefault()
      void loadYouTube(id)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [])

  const buttons: { id: string; label: string; on: boolean; act: () => void }[] = [
    { id: 'rew', label: 'Rewind', on: mode === 'rew', act: () => press('rew') },
    { id: mode === 'play' ? 'pause' : 'play', label: mode === 'play' ? 'Pause' : 'Play', on: mode === 'play', act: () => press('play') },
    { id: 'stop', label: 'Stop', on: false, act: () => setMode('stop') },
    { id: 'ff', label: 'Fast forward', on: mode === 'ff', act: () => press('ff') },
    { id: 'eject', label: 'Load a tape', on: false, act: eject },
  ]

  return (
    <div className="flex w-full flex-col items-center gap-14">
      <input
        className="link-input"
        type="url"
        placeholder="paste a YouTube link"
        aria-label="YouTube link"
        aria-invalid={linkError}
        onChange={(e) => {
          const v = e.currentTarget.value
          if (!v) setLinkError(false)
          else if (parseYouTubeId(v)) {
            tryLink(v)
            e.currentTarget.value = ''
          }
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return
          if (tryLink(e.currentTarget.value)) e.currentTarget.value = ''
        }}
      />

      <div className="stage">
          <svg
            className="cassette cursor-pointer"
            viewBox={`-1 -1 ${W + 2} ${H + EDGE + 2}`}
            fill="none"
            stroke="var(--ink)"
            strokeWidth={1.4}
            strokeLinecap="round"
            strokeLinejoin="round"
            onClick={eject}
            role="img"
            aria-label="Cassette tape — click to load a track"
          >
            <defs>
              <linearGradient id="edge-shade" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="var(--edge-light)" />
                <stop offset="1" stopColor="var(--edge-dark)" />
              </linearGradient>
              <clipPath id="tape-window">
                <rect x={TAPE_WIN.x} y={TAPE_WIN.y} width={TAPE_WIN.w} height={TAPE_WIN.h} rx={2} />
              </clipPath>
            </defs>

            {/* thickness: the shell's outline pushed down, so its corners stay round */}
            <rect x={0.9} y={0.9 + EDGE} width={W - 1.8} height={H - 1.8} rx={7} fill="url(#edge-shade)" strokeWidth={1.6} />
            <line x1={10} x2={84} y1={H + EDGE / 2} y2={H + EDGE / 2} stroke="var(--seam)" strokeWidth={0.8} />
            <line x1={316} x2={W - 10} y1={H + EDGE / 2} y2={H + EDGE / 2} stroke="var(--seam)" strokeWidth={0.8} />
            {EDGE_OPENINGS.map(([x, w]) => (
              <g key={x}>
                <rect x={x} y={H + 2.5} width={w} height={EDGE - 6} rx={1.2} fill="var(--edge-deep)" strokeWidth={0.9} />
                <line x1={x + 1.5} x2={x + w - 1.5} y1={H + EDGE / 2 - 1} y2={H + EDGE / 2 - 1} stroke="var(--tape-line)" strokeWidth={1.3} />
              </g>
            ))}

            {/* shell */}
            <rect x={0.9} y={0.9} width={W - 1.8} height={H - 1.8} rx={7} fill="var(--paper)" strokeWidth={1.8} />
            <rect x={8} y={8} width={W - 16} height={H - 16} rx={6} strokeWidth={0.8} />
            <Screw x={17} y={17} />
            <Screw x={383} y={17} />
            <Screw x={17} y={239} />
            <Screw x={383} y={239} />

            {/* label */}
            <rect x={28} y={22} width={344} height={152} rx={5} fill="var(--paper)" strokeWidth={1.3} />
            {[32, 37, 42].map((y) => (
              <line key={y} x1={38} x2={362} y1={y} y2={y} strokeWidth={0.9} />
            ))}
            <rect x={38} y={49} width={17} height={19} rx={2} strokeWidth={1} />
            <text x={46.5} y={63} className="side" textAnchor="middle">A</text>
            <line x1={62} x2={362} y1={67} y2={67} strokeWidth={0.9} />
            {title && (
              <text x={66} y={63} className="hand">
                {title.length > 40 ? `${title.slice(0, 39)}…` : title}
              </text>
            )}

            {/* hearts */}
            {[0, 1, 2].map((i) => (
              <Heart key={i} x={W / 2 - 27 + i * 19} y={151} cell={1.45} />
            ))}

            {/* reel strip: two identical hubs, tape window between */}
            <rect x={72} y={78} width={256} height={64} rx={32} fill="var(--paper)" strokeWidth={1.3} />
            <rect x={TAPE_WIN.x} y={TAPE_WIN.y} width={TAPE_WIN.w} height={TAPE_WIN.h} rx={2} fill="var(--tape-bg)" stroke="none" />
            <g clipPath="url(#tape-window)">
              <circle ref={leftPack} cx={HUB_L.x} cy={HUB_L.y} r={R_MAX} fill="var(--tape)" strokeWidth={0.9} />
              <circle ref={rightPack} cx={HUB_R.x} cy={HUB_R.y} r={R_MIN} fill="var(--tape)" strokeWidth={0.9} />
              <path
                d={Array.from({ length: 5 }, (_, i) => `M${188 + i * 6} ${TAPE_WIN.y + TAPE_WIN.h} v${i % 2 ? -3 : -5}`).join(' ')}
                strokeWidth={0.7}
              />
            </g>
            <rect x={TAPE_WIN.x} y={TAPE_WIN.y} width={TAPE_WIN.w} height={TAPE_WIN.h} rx={2} strokeWidth={1.3} />
            <Hub at={HUB_L} reel={leftReel} />
            <Hub at={HUB_R} reel={rightReel} />

            {/* head opening */}
            <path d="M84 256 L102 194 L298 194 L316 256" fill="var(--paper)" strokeWidth={1.4} />
            <line x1={84} x2={316} y1={H - 0.9} y2={H - 0.9} strokeWidth={1.8} />
            <Screw x={200} y={207} />
            <circle cx={130} cy={234} r={6.5} strokeWidth={1.2} />
            <circle cx={270} cy={234} r={6.5} strokeWidth={1.2} />
            <rect x={153} y={228} width={10} height={10} rx={1.5} strokeWidth={1.2} />
            <rect x={237} y={228} width={10} height={10} rx={1.5} strokeWidth={1.2} />
            <rect x={185} y={224} width={30} height={13} rx={2} strokeWidth={1.2} />

            {/* tape guide rollers either side of the opening */}
            {[50, 350].map((cx) => (
              <g key={cx}>
                <circle cx={cx} cy={226} r={10} fill="var(--paper)" strokeWidth={1.3} />
                <circle cx={cx} cy={226} r={6} strokeWidth={1} />
                <circle cx={cx} cy={226} r={2} fill="var(--ink)" stroke="none" />
              </g>
            ))}
          </svg>
        <div className="floor-shadow" aria-hidden />
      </div>

      {/* piano-key transport, like a deck */}
      <div className="deck">
        {buttons.map((b) => (
          <button
            key={b.label}
            type="button"
            className={`key ${b.on ? 'is-down' : ''}`}
            onClick={b.act}
            aria-label={b.label}
            title={b.label}
          >
            <svg viewBox="0 0 24 24" width={18} height={18} aria-hidden>
              <path d={ICONS[b.id]} fill="currentColor" />
            </svg>
          </button>
        ))}

        {/* volume: down, level meter, up */}
        <button type="button" className="key key-small" onClick={() => nudgeVolume(-1)} aria-label="Volume down" title="Volume down">
          <svg viewBox="0 0 24 24" width={18} height={18} aria-hidden>
            <path d={ICONS['vol-down']} fill="currentColor" />
          </svg>
        </button>
        <div className="vol-meter" role="meter" aria-label="Volume" aria-valuemin={0} aria-valuemax={10} aria-valuenow={volume}>
          {Array.from({ length: 10 }, (_, i) => (
            <span key={i} className={i < volume ? 'on' : ''} style={{ height: `${8 + i * 2.2}px` }} />
          ))}
        </div>
        <button type="button" className="key key-small" onClick={() => nudgeVolume(1)} aria-label="Volume up" title="Volume up">
          <svg viewBox="0 0 24 24" width={18} height={18} aria-hidden>
            <path d={ICONS['vol-up']} fill="currentColor" />
          </svg>
        </button>
      </div>

      {/* YouTube player runs off-screen: audio only */}
      <div className="yt-offscreen" ref={ytHost} aria-hidden />

      <input
        ref={fileRef}
        type="file"
        accept="audio/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) load(f)
          e.target.value = ''
        }}
      />
      <audio ref={audioRef} preload="metadata" onEnded={() => setMode('stop')} />
    </div>
  )
}
