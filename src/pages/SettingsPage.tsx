import { Check, Film, FolderCog, Image as ImageIcon, Mic, Save, SlidersHorizontal, Sparkles, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api, ApiError, type FolderInfo, type LlmProviderStatus, type Settings } from "../api";
import EngineSettings, { ENGINE_PATHS } from "../components/EngineSettings";
import SettingField from "../components/SettingField";
import SizePicker from "../components/SizePicker";
import { changedPaths, FIELDS, getIn, setIn } from "../fields";

interface Props {
  notify: (text: string) => void;
  onSaved: () => void;
}

const PROVIDER_TILES = [
  { id: "claude-cli", glyph: "C", name: "Claude CLI", sub: "이 PC에 로그인된 CLI" },
  { id: "codex-cli", glyph: "Cx", name: "Codex CLI", sub: "ChatGPT에 로그인된 CLI" },
  { id: "opencode-cli", glyph: "Oc", name: "OpenCode CLI", sub: "이 PC의 OpenCode" },
  { id: "ollama", glyph: "O", name: "Ollama", sub: "내 PC에서 실행" },
];

const FOLDER_KEYS: Record<string, string> = { "storage.projectsDir": "projects", "storage.inputDir": "input", "storage.outputDir": "output" };

const LLM_PATHS = ["llm.provider", "llm.model", "llm.ollama.endpoint", "llm.ollama.model", "llm.chain", "llm.timeoutSec"];
const SIZE_PATHS = ["defaults.sizeId", "defaults.customSize.generate", "defaults.customSize.final"];
const VIDEO_PATHS = [...SIZE_PATHS, "defaults.durationSeconds", "defaults.videoMode", "video.model", "video.upscale", "video.finalFps"];
const IMAGE_PATHS = ["defaults.imageModel"];
const AUDIO_PATHS = ["defaults.audioSource", "audio.musicFormat", "audio.voice.tool", "audio.voice.name", "audio.voice.language"];
const LOCAL_PATHS = ["connections.songyueUrl", "connections.comfyUrl", "connections.openmontageDir", "connections.ffmpegPath", "storage.projectsDir", "storage.inputDir", "storage.outputDir"];

interface SectionProps {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  badge?: string;
  dirty: number;
  note?: string;
  extra?: ReactNode;
  onCancel: () => void;
  onSave: () => void;
  children: ReactNode;
}

/** A settings card like SongYUE2's: icon tile, title, fields, and its own cancel/save buttons. */
function Section({ icon: Icon, title, subtitle, badge, dirty, note, extra, onCancel, onSave, children }: SectionProps) {
  return (
    <section className="scard">
      <div className="scard-head">
        <div className="icon-tile">
          <Icon size={20} />
        </div>
        <div className="titles">
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        {badge && <span className="badge">{badge}</span>}
      </div>
      {children}
      <div className="scard-foot">
        <span className="note">{note ?? (dirty ? `바꾼 항목 ${dirty}개` : "")}</span>
        <button className="btn" type="button" disabled={dirty === 0} onClick={onCancel}>
          변경 취소
        </button>
        {extra}
        <button className="btn primary" type="button" disabled={dirty === 0} onClick={onSave}>
          <Save size={15} /> 설정 저장
        </button>
      </div>
    </section>
  );
}

