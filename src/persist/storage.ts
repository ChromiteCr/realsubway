import type { Network } from "../model/network";
import type { NetworkData } from "../model/types";

const STORAGE_KEY = "realsubway.save.v1";

export function loadFromLocalStorage(): NetworkData | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return validate(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** 订阅网络变更,防抖后自动写入 localStorage;返回退订函数 */
export function attachAutosave(network: Network, delayMs = 500): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const unsubscribe = network.subscribe(() => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(network.toJSON()));
    }, delayMs);
  });
  return () => {
    clearTimeout(timer);
    unsubscribe();
  };
}

export function saveNow(network: Network): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(network.toJSON()));
}

export function exportToFile(network: Network): void {
  const blob = new Blob([JSON.stringify(network.toJSON(), null, 2)], {
    type: "application/json",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
  a.download = `realsubway-${stamp}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export async function importFromFile(file: File): Promise<NetworkData> {
  const data = validate(JSON.parse(await file.text()));
  if (!data) throw new Error("不是有效的 realsubway 存档");
  return data;
}

function validate(data: unknown): NetworkData | null {
  if (
    typeof data === "object" &&
    data !== null &&
    (data as NetworkData).version === 1 &&
    Array.isArray((data as NetworkData).stations) &&
    Array.isArray((data as NetworkData).lines)
  ) {
    return data as NetworkData;
  }
  return null;
}
