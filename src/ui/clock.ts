export type ClockSpeed = 0 | 1 | 60 | 600;

type TickListener = (minutes: number) => void;

/** 模拟时钟:rAF 驱动,speed=模拟分钟/真实分钟(0=暂停),跨日循环 */
export class SimClock {
  minutes = 7 * 60;
  speed: ClockSpeed = 60;
  private listeners = new Set<TickListener>();
  private rafId = 0;
  private lastTs = 0;

  start(): void {
    if (this.rafId) return;
    const loop = (ts: number) => {
      if (this.lastTs > 0 && this.speed > 0) {
        const dtSec = (ts - this.lastTs) / 1000;
        this.minutes = (this.minutes + (dtSec / 60) * this.speed) % 1440;
        for (const l of this.listeners) l(this.minutes);
      }
      this.lastTs = ts;
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  onTick(listener: TickListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setSpeed(speed: ClockSpeed): void {
    this.speed = speed;
    // 暂停时也广播一次,让 UI 立即反映状态
    for (const l of this.listeners) l(this.minutes);
  }
}

function fmtClock(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.floor(minutes % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** 地图左下角的时钟控件:时间显示 + 暂停/速度按钮 */
export function createClockControl(container: HTMLElement, clock: SimClock): void {
  const root = document.createElement("div");
  root.className = "clock-control";

  const time = document.createElement("span");
  time.className = "clock-time";
  time.textContent = fmtClock(clock.minutes);
  root.appendChild(time);

  const speeds: { label: string; value: ClockSpeed }[] = [
    { label: "⏸", value: 0 },
    { label: "1×", value: 1 },
    { label: "60×", value: 60 },
    { label: "600×", value: 600 },
  ];
  const buttons: HTMLButtonElement[] = [];
  for (const { label, value } of speeds) {
    const btn = document.createElement("button");
    btn.textContent = label;
    btn.addEventListener("click", () => {
      clock.setSpeed(value);
      for (const b of buttons) b.classList.remove("primary");
      btn.classList.add("primary");
    });
    if (value === clock.speed) btn.classList.add("primary");
    buttons.push(btn);
    root.appendChild(btn);
  }

  clock.onTick((minutes) => {
    time.textContent = fmtClock(minutes);
  });

  container.appendChild(root);
}
