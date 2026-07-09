type Listener = () => void;

/** 线路生长端:tail = 末端追加,head = 首端反向延长 */
export type GrowEnd = "head" | "tail";

/** 编辑器模式:当前正在铺设哪条线路(null = 浏览模式)及生长端 */
export class EditorState {
  private _editingLineId: string | null = null;
  private _activeEnd: GrowEnd = "tail";
  private listeners = new Set<Listener>();

  get editingLineId(): string | null {
    return this._editingLineId;
  }

  get activeEnd(): GrowEnd {
    return this._activeEnd;
  }

  setEditingLine(lineId: string | null): void {
    if (this._editingLineId === lineId) return;
    this._editingLineId = lineId;
    this._activeEnd = "tail"; // 每次进入铺设默认从末端生长
    for (const l of this.listeners) l();
  }

  setActiveEnd(end: GrowEnd): void {
    if (this._activeEnd === end) return;
    this._activeEnd = end;
    for (const l of this.listeners) l();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
