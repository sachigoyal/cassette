// Minimal typings for the parts of the YouTube IFrame Player API we use.
export interface YTPlayer {
  playVideo(): void
  pauseVideo(): void
  stopVideo(): void
  seekTo(seconds: number, allowSeekAhead: boolean): void
  cueVideoById(videoId: string): void
  getCurrentTime(): number
  getDuration(): number
  getVideoData(): { title?: string }
  setVolume(volume: number): void
}

export interface YTPlayerEvent {
  target: YTPlayer
  data: number
}

interface YTNamespace {
  Player: new (
    el: HTMLElement,
    opts: {
      width: number
      height: number
      videoId: string
      playerVars?: Record<string, number | string>
      events?: {
        onReady?: (e: YTPlayerEvent) => void
        onStateChange?: (e: YTPlayerEvent) => void
      }
    },
  ) => YTPlayer
}

declare global {
  interface Window {
    YT?: YTNamespace
    onYouTubeIframeAPIReady?: () => void
  }
}

export const YT_STATE = { ended: 0, playing: 1, paused: 2, cued: 5 } as const

let api: Promise<YTNamespace> | null = null

export function loadYouTubeApi(): Promise<YTNamespace> {
  if (api) return api
  api = new Promise((resolve) => {
    if (window.YT?.Player) return resolve(window.YT)
    const prev = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      prev?.()
      resolve(window.YT!)
    }
    const script = document.createElement('script')
    script.src = 'https://www.youtube.com/iframe_api'
    document.head.appendChild(script)
  })
  return api
}

// Accepts watch, youtu.be, shorts, embed, live and music.youtube.com links.
export function parseYouTubeId(text: string): string | null {
  let url: URL
  try {
    url = new URL(text.trim())
  } catch {
    return null
  }
  const host = url.hostname.replace(/^(www|m|music)\./, '')
  let id: string | null = null
  if (host === 'youtu.be') id = url.pathname.slice(1).split('/')[0]
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com')
    id = url.searchParams.get('v') ?? url.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/?#]+)/)?.[1] ?? null
  return id && /^[\w-]{11}$/.test(id) ? id : null
}
