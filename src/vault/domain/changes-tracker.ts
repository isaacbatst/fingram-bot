export class ChangesTracker<T> {
  private new: T[] = [];
  private dirty: T[] = [];
  private deleted: T[] = [];

  registerNew(entity: T) {
    this.new.push(entity);
  }

  registerDirty(entity: T) {
    this.dirty.push(entity);
  }

  registerDeleted(entity: T) {
    this.deleted.push(entity);
  }

  getChanges() {
    return {
      new: this.new,
      dirty: this.dirty,
      deleted: this.deleted,
    };
  }

  clearChanges() {
    this.new = [];
    this.dirty = [];
    this.deleted = [];
  }
}
