import { useCallback, useEffect, useRef, useState } from 'react'
import { YT_STATE, loadYouTubeApi, parseYouTubeId, type YTPlayer } from '#/lib/youtube'
import { VideoMarquee } from '#/components/VideoMarquee'

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

// Uneven winding marks on the tape pack, so its rotation is visible.
const rand = (i: number) => {
  const x = Math.sin(i * 12.9898) * 43758.5453
  // Math.sin can differ in the last digits between server and browser; round it off.
  return Math.round((x - Math.floor(x)) * 1000) / 1000
}
const PACK_STREAKS = Array.from({ length: 14 }, (_, i) => ({
  angle: rand(i + 1) * 360,
  from: 0.35 + rand(i + 20) * 0.3,
  to: 0.8 + rand(i + 40) * 0.18,
  width: 0.6 + rand(i + 60) * 1.6,
  light: rand(i + 80) > 0.45,
}))
const PACK_WOBBLES = [0.9, 0.76, 0.61, 0.5].map((f, i) => ({ f, dx: (rand(i + 100) - 0.5) * 3, dy: (rand(i + 120) - 0.5) * 3 }))

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

// Chrome cross-head screw.
function Screw({ x, y, r = 5 }: { x: number; y: number; r?: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle r={r + 0.8} fill="#0a0a0b" stroke="none" />
      <circle r={r} fill="url(#metal)" stroke="#3a3a3c" strokeWidth={0.5} />
      <path
        d={`M${-r * 0.6} 0 H${r * 0.6} M0 ${-r * 0.6} V${r * 0.6}`}
        stroke="#2c2c2e"
        strokeWidth={1.3}
        strokeLinecap="round"
      />
    </g>
  )
}

