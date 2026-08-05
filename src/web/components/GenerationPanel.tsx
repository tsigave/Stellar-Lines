import type { Dispatch, SetStateAction } from "react";
import type { GalaxyGenerationConfig } from "../../types.js";

interface GenerationPanelProps {
  config: GalaxyGenerationConfig;
  setConfig: Dispatch<SetStateAction<GalaxyGenerationConfig>>;
  onGenerate: () => void;
  error: string | null;
  generatedCounts: { systems: number; ports: number; lanes: number };
}

const SHAPE_LABELS: Record<GalaxyGenerationConfig["shape"], string> = {
  spiral: "旋臂星群",
  disc: "均匀星盘",
  clusters: "多星团",
};

const TOPOLOGY_LABELS: Record<GalaxyGenerationConfig["topology"], string> = {
  mixed: "混合网络",
  web: "邻近蛛网",
  radial: "中央放射",
  ring: "环形走廊",
};

export function GenerationPanel({
  config,
  setConfig,
  onGenerate,
  error,
  generatedCounts,
}: GenerationPanelProps) {
  const setSystemCount = (systemCount: number) => {
    setConfig((current) => ({
      ...current,
      systemCount,
      starportCount: Math.min(current.starportCount, systemCount),
    }));
  };

  return (
    <aside className="control-panel glass-panel">
      <div className="panel-heading">
        <span className="eyebrow">GALAXY FORGE</span>
        <h2>银河生成器</h2>
        <p>生成有人与无人两类行星系。</p>
      </div>

      <label className="field-label" htmlFor="seed">随机种子</label>
      <div className="seed-row">
        <input
          id="seed"
          value={config.seed}
          onChange={(event) => setConfig((current) => ({ ...current, seed: event.target.value }))}
        />
        <button
          className="icon-button"
          title="生成新种子"
          onClick={() =>
            setConfig((current) => ({
              ...current,
              seed: `sector-${Math.floor(Math.random() * 999_999).toString().padStart(6, "0")}`,
            }))
          }
        >
          ↻
        </button>
      </div>

      <div className="slider-heading">
        <label htmlFor="system-count">行星系数量</label>
        <output>{config.systemCount}</output>
      </div>
      <input
        id="system-count"
        type="range"
        min="3"
        max="24"
        value={config.systemCount}
        onChange={(event) => setSystemCount(Number(event.target.value))}
      />

      <div className="slider-heading">
        <label htmlFor="port-count">星港总数</label>
        <output>{config.starportCount}</output>
      </div>
      <input
        id="port-count"
        type="range"
        min="2"
        max={config.systemCount}
        value={config.starportCount}
        onChange={(event) =>
          setConfig((current) => ({ ...current, starportCount: Number(event.target.value) }))
        }
      />

      <label className="field-label" htmlFor="galaxy-shape">星域形状</label>
      <select
        id="galaxy-shape"
        value={config.shape}
        onChange={(event) =>
          setConfig((current) => ({
            ...current,
            shape: event.target.value as GalaxyGenerationConfig["shape"],
          }))
        }
      >
        {Object.entries(SHAPE_LABELS).map(([value, label]) => (
          <option key={value} value={value}>{label}</option>
        ))}
      </select>

      <label className="field-label" htmlFor="lane-topology">超空间航道走向</label>
      <select
        id="lane-topology"
        value={config.topology}
        onChange={(event) =>
          setConfig((current) => ({
            ...current,
            topology: event.target.value as GalaxyGenerationConfig["topology"],
          }))
        }
      >
        {Object.entries(TOPOLOGY_LABELS).map(([value, label]) => (
          <option key={value} value={value}>{label}</option>
        ))}
      </select>

      <div className="slider-heading">
        <label htmlFor="lane-density">航道密度</label>
        <output>{Math.round(config.laneDensity * 100)}%</output>
      </div>
      <input
        id="lane-density"
        type="range"
        min="0"
        max="1"
        step="0.05"
        value={config.laneDensity}
        onChange={(event) =>
          setConfig((current) => ({ ...current, laneDensity: Number(event.target.value) }))
        }
      />

      {error && <div className="error-message">{error}</div>}
      <button className="generate-button" onClick={onGenerate}>
        <span>生成新星域</span>
        <span aria-hidden="true">✦</span>
      </button>

      <div className="generation-stats">
        <div><strong>{generatedCounts.systems}</strong><span>行星系</span></div>
        <div><strong>{generatedCounts.ports}</strong><span>星港</span></div>
        <div><strong>{generatedCounts.lanes}</strong><span>超空间航道</span></div>
      </div>
    </aside>
  );
}
