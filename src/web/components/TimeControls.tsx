import { formatGameDate } from "../format.js";

export type GameSpeed = 0 | 1 | 4 | 16;

interface TimeControlsProps {
  day: number;
  speed: GameSpeed;
  onSpeedChange: (speed: GameSpeed) => void;
  onAdvance: () => void;
}

export function TimeControls({ day, speed, onSpeedChange, onAdvance }: TimeControlsProps) {
  return (
    <footer className="time-controls glass-panel">
      <div className="date-block">
        <span>时间控制 · TIME CONTROL · 第 {day} 日</span>
        <strong>{formatGameDate(day)}</strong>
      </div>
      <div className="speed-controls" aria-label="时间速度">
        <button className={speed === 0 ? "active" : ""} onClick={() => onSpeedChange(0)}>Ⅱ</button>
        <button className={speed === 1 ? "active" : ""} onClick={() => onSpeedChange(1)}>▶ <span>1×</span></button>
        <button className={speed === 4 ? "active" : ""} onClick={() => onSpeedChange(4)}>▶▶ <span>4×</span></button>
        <button className={speed === 16 ? "active" : ""} onClick={() => onSpeedChange(16)}>▶▶▶ <span>16×</span></button>
        <button className="step-button" onClick={onAdvance} title="推进一天">＋1日</button>
      </div>
      <div className="simulation-status"><i />模拟同步</div>
    </footer>
  );
}