// White plastic hub in its hole in the shell; slots ring the rim, teeth grip the spindle.
function Hub({ at, reel }: { at: { x: number; y: number }; reel: React.RefObject<SVGGElement | null> }) {
  return (
    <g transform={`translate(${at.x} ${at.y})`} stroke="none">
      <circle r={26} fill="#070708" />
      <circle r={25.2} fill="none" stroke="#000" strokeWidth={1.6} opacity={0.8} />
      <g ref={reel}>
        <circle r={22} fill="url(#hub-plastic)" />
        <circle r={21.4} fill="none" stroke="#ffffff" strokeWidth={0.6} opacity={0.7} />
        {Array.from({ length: 12 }, (_, i) => (
          <rect key={i} x={-1.5} y={-19} width={3} height={4.5} rx={1} fill="#4a4a4d" transform={`rotate(${i * 30})`} />
        ))}
        <circle r={11.5} fill="#121214" />
        {Array.from({ length: 6 }, (_, i) => (
          <rect key={i} x={-2} y={-11.8} width={4} height={4.3} rx={0.6} fill="#e9e9e5" transform={`rotate(${i * 60 + 30})`} />
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
  const [ytId, setYtId] = useState<string | null>(null)
  const [volume, setVolume] = useState(8) // 0–10 steps
  const volumeRef = useRef(8)
  volumeRef.current = volume
  const [linkError, setLinkError] = useState(false)
  const [draft, setDraft] = useState<string | null>(null) // label text while editing

  const audioRef = useRef<HTMLAudioElement>(null)
  const ytRef = useRef<YTPlayer | null>(null)
  const ytHost = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const urlRef = useRef<string | null>(null)

  const leftReel = useRef<SVGGElement>(null)
  const rightReel = useRef<SVGGElement>(null)
  const leftPack = useRef<SVGGElement>(null)
  const rightPack = useRef<SVGGElement>(null)
  const leftPackSpin = useRef<SVGGElement>(null)
  const rightPackSpin = useRef<SVGGElement>(null)

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
    leftPack.current?.setAttribute('transform', `translate(${HUB_L.x} ${HUB_L.y}) scale(${rl / R_MAX})`)
    rightPack.current?.setAttribute('transform', `translate(${HUB_R.x} ${HUB_R.y}) scale(${rr / R_MAX})`)
    leftReel.current?.setAttribute('transform', `rotate(${angle.current.l})`)
    rightReel.current?.setAttribute('transform', `rotate(${angle.current.r})`)
    leftPackSpin.current?.setAttribute('transform', `rotate(${angle.current.l})`)
    rightPackSpin.current?.setAttribute('transform', `rotate(${angle.current.r})`)
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
    setYtId(null)
    setTitle(file.name.replace(/\.[^.]+$/, ''))
  }

  // The YouTube player plays off-screen, so only the audio comes through.
  const loadYouTube = async (videoId: string) => {
    setMode('stop')
    pos.current = 0
    audioRef.current?.pause()
    setSource('yt')
    setYtId(videoId)
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
      <VideoMarquee activeId={ytId} onPick={(id) => void loadYouTube(id)} />

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
              {/* black plastic shell */}
              <linearGradient id="shell" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#35353b" />
                <stop offset="0.45" stopColor="#202024" />
                <stop offset="1" stopColor="#151517" />
              </linearGradient>
              <linearGradient id="sheen" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#fff" stopOpacity={0.12} />
                <stop offset="0.35" stopColor="#fff" stopOpacity={0.03} />
                <stop offset="0.5" stopColor="#fff" stopOpacity={0} />
              </linearGradient>
              <pattern id="ribs" width={4} height={2.4} patternUnits="userSpaceOnUse">
                <rect width={4} height={1} fill="#fff" opacity={0.025} />
              </pattern>
              <linearGradient id="edge" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#2c2c31" />
                <stop offset="1" stopColor="#141417" />
              </linearGradient>
              <linearGradient id="lower" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#46464d" />
                <stop offset="1" stopColor="#2c2c32" />
              </linearGradient>

              {/* cream paper label with a little grain */}
              <linearGradient id="paper" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#f8f1e2" />
                <stop offset="1" stopColor="#ece0c7" />
              </linearGradient>
              <filter id="grain" x="0" y="0" width="100%" height="100%">
                <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves={2} stitchTiles="stitch" />
                <feColorMatrix values="0 0 0 0 0.35  0 0 0 0 0.28  0 0 0 0 0.2  0 0 0 0.09 0" />
                <feComposite in2="SourceGraphic" operator="in" />
              </filter>

              {/* reel window: smoked clear plastic */}
              <linearGradient id="smoke" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#1b1b1f" />
                <stop offset="1" stopColor="#0c0c0e" />
              </linearGradient>
              <linearGradient id="glass" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#fff" stopOpacity={0.22} />
                <stop offset="0.3" stopColor="#fff" stopOpacity={0.06} />
                <stop offset="0.31" stopColor="#fff" stopOpacity={0} />
              </linearGradient>
              <radialGradient id="tape-pack" cx="0.5" cy="0.5" r="0.5">
                <stop offset="0.2" stopColor="#2f1f15" />
                <stop offset="0.75" stopColor="#4a3121" />
                <stop offset="0.95" stopColor="#6a4a32" />
                <stop offset="1" stopColor="#3a2518" />
              </radialGradient>
              {/* light catching the wound tape */}
              <linearGradient id="pack-sheen" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#fff" stopOpacity={0.18} />
                <stop offset="0.45" stopColor="#fff" stopOpacity={0} />
                <stop offset="1" stopColor="#000" stopOpacity={0.25} />
              </linearGradient>
              {/* translucent slip sheet behind the tape */}
              <linearGradient id="slip" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#56565c" />
                <stop offset="1" stopColor="#2e2e33" />
              </linearGradient>
              <radialGradient id="hub-plastic" cx="0.38" cy="0.32" r="0.75">
                <stop offset="0" stopColor="#ffffff" />
                <stop offset="0.7" stopColor="#eceae4" />
                <stop offset="1" stopColor="#c9c7c0" />
              </radialGradient>
              <radialGradient id="metal" cx="0.35" cy="0.3" r="0.8">
                <stop offset="0" stopColor="#ffffff" />
                <stop offset="0.45" stopColor="#c9c9cc" />
                <stop offset="1" stopColor="#7c7c80" />
              </radialGradient>
              <radialGradient id="roller" cx="0.4" cy="0.35" r="0.7">
                <stop offset="0" stopColor="#ffffff" />
                <stop offset="1" stopColor="#bdbbb4" />
              </radialGradient>

              <clipPath id="tape-window">
                <rect x={TAPE_WIN.x} y={TAPE_WIN.y} width={TAPE_WIN.w} height={TAPE_WIN.h} rx={2} />
              </clipPath>
              <clipPath id="label-clip">
                <rect x={28} y={22} width={344} height={152} rx={5} />
              </clipPath>
            </defs>

            {/* thickness */}
            <rect x={0.5} y={0.5 + EDGE} width={W - 1} height={H - 1} rx={7} fill="url(#edge)" stroke="#000" strokeWidth={1} />
            <line x1={10} x2={84} y1={H + EDGE / 2} y2={H + EDGE / 2} stroke="#000" strokeWidth={0.8} opacity={0.6} />
            <line x1={316} x2={W - 10} y1={H + EDGE / 2} y2={H + EDGE / 2} stroke="#000" strokeWidth={0.8} opacity={0.6} />
            <line x1={10} x2={84} y1={H + EDGE / 2 + 1} y2={H + EDGE / 2 + 1} stroke="#fff" strokeWidth={0.5} opacity={0.09} />
            <line x1={316} x2={W - 10} y1={H + EDGE / 2 + 1} y2={H + EDGE / 2 + 1} stroke="#fff" strokeWidth={0.5} opacity={0.09} />
            {EDGE_OPENINGS.map(([x, w]) => (
              <g key={x} stroke="none">
                <rect x={x} y={H + 3} width={w} height={EDGE - 7} rx={1.2} fill="#050506" />
                <rect x={x + 1.5} y={H + EDGE / 2 - 1.4} width={w - 3} height={1.8} fill="#5e412d" opacity={0.8} />
                {/* light catching the lower lip of each opening */}
                <rect x={x + 0.5} y={H + EDGE - 4.3} width={w - 1} height={0.7} fill="#fff" opacity={0.14} />
              </g>
            ))}

            {/* light catching the edge just under the face */}
            <line x1={6} x2={W - 6} y1={H + 1.2} y2={H + 1.2} stroke="#fff" strokeWidth={0.8} opacity={0.16} />

            {/* shell */}
            <rect x={0.5} y={0.5} width={W - 1} height={H - 1} rx={7} fill="url(#shell)" stroke="#000" strokeWidth={1} />
            <rect x={0.5} y={0.5} width={W - 1} height={H - 1} rx={7} fill="url(#ribs)" stroke="none" />
            <rect x={0.5} y={0.5} width={W - 1} height={H - 1} rx={7} fill="url(#sheen)" stroke="none" />
            <rect x={1.5} y={1.5} width={W - 3} height={H - 3} rx={6} stroke="#fff" strokeWidth={0.6} opacity={0.14} />
            <rect x={8} y={8} width={W - 16} height={H - 16} rx={5} stroke="#000" strokeWidth={0.9} opacity={0.7} />
            <rect x={8.8} y={8.8} width={W - 17.6} height={H - 17.6} rx={5} stroke="#fff" strokeWidth={0.5} opacity={0.07} />
            <Screw x={17} y={17} />
            <Screw x={383} y={17} />
            <Screw x={17} y={239} />
            <Screw x={383} y={239} />

            {/* label */}
            <rect x={28} y={23.2} width={344} height={152} rx={5} fill="#000" opacity={0.45} stroke="none" />
            <g clipPath="url(#label-clip)" stroke="none">
              <rect x={28} y={22} width={344} height={152} fill="url(#paper)" />
              <rect x={28} y={22} width={344} height={152} fill="#fff" filter="url(#grain)" />
              <rect x={28} y={29} width={344} height={4.5} fill="var(--stripe-1)" />
              <rect x={28} y={33.5} width={344} height={4.5} fill="var(--stripe-2)" />
              <rect x={28} y={38} width={344} height={4.5} fill="var(--stripe-3)" />
            </g>
            <rect x={38} y={49} width={17} height={19} rx={2} stroke="#2a2a2a" strokeWidth={1} />
            <text x={46.5} y={63} className="side" textAnchor="middle">A</text>
            <line x1={62} x2={362} y1={67} y2={67} stroke="#8c7f69" strokeWidth={0.8} />
            {/* the label's pen line doubles as the link input */}
            <foreignObject x={62} y={45} width={300} height={24} onClick={(e) => e.stopPropagation()}>
              <input
                className="label-input"
                type="text"
                spellCheck={false}
                aria-label="YouTube link"
                aria-invalid={linkError}
                value={draft ?? title ?? ''}
                onFocus={(e) => {
                  setDraft('')
                  setLinkError(false)
                  e.currentTarget.select()
                }}
                onBlur={() => {
                  setDraft(null)
                  setLinkError(false)
                }}
                onChange={(e) => {
                  const v = e.currentTarget.value
                  setDraft(v)
                  setLinkError(false)
                  if (parseYouTubeId(v) && tryLink(v)) e.currentTarget.blur()
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') e.currentTarget.blur()
                  if (e.key === 'Enter' && tryLink(e.currentTarget.value)) e.currentTarget.blur()
                }}
              />
            </foreignObject>

            {/* hearts */}
            {[0, 1, 2].map((i) => (
              <Heart key={i} x={W / 2 - 27 + i * 19} y={151} cell={1.45} />
            ))}

            {/* reel window: smoked plastic, hubs, tape seen through the centre */}
            <rect x={72} y={78} width={256} height={64} rx={32} fill="url(#smoke)" stroke="#000" strokeWidth={1.2} />
            {/* centre window: slip sheet, wound tape, printed scale, glass */}
            <rect x={TAPE_WIN.x - 1.5} y={TAPE_WIN.y - 1.5} width={TAPE_WIN.w + 3} height={TAPE_WIN.h + 3} rx={3} fill="#050506" stroke="none" />
            <g clipPath="url(#tape-window)" stroke="none">
              <rect x={TAPE_WIN.x} y={TAPE_WIN.y} width={TAPE_WIN.w} height={TAPE_WIN.h} fill="url(#slip)" />
              {[leftPack, rightPack].map((ref, i) => (
                <g
                  key={i}
                  ref={ref}
                  transform={`translate(${(i ? HUB_R : HUB_L).x} ${HUB_L.y}) scale(${i ? R_MIN / R_MAX : 1})`}
                >
                  <circle r={R_MAX} fill="url(#tape-pack)" />
                  {[0.94, 0.87, 0.8, 0.72, 0.63, 0.54, 0.45].map((f) => (
                    <circle key={f} r={R_MAX * f} fill="none" stroke="#8a6445" strokeWidth={0.6} opacity={0.28} />
                  ))}
                  {/* uneven winding that turns with the reel */}
                  <g ref={i ? rightPackSpin : leftPackSpin}>
                    {PACK_WOBBLES.map(({ f, dx, dy }) => (
                      <circle key={f} cx={dx} cy={dy} r={R_MAX * f} fill="none" stroke="#1c120b" strokeWidth={1.4} opacity={0.35} />
                    ))}
                    {PACK_STREAKS.map((k, j) => (
                      <line
                        key={j}
                        x1={0}
                        y1={-R_MAX * k.from}
                        x2={0}
                        y2={-R_MAX * k.to}
                        stroke={k.light ? '#c99a6c' : '#140c07'}
                        strokeWidth={k.width}
                        opacity={k.light ? 0.3 : 0.4}
                        transform={`rotate(${k.angle})`}
                      />
                    ))}
                  </g>
                  <circle r={R_MAX - 0.7} fill="none" stroke="#a57a55" strokeWidth={1.2} opacity={0.85} />
                  <circle r={R_MAX} fill="url(#pack-sheen)" />
                </g>
              ))}
              {/* inner shadow along the top of the opening */}
              <rect x={TAPE_WIN.x} y={TAPE_WIN.y} width={TAPE_WIN.w} height={3} fill="#000" opacity={0.45} />
              {/* scale printed on the window */}
              <line x1={TAPE_WIN.x + 10} x2={TAPE_WIN.x + TAPE_WIN.w - 10} y1={TAPE_WIN.y + TAPE_WIN.h - 4} y2={TAPE_WIN.y + TAPE_WIN.h - 4} stroke="#f3efe4" strokeWidth={0.6} opacity={0.85} />
              <path
                d={Array.from({ length: 11 }, (_, i) => {
                  const x = TAPE_WIN.x + 10 + (i * (TAPE_WIN.w - 20)) / 10
                  return `M${x} ${TAPE_WIN.y + TAPE_WIN.h - 4} v${i % 5 === 0 ? -5 : -2.6}`
                }).join(' ')}
                stroke="#f3efe4"
                strokeWidth={0.6}
                opacity={0.85}
              />
              {/* glass reflections */}
              <path
                d={`M${TAPE_WIN.x + 12} ${TAPE_WIN.y} h14 l-12 ${TAPE_WIN.h} h-14 Z`}
                fill="#fff"
                opacity={0.1}
              />
              <path
                d={`M${TAPE_WIN.x + 30} ${TAPE_WIN.y} h4 l-12 ${TAPE_WIN.h} h-4 Z`}
                fill="#fff"
                opacity={0.08}
              />
            </g>
            {/* bevelled frame */}
            <rect x={TAPE_WIN.x} y={TAPE_WIN.y} width={TAPE_WIN.w} height={TAPE_WIN.h} rx={2} stroke="#000" strokeWidth={1.1} />
            <path
              d={`M${TAPE_WIN.x - 1.6} ${TAPE_WIN.y + TAPE_WIN.h + 1.8} H${TAPE_WIN.x + TAPE_WIN.w + 1.6}`}
              stroke="#fff"
              strokeWidth={0.6}
              opacity={0.16}
            />
            <Hub at={HUB_L} reel={leftReel} />
            <Hub at={HUB_R} reel={rightReel} />
            <rect x={72} y={78} width={256} height={64} rx={32} fill="url(#glass)" stroke="none" />
            <rect x={73} y={79} width={254} height={62} rx={31} stroke="#fff" strokeWidth={0.6} opacity={0.12} />

            {/* head opening: a lighter moulded panel, lit along its top and sides */}
            <path d="M84 256 L102 194 L298 194 L316 256 Z" fill="url(#lower)" stroke="#000" strokeWidth={1} />
            <path d="M102.8 195 H297.2" stroke="#fff" strokeWidth={0.9} opacity={0.28} />
            <path d="M85.5 255 L103 195.5 M314.5 255 L297 195.5" stroke="#fff" strokeWidth={0.7} opacity={0.14} />
            <Screw x={200} y={207} />
            {/* holes: dark opening, shadowed top, lit lower rim */}
            <g stroke="none">
              {[130, 270].map((cx) => (
                <g key={cx}>
                  <circle cx={cx} cy={234.6} r={7.2} fill="#fff" opacity={0.18} />
                  <circle cx={cx} cy={234} r={7} fill="#000" />
                  <circle cx={cx} cy={234.8} r={5.4} fill="#141416" />
                </g>
              ))}
              {[
                [153, 228, 10, 10],
                [237, 228, 10, 10],
                [185, 224, 30, 13],
              ].map(([x, y, w, h]) => (
                <g key={x}>
                  <rect x={x - 0.3} y={y + 0.7} width={w + 0.6} height={h} rx={2} fill="#fff" opacity={0.18} />
                  <rect x={x} y={y} width={w} height={h} rx={1.8} fill="#000" />
                  <rect x={x + 1.4} y={y + 1.8} width={w - 2.8} height={h - 2.8} rx={1} fill="#141416" />
                </g>
              ))}
            </g>

            {/* tape guide rollers either side of the opening */}
            {[50, 350].map((cx) => (
              <g key={cx} stroke="none">
                <circle cx={cx} cy={226} r={10.5} fill="#070708" />
                <circle cx={cx} cy={226} r={7} fill="url(#roller)" />
                <circle cx={cx} cy={226} r={2.4} fill="url(#metal)" stroke="#555" strokeWidth={0.4} />
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
            <span
              key={i}
              className={i < volume ? 'on' : ''}
              style={{
                height: `${8 + i * 2.2}px`,
                '--led': i < 6 ? 'var(--led-green)' : i < 8 ? 'var(--led-amber)' : 'var(--led-red)',
              } as React.CSSProperties}
            />
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
