import { FastForward, Maximize, Minimize, Pause, Play, Rewind, Volume2, VolumeX, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatTime } from "../format";

interface Props {
  src: string;
  title: string;
  poster?: string;
  onClose: () => void;
}

const SCALES = [0.5, 1, 2, 3];
const SKIP_SECONDS = 10;

/** Pop-up player: the video at its own pixel size times a preset (x0.5 ... x3) or full screen, with its own controls.
 * The picture never grows past the window; the size actually shown is printed at the bottom right. */
export default function VideoPlayer({ src, title, poster, onClose }: Props) {
  const playerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<[number, number]>([window.innerWidth, window.innerHeight]);
  const [scale, setScale] = useState(1);
  const [size, setSize] = useState<[number, number] | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [full, setFull] = useState(false);

  const toggle = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play().catch(() => {});
    else video.pause();
  };
  const skip = (seconds: number) => {
    const video = videoRef.current;
    if (video) video.currentTime = Math.min(Math.max(0, video.currentTime + seconds), video.duration || 0);
  };
  const toggleFull = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void playerRef.current?.requestFullscreen().catch(() => {});
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      else if (event.key === " " && !(event.target instanceof HTMLInputElement)) {
        event.preventDefault();
        toggle();
      }
    };
    const onFull = () => {
      setFull(document.fullscreenElement === playerRef.current);
      setView([window.innerWidth, window.innerHeight]);
    };
    const onResize = () => setView([window.innerWidth, window.innerHeight]);
    document.addEventListener("keydown", onKey);
    document.addEventListener("fullscreenchange", onFull);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("fullscreenchange", onFull);
      window.removeEventListener("resize", onResize);
    };
  }, [onClose]);

  // Room for the picture: the window minus the pop-up's padding, border, title bar and control bar (full screen has none of the first two).
  const frame = full ? 0 : 50;
  const roomW = view[0] - frame;
  const roomH = view[1] - frame - (headRef.current?.offsetHeight ?? 48) - (barRef.current?.offsetHeight ?? 90);
  // A preset never makes the picture bigger than the room; full screen fits the whole picture into it, up to any size.
  const factor = size ? (full ? Math.min(roomW / size[0], roomH / size[1]) : Math.min(scale, roomW / size[0], roomH / size[1])) : scale;
  const shown = size ? [Math.max(1, Math.floor(size[0] * factor)), Math.max(1, Math.floor(size[1] * factor))] : null;
  const style = shown ? { width: shown[0], height: shown[1] } : undefined;

  return (
    <div className="backdrop" style={{ zIndex: 70 }} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div ref={playerRef} className={`player${full ? " is-full" : ""}`} role="dialog" aria-modal="true" aria-label={`${title} 재생`}>
        <div ref={headRef} className="player-head">
          <span className="player-title" title={title}>
            {title}
          </span>
          <button className="icon-btn" type="button" title="닫기" aria-label="닫기" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="player-stage">
          <video
            ref={videoRef}
            src={src}
            poster={poster}
            style={style}
            autoPlay
            playsInline
            onClick={toggle}
            onLoadedMetadata={(event) => {
              const video = event.currentTarget;
              setSize([video.videoWidth, video.videoHeight]);
              setDuration(video.duration);
            }}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
            onVolumeChange={(event) => {
              setVolume(event.currentTarget.volume);
              setMuted(event.currentTarget.muted);
            }}
          />
        </div>

        <div ref={barRef} className="player-bar">
          <input
            className="player-seek"
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={time}
            aria-label="재생 위치"
            onChange={(event) => {
              if (videoRef.current) videoRef.current.currentTime = Number(event.target.value);
            }}
          />
          <div className="player-controls">
            <button className="icon-btn" type="button" title={`${SKIP_SECONDS}초 뒤로`} aria-label="뒤로" onClick={() => skip(-SKIP_SECONDS)}>
              <Rewind size={18} />
            </button>
            <button className="icon-btn" type="button" title={playing ? "정지" : "재생"} aria-label={playing ? "정지" : "재생"} onClick={toggle}>
              {playing ? <Pause size={20} /> : <Play size={20} />}
            </button>
            <button className="icon-btn" type="button" title={`${SKIP_SECONDS}초 앞으로`} aria-label="앞으로" onClick={() => skip(SKIP_SECONDS)}>
              <FastForward size={18} />
            </button>
            <span className="player-time">
              {formatTime(time)} / {formatTime(duration)}
            </span>
            <span className="spacer" />
            <button
              className="icon-btn"
              type="button"
              title={muted || volume === 0 ? "소리 켜기" : "음소거"}
              aria-label="음소거"
              onClick={() => {
                if (videoRef.current) videoRef.current.muted = !videoRef.current.muted;
              }}
            >
              {muted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
            </button>
            <input
              className="player-volume"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              aria-label="음량"
              onChange={(event) => {
                const video = videoRef.current;
                if (!video) return;
                video.volume = Number(event.target.value);
                video.muted = false;
              }}
            />
            <div className="seg" role="group" aria-label="영상 크기">
              {SCALES.map((value) => (
                <button key={value} type="button" aria-pressed={!full && scale === value} title={size ? `${Math.round(size[0] * value)}×${Math.round(size[1] * value)}` : undefined} onClick={() => { if (document.fullscreenElement) void document.exitFullscreen(); setScale(value); }}>
                  x{value}
                </button>
              ))}
              <button type="button" aria-pressed={full} title={full ? "전체 화면 닫기" : "전체 화면"} onClick={toggleFull}>
                {full ? <Minimize size={14} /> : <Maximize size={14} />}
              </button>
            </div>
            <span className="player-size" title={size ? `원본 ${size[0]}×${size[1]}` : undefined}>
              {shown ? `${shown[0]}×${shown[1]}` : ""}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
