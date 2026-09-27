import { useCallback, useEffect, useRef, useState } from 'react'

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

// Thickness is faked with stacked outlines behind the face.
const LAYERS = 18
const LAYER_GAP = 2 // px

// Resting pose: straight on.
const POSE = { x: 0, y: 0, z: 0 }

// Tape length is conserved, so pack radius follows area, not position.
const packRadius = (fill: number) =>
  Math.sqrt(R_MIN * R_MIN + (R_MAX * R_MAX - R_MIN * R_MIN) * fill)

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
}

export function CassettePlayer() {
  const [mode, setMode] = useState<Mode>('stop')
  const [title, setTitle] = useState<string | null>(null)
  const [tilt, setTilt] = useState({ x: 0, y: 0 })

  const audioRef = useRef<HTMLAudioElement>(null)
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
    const d = audioRef.current?.duration
    return title && d && Number.isFinite(d) ? d : DEMO_DURATION
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
  }, [title])

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
        if (title && audio) pos.current = audio.currentTime
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
  }, [paint, title])

  // Keep the <audio> element in step with the transport.
  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !title) return
    if (mode === 'play') {
      audio.currentTime = pos.current
      audio.play().catch(() => setMode('stop'))
    } else {
      audio.pause()
      if (mode === 'stop') audio.currentTime = pos.current
    }
  }, [mode, title])

  const press = (m: Mode) => setMode((cur) => (cur === m ? 'stop' : m))
  const eject = () => fileRef.current?.click()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLButtonElement) return
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
    if (audioRef.current) audioRef.current.src = url
    setTitle(file.name.replace(/\.[^.]+$/, ''))
  }

  const buttons: { id: string; label: string; on: boolean; act: () => void }[] = [
    { id: 'rew', label: 'Rewind', on: mode === 'rew', act: () => press('rew') },
    { id: mode === 'play' ? 'pause' : 'play', label: mode === 'play' ? 'Pause' : 'Play', on: mode === 'play', act: () => press('play') },
    { id: 'stop', label: 'Stop', on: false, act: () => setMode('stop') },
    { id: 'ff', label: 'Fast forward', on: mode === 'ff', act: () => press('ff') },
    { id: 'eject', label: 'Load a tape', on: false, act: eject },
  ]

  return (
    <div className="flex w-full flex-col items-center gap-14">
      <div
        className="stage"
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          setTilt({
            x: ((e.clientY - r.top) / r.height - 0.5) * -10,
            y: ((e.clientX - r.left) / r.width - 0.5) * 12,
          })
        }}
        onPointerLeave={() => setTilt({ x: 0, y: 0 })}
      >
        <div
          className="tape"
          style={{
            transform: `rotateX(${POSE.x + tilt.x}deg) rotateY(${POSE.y + tilt.y}deg) rotateZ(${POSE.z}deg)`,
          }}
        >
          {/* edge: outlines stacked into the depth */}
          {Array.from({ length: LAYERS }, (_, i) => (
            <svg
              key={i}
              className="layer"
              viewBox={`-2 -2 ${W + 4} ${H + 4}`}
              style={{ transform: `translateZ(${-(i + 1) * LAYER_GAP}px)` }}
              aria-hidden
            >
              <rect
                x={0}
                y={0}
                width={W}
                height={H}
                rx={12}
                fill="var(--edge)"
                stroke="var(--ink)"
                strokeWidth={i === LAYERS - 1 ? 1.6 : 1}
                strokeOpacity={i === LAYERS - 1 ? 1 : i % 3 === 0 ? 0.35 : 0.12}
              />
            </svg>
          ))}

          {/* face */}
          <svg
            className="layer cursor-pointer"
            viewBox={`-2 -2 ${W + 4} ${H + 4}`}
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
              <clipPath id="tape-window">
                <rect x={TAPE_WIN.x} y={TAPE_WIN.y} width={TAPE_WIN.w} height={TAPE_WIN.h} rx={2} />
              </clipPath>
            </defs>

            {/* shell */}
            <rect x={0} y={0} width={W} height={H} rx={10} fill="var(--paper)" strokeWidth={1.8} />
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
            <line x1={38} x2={362} y1={156} y2={156} strokeWidth={0.7} />
            <line x1={38} x2={362} y1={161} y2={161} strokeWidth={0.7} />

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
            <Screw x={200} y={207} />
            <circle cx={130} cy={234} r={6.5} strokeWidth={1.2} />
            <circle cx={270} cy={234} r={6.5} strokeWidth={1.2} />
            <rect x={153} y={228} width={10} height={10} rx={1.5} strokeWidth={1.2} />
            <rect x={237} y={228} width={10} height={10} rx={1.5} strokeWidth={1.2} />
            <rect x={185} y={224} width={30} height={13} rx={2} strokeWidth={1.2} />
            <line x1={94} x2={306} y1={249} y2={249} strokeWidth={1} />

            {/* tape guide rollers either side of the opening */}
            {[50, 350].map((cx) => (
              <g key={cx}>
                <circle cx={cx} cy={226} r={10} fill="var(--paper)" strokeWidth={1.3} />
                <circle cx={cx} cy={226} r={6} strokeWidth={1} />
                <circle cx={cx} cy={226} r={2} fill="var(--ink)" stroke="none" />
              </g>
            ))}
          </svg>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {buttons.map((b) => (
          <button
            key={b.label}
            type="button"
            className={`sketch-btn ${b.on ? 'is-on' : ''}`}
            onClick={b.act}
            aria-label={b.label}
            title={b.label}
          >
            <svg viewBox="0 0 24 24" width={20} height={20} aria-hidden>
              <path d={ICONS[b.id]} fill="currentColor" />
            </svg>
          </button>
        ))}
      </div>

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
