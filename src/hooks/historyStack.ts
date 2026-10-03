type RecordEntry<T> = { value: T; key: string };

/** Project history state machine shared by the React hook and focused tests. */
export class HistoryController<T> {
  private records: RecordEntry<T>[] = [];
  private cursor = 0;
  private pending: RecordEntry<T> | null = null;
  private transactionDepth = 0;

  get canUndo(): boolean {
    if (this.transactionDepth) return false;
    const hasPendingChange = !!this.pending && this.pending.key !== this.records[this.cursor]?.key;
    return hasPendingChange || (this.records.length > 1 && this.cursor > 0);
  }
  get canRedo(): boolean {
    if (this.transactionDepth) return false;
    const hasPendingChange = !!this.pending && this.pending.key !== this.records[this.cursor]?.key;
    return !hasPendingChange && this.cursor < this.records.length - 1;
  }
  get length(): number { return this.records.length; }
  get inTransaction(): boolean { return this.transactionDepth > 0; }

  reset(value: T, key: string): void {
    this.records = [{ value, key }];
    this.cursor = 0;
    this.pending = null;
    this.transactionDepth = 0;
  }

  observe(value: T, key: string, coalesce: boolean): void {
    if (!this.records.length) { this.reset(value, key); return; }
    if (key === this.records[this.cursor]?.key) { this.pending = null; return; }
    this.pending = { value, key };
    if (this.transactionDepth || coalesce) return;
    this.commitPending();
  }

  begin(value: T | null, key: string | null): void {
    this.flush(value, key);
    this.transactionDepth += 1;
  }

  end(value: T | null, key: string | null): void {
    if (!this.transactionDepth) return;
    this.transactionDepth -= 1;
    if (!this.transactionDepth) this.flush(value, key);
  }

  flush(value: T | null, key: string | null): void {
    if (value !== null && key !== null && key !== this.records[this.cursor]?.key) {
      this.pending = { value, key };
    }
    if (!this.transactionDepth) this.commitPending();
  }

  undo(value: T | null, key: string | null): T | null {
    this.flush(value, key);
    if (!this.canUndo) return null;
    this.cursor -= 1;
    this.pending = null;
    return this.records[this.cursor].value;
  }

  redo(value: T | null, key: string | null): T | null {
    this.flush(value, key);
    if (!this.canRedo) return null;
    this.cursor += 1;
    this.pending = null;
    return this.records[this.cursor].value;
  }

  markRestored(key: string): void {
    const current = this.records[this.cursor];
    if (current) current.key = key;
    this.pending = null;
  }

  private commitPending(): void {
    const next = this.pending;
    if (!next || next.key === this.records[this.cursor]?.key) { this.pending = null; return; }
    this.records = [...this.records.slice(0, this.cursor + 1), next];
    if (this.records.length > 100) this.records.shift();
    this.cursor = this.records.length - 1;
    this.pending = null;
  }
}
