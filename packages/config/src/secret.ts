const REDACTED = '[redacted]';

/**
 * Holds a sensitive value (API key, token, private key) so it cannot leak through
 * logging, JSON serialization, util.inspect, or string interpolation.
 * Call reveal() only at the exact point where the raw value is needed.
 */
export class Secret<T = string> {
  readonly #value: T;

  constructor(value: T) {
    this.#value = value;
  }

  reveal(): T {
    return this.#value;
  }

  toString(): string {
    return REDACTED;
  }

  toJSON(): string {
    return REDACTED;
  }

  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return `Secret(${REDACTED})`;
  }
}
