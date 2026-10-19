import { useState } from "react";
import { mediaUrl } from "../api";
import GenerateForm from "../components/GenerateForm";
import JobList from "../components/JobList";
import Lightbox from "../components/Lightbox";
import type { SectionProps } from "./types";

const sizeLabel = (bytes: number) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(bytes / 1024))}KB`);

/** Shared top of the three media screens: the generate form and the jobs that are not finished yet. */
function MediaTop({ props, kinds, tools }: { props: SectionProps; kinds: Parameters<typeof GenerateForm>[0]["kinds"]; tools: string[] }) {
  const { project, detail, view, jobs, onJobsChanged, notify } = props;
  return (
    <>
      <GenerateForm projectId={project.id} kinds={kinds} view={view} media={{ images: detail?.media.images ?? [], audio: detail?.media.audio ?? [] }} running={jobs.current !== null} notify={notify} onStarted={onJobsChanged} />
      <JobList projectId={project.id} jobs={jobs.history} tools={tools} onChanged={onJobsChanged} />
    </>
  );
}

/** The project's images: every file of assets/images, plus making a new one. */
export function ImagesSection(props: SectionProps) {
  const [open, setOpen] = useState<string | null>(null);
  const images = props.detail?.media.images ?? [];
  return (
    <div className="section">
      <h2>
        이미지<span className="count">{images.length}</span>
      </h2>
      <MediaTop props={props} kinds={["image"]} tools={["comfyui_krea_image"]} />
      {images.length === 0 ? (
        <p className="muted">아직 이미지가 없습니다. 위에서 만들어 보세요.</p>
      ) : (
        <div className="thumbs big">
          {images.map((file) => (
            <button key={file.path} type="button" title={file.path} onClick={() => setOpen(file.path)}>
              <img src={mediaUrl(props.project.id, file.path)} alt={file.path} loading="lazy" />
              <span>{file.path.replace("assets/images/", "")}</span>
            </button>
          ))}
        </div>
      )}
      {open && <Lightbox src={mediaUrl(props.project.id, open)} alt={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** The project's audio: narration and music files, plus reading a new line aloud. */
export function AudioSection(props: SectionProps) {
  const audio = props.detail?.media.audio ?? [];
  return (
    <div className="section">
      <h2>
        오디오<span className="count">{audio.length}</span>
      </h2>
      <MediaTop props={props} kinds={["voice"]} tools={["qwen3_tts", "songyue_music"]} />
      {audio.length === 0 ? (
        <p className="muted">아직 오디오가 없습니다. 위에서 음성을 만들어 보세요.</p>
      ) : (
        <div className="audio-list">
          {audio.map((file) => (
            <div key={file.path} className="audio-row">
              <span className="audio-name" title={file.path}>
                {file.path.replace(/^assets\//, "")} <span className="muted">· {sizeLabel(file.size)}</span>
              </span>
              <audio controls preload="metadata" src={mediaUrl(props.project.id, file.path)} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** The project's videos: the finished one and every clip, plus making a new clip. */
export function VideosSection(props: SectionProps) {
  const videos = props.detail?.media.videos ?? [];
  return (
    <div className="section">
      <h2>
        동영상<span className="count">{videos.length}</span>
      </h2>
      <MediaTop props={props} kinds={["i2v", "fl2v", "s2v"]} tools={["h3_local_video"]} />
      {videos.length === 0 ? (
        <p className="muted">아직 동영상이 없습니다. 이미지를 고르고 위에서 만들어 보세요.</p>
      ) : (
        <div className="videos">
          {videos.map((file) => (
            <div key={file.path}>
              <div className="muted" style={{ marginBottom: 6, fontSize: 12 }}>
                {file.path} · {sizeLabel(file.size)}
              </div>
              <video controls preload="metadata" src={mediaUrl(props.project.id, file.path)} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
