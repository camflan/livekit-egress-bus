export type ITypedEventEmitter<T extends { type: string }> = {
  emit<K extends T["type"]>(
    event: K,
    e: Omit<Extract<T, { type: K }>, "type">,
  ): void;
  off<K extends T["type"]>(
    event: K,
    listener: (e: Omit<Extract<T, { type: K }>, "type">) => void,
  ): void;
  on<K extends T["type"]>(
    event: K,
    listener: (e: Omit<Extract<T, { type: K }>, "type">) => void,
  ): void;
};

type AnyEventPayload = Record<string, unknown>;
type EventListener = (e: AnyEventPayload) => void;

export class TypedEventEmitter<T extends { type: string }>
  implements ITypedEventEmitter<T>
{
  #listeners = new Map<string, Set<EventListener>>();

  emit<K extends T["type"]>(
    event: K,
    e: Omit<Extract<T, { type: K }>, "type">,
  ) {
    const listeners = this.#listeners.get(event);

    listeners?.forEach((listener) => {
      listener(e as AnyEventPayload);
    });
  }

  off<K extends T["type"]>(
    event: K,
    listener: (e: Omit<Extract<T, { type: K }>, "type">) => void,
  ) {
    const listeners = this.#listeners.get(event);
    listeners?.delete(listener as EventListener);
  }

  on<K extends T["type"]>(
    event: K,
    listener: (e: Omit<Extract<T, { type: K }>, "type">) => void,
  ) {
    const listeners = this.#listeners.get(event) ?? new Set();
    listeners.add(listener as EventListener);
    this.#listeners.set(event, listeners);
  }
}