export default function SettingsPage({ notify, onSaved }: Props) {
  const [saved, setSaved] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState("");
  const [llm, setLlm] = useState<LlmProviderStatus[]>([]);
  const [folders, setFolders] = useState<Record<string, FolderInfo>>({});

  const refreshLlm = useCallback(
    () =>
      api<{ providers: LlmProviderStatus[] }>("GET", "/api/llm/status")
        .then((data) => {
          setLlm(data.providers);
          return data.providers;
        })
        .catch(() => [] as LlmProviderStatus[]),
    [],
  );
  const refreshFolders = useCallback(
    () =>
      api<{ folders: Record<string, FolderInfo> }>("GET", "/api/folders")
        .then((data) => setFolders(data.folders))
        .catch(() => {}),
    [],
  );

  useEffect(() => {
    api<{ settings: Settings }>("GET", "/api/settings")
      .then(({ settings }) => {
        setSaved(settings);
        setDraft(settings);
      })
      .catch(() => setLoadError("설정을 불러오지 못했습니다."));
    void refreshLlm();
    void refreshFolders();
  }, [refreshLlm, refreshFolders]);

  if (!saved || !draft) {
    return (
      <div className="page">
        <p className={loadError ? "error" : "muted"}>{loadError || "불러오는 중..."}</p>
      </div>
    );
  }

  const dirtyOf = (paths: string[]) => changedPaths(saved, draft, paths);
  const change = (path: string, value: unknown) => setDraft(setIn(draft as unknown as Record<string, unknown>, path, value) as unknown as Settings);
  const cancel = (paths: string[]) => {
    let next = draft as unknown as Record<string, unknown>;
    for (const path of paths) next = setIn(next, path, getIn(saved, path));
    setDraft(next as unknown as Settings);
    setErrors({});
  };

  /** Saves only this section's changed values, so other sections' unsaved edits are left alone. */
  async function save(paths: string[]): Promise<boolean> {
    let patch: Record<string, unknown> = {};
    for (const path of dirtyOf(paths)) patch = setIn(patch, path, getIn(draft, path));
    try {
      const { settings } = await api<{ settings: Settings }>("PUT", "/api/settings", patch);
      // Adopt the server's values for what was saved; unsaved edits in other sections stay in the draft.
      let nextDraft = draft as unknown as Record<string, unknown>;
      for (const path of paths) nextDraft = setIn(nextDraft, path, getIn(settings, path));
      setSaved(settings);
      setDraft(nextDraft as unknown as Settings);
      setErrors({});
      onSaved();
      void refreshFolders();
      notify("설정을 저장했습니다.");
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.errors) setErrors(Object.fromEntries(e.errors.map((item) => [item.path, item.message])));
      notify(e instanceof ApiError ? e.message : "저장하지 못했습니다.");
      return false;
    }
  }

  const folderNote = (path: string): ReactNode => {
    const info = folders[FOLDER_KEYS[path]];
    if (!info) return null;
    if (info.isFile) return <span className="folder-status warn">⚠ 폴더가 아니라 파일입니다: {info.path}</span>;
    if (info.exists) return <span className="folder-status ok">✓ {info.path}</span>;
    const creates = path !== "storage.projectsDir";
    return (
      <span className="folder-status warn">
        ⚠ 아직 없음: {info.path}
        {creates ? " (설정을 저장하면 만들어집니다)" : ""}
      </span>
    );
  };

  const renderField = (path: string) => (
    <div key={path} style={FIELDS[path].wide ? { gridColumn: "1 / -1" } : undefined}>
      <SettingField field={{ ...FIELDS[path], wide: false }} value={getIn(draft, path)} error={errors[path]} onChange={(value) => change(path, value)} />
      {folderNote(path)}
    </div>
  );

  const section = (paths: string[]) => ({ dirty: dirtyOf(paths).length, onCancel: () => cancel(paths), onSave: () => void save(paths) });

  const provider = String(getIn(draft, "llm.provider"));
  const status = (id: string) => llm.find((item) => item.id === id);
  const ollama = status("ollama");

  async function saveAndCheck() {
    if (dirtyOf(LLM_PATHS).length > 0 && !(await save(LLM_PATHS))) return;
    const providers = await refreshLlm();
    const chosen = providers.find((item) => item.id === provider);
    const name = PROVIDER_TILES.find((tile) => tile.id === provider)?.name ?? provider;
    notify(chosen?.ready ? `${name}을(를) 사용할 수 있습니다.` : `${name}을(를) 아직 쓸 수 없습니다. ${provider === "ollama" ? "Ollama가 실행 중인지 확인하세요." : "명령이 설치되어 있는지 확인하세요."}`);
  }

  return (
    <div className="page settings">
      <div className="page-head">
        <div>
          <div className="kicker">내 작업 방식에 맞게</div>
          <h1>스튜디오 설정</h1>
          <p className="sub">영상 도구와 로컬 작업 환경을 설정하세요. 영상마다 바꾸는 값은 시작 화면에 있습니다.</p>
        </div>
      </div>

      <Section
        icon={Sparkles}
        title="대본 도우미"
        subtitle="줄거리, 시나리오, 대본을 쓸 LLM을 선택하세요."
        badge="필수 기능"
        note="CLI는 이 PC에 로그인된 명령을 그대로 씁니다. 키는 저장하지 않습니다."
        extra={
          <button className="btn" type="button" onClick={() => void saveAndCheck()}>
            저장 후 연결 확인
          </button>
        }
        {...section(LLM_PATHS)}
      >
        <div className="tiles" role="group" aria-label="LLM 선택">
          {PROVIDER_TILES.map((tile) => {
            const info = status(tile.id);
            const selected = provider === tile.id;
            return (
              <button key={tile.id} className="tile" type="button" aria-pressed={selected} onClick={() => change("llm.provider", tile.id)}>
                {selected && <Check className="check-mark" size={14} />}
                <span className="glyph">{tile.glyph}</span>
                <strong>{tile.name}</strong>
                <span>{tile.sub}</span>
                {info && <span className={info.ready ? "ready" : "notready"}>{info.ready ? "사용 가능" : tile.id === "ollama" ? "연결 안 됨" : "설치되지 않음"}</span>}
              </button>
            );
          })}
        </div>
        <div className="fields">
          {provider === "ollama" ? (
            <>
              {renderField("llm.ollama.endpoint")}
              <div style={{ gridColumn: "1 / -1" }}>
                <SettingField field={{ ...FIELDS["llm.ollama.model"], wide: false }} value={getIn(draft, "llm.ollama.model")} error={errors["llm.ollama.model"]} onChange={(value) => change("llm.ollama.model", value)} />
                {ollama?.models && ollama.models.length > 0 && (
                  <span className="hint">
                    설치된 모델:{" "}
                    {ollama.models.map((name) => (
                      <button key={name} className="link" type="button" style={{ marginRight: 8 }} onClick={() => change("llm.ollama.model", name)}>
                        {name}
                      </button>
                    ))}
                  </span>
                )}
              </div>
            </>
          ) : (
            renderField("llm.model")
          )}
          {renderField("llm.chain")}
          {renderField("llm.timeoutSec")}
        </div>
      </Section>

      <Section icon={Film} title="영상 기본값" subtitle="새 프로젝트가 따르는 영상 설정입니다. 크기는 프리셋에서 고르거나 직접 입력하고, 프로젝트마다 시작 화면에서 바꿀 수 있어요." {...section(VIDEO_PATHS)}>
        <div className="fields">
          <div style={{ gridColumn: "1 / -1" }}>
            <SizePicker
              sizeId={String(getIn(draft, "defaults.sizeId"))}
              custom={{ generate: getIn(draft, "defaults.customSize.generate"), final: getIn(draft, "defaults.customSize.final") }}
              errors={{ sizeId: errors["defaults.sizeId"], generate: errors["defaults.customSize.generate"], final: errors["defaults.customSize.final"] }}
              onSizeId={(id) => change("defaults.sizeId", id)}
              onCustom={(which, value) => change(`defaults.customSize.${which}`, value)}
            />
          </div>
          {VIDEO_PATHS.filter((path) => !SIZE_PATHS.includes(path)).map(renderField)}
        </div>
      </Section>

      <Section icon={ImageIcon} title="이미지" subtitle="장면 이미지를 만드는 모델입니다. 이미지 크기는 영상 최종 크기에 맞춰 자동으로 정해집니다." {...section(IMAGE_PATHS)}>
        <div className="fields">{IMAGE_PATHS.map(renderField)}</div>
      </Section>

      <Section icon={Mic} title="오디오" subtitle="노래와 음성의 기본값입니다." {...section(AUDIO_PATHS)}>
        <div className="fields">{AUDIO_PATHS.map(renderField)}</div>
      </Section>

      <Section
        icon={SlidersHorizontal}
        title="고급: 워크플로 · 모델 · LoRA"
        subtitle="비워 두면 기본 워크플로와 기본 모델을 씁니다. 워크플로 파일(ComfyUI API 형식)을 고르면 그 워크플로로 만들고, 모델·LoRA·업스케일러가 있으면 워크플로 안의 값 대신 씁니다."
        note="필요한 노드나 모델이 ComfyUI에 없으면 만들 때 어떤 것이 없는지 알려 줍니다. '확인'으로 미리 볼 수 있어요."
        {...section(ENGINE_PATHS)}
      >
        <EngineSettings get={(path) => getIn(draft, path)} set={change} errors={errors} />
      </Section>

      <Section icon={FolderCog} title="로컬 실행 환경" subtitle="엔진 연결과 작업 폴더 위치입니다. 비워 둔 칸은 연한 글씨의 기본값을 씁니다." note="상대 경로는 이 앱 폴더 기준입니다. 폴더를 바꿔도 기존 파일은 옮기지 않습니다." {...section(LOCAL_PATHS)}>
        <div className="fields">{LOCAL_PATHS.map(renderField)}</div>
      </Section>
    </div>
  );
}
