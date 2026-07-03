type Listener = () => void;

/** 编辑器模式:当前正在铺设哪条线路(null = 浏览模式) */
export class EditorState {
  private _editingLineId: string | null = null;
  private listeners = new Set<Listener>();

  get editingLineId(): string | null {
    return this._editingLineId;
  }

  setEditingLine(lineId: string | null): void {
    if (this._editingLineId === lineId) return;
    this._editingLineId = lineId;
    for (const l of this.listeners) l();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
