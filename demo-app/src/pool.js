import { EventEmitter } from "node:events";

export class PoolTimeoutError extends Error {
  constructor(timeoutMs) {
    super(`connection pool exhausted: timeout acquiring connection after ${timeoutMs}ms`);
    this.name = "PoolTimeoutError";
  }
}

// Simulated DB connection pool. The logs it produces are the demo's only visible
// artifact, so slots are just counters — no real connections behind them.
export class FakePool extends EventEmitter {
  #size;
  #inUse = 0;
  #queue = [];
  #timeoutMs;

  constructor({ size, timeoutMs = 2000 }) {
    super();
    this.#size = size;
    this.#timeoutMs = timeoutMs;
  }

  get size() { return this.#size; }
  get inUse() { return this.#inUse; }
  get waiting() { return this.#queue.length; }

  setSize(size) {
    this.#size = size;
    this.#drain();
  }

  acquire() {
    if (this.#inUse < this.#size) {
      this.#inUse++;
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const waiter = {
        grant: () => {
          clearTimeout(waiter.timer);
          this.#inUse++;
          resolve();
        },
        timer: setTimeout(() => {
          const i = this.#queue.indexOf(waiter);
          if (i !== -1) this.#queue.splice(i, 1);
          reject(new PoolTimeoutError(this.#timeoutMs));
        }, this.#timeoutMs),
      };
      this.#queue.push(waiter);
      this.emit("saturated", {
        size: this.#size,
        inUse: this.#inUse,
        waiting: this.#queue.length,
      });
    });
  }

  release() {
    if (this.#inUse <= 0) throw new Error("release without acquire");
    this.#inUse--;
    this.#drain();
  }

  #drain() {
    while (this.#queue.length > 0 && this.#inUse < this.#size) {
      this.#queue.shift().grant();
    }
  }
}
