/**
 * A small single-flight cache for values backed by an asynchronous native
 * store. Mutations win over an older read that is still crossing the bridge,
 * which prevents a delayed SecureStore result from resurrecting a session
 * after logout or overwriting freshly rotated tokens.
 */
export class AsyncValueCache<T> {
  private value: T | null = null;
  private loaded = false;
  private generation = 0;
  private loading: Promise<T | null> | null = null;

  constructor(private readonly onChange?: () => void) {}

  read(loader: () => Promise<T | null>): Promise<T | null> {
    if (this.loaded) return Promise.resolve(this.value);
    if (this.loading) return this.loading;

    const generation = this.generation;
    this.loading = loader().then((value) => {
      if (this.generation === generation) {
        this.loaded = true;
        this.value = value;
        this.onChange?.();
      }
      return this.value;
    }).finally(() => {
      this.loading = null;
    });
    return this.loading;
  }

  set(value: T | null): void {
    this.generation += 1;
    this.loaded = true;
    this.value = value;
    this.onChange?.();
  }

  peek(): T | null {
    return this.value;
  }
}
