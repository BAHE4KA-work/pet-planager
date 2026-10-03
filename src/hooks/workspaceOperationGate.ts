/** Prevent workspace edits while an async native operation owns the disk root. */
export class WorkspaceOperationGate {
  private active = false;

  get locked(): boolean { return this.active; }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.active) throw new Error('A workspace operation is already in progress');
    this.active = true;
    try {
      return await operation();
    } finally {
      this.active = false;
    }
  }
}

/** Invalidates debounced or queued autosaves that captured an earlier revision. */
export class WorkspaceRevisionFence {
  private revision = 0;

  current(): number { return this.revision; }
  advance(): number { this.revision += 1; return this.revision; }
  isCurrent(token: number): boolean { return token === this.revision; }
}
