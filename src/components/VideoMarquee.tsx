type Track = { id: string; song: string; artist: string }

// Checked against YouTube's oEmbed endpoint.
const TRACKS: Track[] = [
  { id: 'fJ9rUzIMcZQ', song: 'Bohemian Rhapsody', artist: 'Queen' },
  { id: 'djV11Xbc914', song: 'Take On Me', artist: 'a-ha' },
  { id: 'Zi_XLOBDo_Y', song: 'Billie Jean', artist: 'Michael Jackson' },
  { id: '1w7OgIMMRc4', song: "Sweet Child O' Mine", artist: "Guns N' Roses" },
  { id: 'btPJPFnesV4', song: 'Eye Of The Tiger', artist: 'Survivor' },
  { id: 'FTQbiNvZqaY', song: 'Africa', artist: 'Toto' },
  { id: 'hTWKbfoikeg', song: 'Smells Like Teen Spirit', artist: 'Nirvana' },
  { id: 'dQw4w9WgXcQ', song: 'Never Gonna Give You Up', artist: 'Rick Astley' },
  { id: '4NRXx6U8ABQ', song: 'Blinding Lights', artist: 'The Weeknd' },
  { id: 'OPf0YbXqDm0', song: 'Uptown Funk', artist: 'Mark Ronson ft. Bruno Mars' },
  { id: 'JGwWNGJdvx8', song: 'Shape of You', artist: 'Ed Sheeran' },
  { id: 'YQHsXMglC9A', song: 'Hello', artist: 'Adele' },
  { id: '60ItHLz5WEA', song: 'Faded', artist: 'Alan Walker' },
  { id: 'kJQP7kiw5Fk', song: 'Despacito', artist: 'Luis Fonsi ft. Daddy Yankee' },
  { id: 'lp-EO5I60KA', song: 'Thinking Out Loud', artist: 'Ed Sheeran' },
  { id: 'RgKAFK5djSk', song: 'See You Again', artist: 'Wiz Khalifa ft. Charlie Puth' },
]

const COLUMNS = [TRACKS.slice(0, 8), TRACKS.slice(8)]

// A scrapbook-style card: taped-on photo, handwritten title, typed artist.
function Card({ track, active, onPick, hidden }: { track: Track; active: boolean; onPick: (id: string) => void; hidden?: boolean }) {
  return (
    <button
      type="button"
      className={`jcard ${active ? 'is-active' : ''}`}
      onClick={() => onPick(track.id)}
      tabIndex={hidden ? -1 : undefined}
      title={`Play ${track.song}`}
    >
      <span className="jcard-body">
        {/* a small faded print, taped on */}
        <span className="jcard-art">
          <span className="jcard-photo">
            <img src={`https://i.ytimg.com/vi/${track.id}/mqdefault.jpg`} alt="" loading="lazy" width={320} height={180} />
            <span className="jcard-play" aria-hidden>
              <svg viewBox="0 0 24 24" width={14} height={14}>
                <path d="M8 5 L19 12 L8 19 Z" fill="currentColor" />
              </svg>
            </span>
          </span>
        </span>
        <span className="jcard-text">
          <span className="jcard-song">{track.song}</span>
          <span className="jcard-artist">{track.artist}</span>
          {active && <span className="jcard-now">now playing</span>}
        </span>
      </span>
    </button>
  )
}

// Two columns of music videos drifting in opposite directions; click one to load it.
export function VideoMarquee({ activeId, onPick }: { activeId: string | null; onPick: (id: string) => void }) {
  return (
    <>
      {COLUMNS.map((tracks, col) => (
        <div key={col} className={`marquee ${col ? 'is-right' : 'is-left'}`}>
          <div className="marquee-track">
            {/* the list twice, so the loop is seamless */}
            {[0, 1].map((copy) => (
              <div key={copy} aria-hidden={copy === 1 || undefined}>
                {tracks.map((t) => (
                  <Card key={t.id} track={t} active={t.id === activeId} onPick={onPick} hidden={copy === 1} />
                ))}
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  )
}
