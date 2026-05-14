import type { HlsEventPayloads } from '../types/events';

type KnownEvents = keyof HlsEventPayloads;

/**
 * For known HLS events, provide a typed payload.
 * For ad-hoc / unknown event names, fall back to any[].
 */
export type EventHandler<EventName extends string> =
  EventName extends KnownEvents
    ? HlsEventPayloads[EventName] extends void
      ? () => void
      : (data: HlsEventPayloads[EventName]) => void
    : (...args: any[]) => void;

export type GenericEventHandler = (...args: any[]) => void | Promise<void>;

/** Helper to extract the payload tuple for a given event name */
export type PayloadOf<EventName extends string> =
  EventName extends KnownEvents
    ? HlsEventPayloads[EventName] extends void
      ? []
      : [HlsEventPayloads[EventName]]
    : any[];

export interface HlsEventEmitter {
  /** Subscribe to any event. For known events the handler is typed; for ad-hoc events use any[]. */
  on(event: string, handler: GenericEventHandler): void;
  once(event: string, handler: GenericEventHandler): void;
  off(event: string, handler: GenericEventHandler): void;
  /** Emit a known event with typed payload, or an ad-hoc event with any[] args. */
  emit<EventName extends string>(event: EventName, ...data: PayloadOf<EventName>): void;
  removeAllListeners(event?: string): void;
  listeners(event: string): GenericEventHandler[];
  trigger<EventName extends string>(event: EventName, ...data: PayloadOf<EventName>): void;
}

/**
 * EventEmitter with typed payloads for known HLS events
 * (compile-time checked on emit/trigger) and generic any[] for ad-hoc events.
 *
 * Internal storage uses a flat Map<string, GenericEventHandler[]> so
 * ad-hoc listener registrations never conflict with known-event ones.
 *
 * Once-listeners fire exactly once and are fully cleaned up before the
 * handler runs, so they never double-fire even when also tracked in _events.
 */
export class EventEmitter implements HlsEventEmitter {
  private _events: Map<string, GenericEventHandler[]> = new Map();

  on(event: string, handler: GenericEventHandler): void {
    const handlers = this._events.get(event);
    if (handlers) {
      handlers.push(handler);
    } else {
      this._events.set(event, [handler]);
    }
  }

  once(event: string, handler: GenericEventHandler): void {
    const wrapped: GenericEventHandler = (...args: any[]) => {
      // Fully remove before firing so the handler runs exactly once
      this._removeHandler(event, wrapped);
      handler(...args);
    };
    const handlers = this._events.get(event);
    if (handlers) {
      handlers.push(wrapped);
    } else {
      this._events.set(event, [wrapped]);
    }
  }

  off(event: string, handler: GenericEventHandler): void {
    this._removeHandler(event, handler);
  }

  private _removeHandler(event: string, handler: GenericEventHandler): void {
    const handlers = this._events.get(event);
    if (!handlers) return;
    const idx = handlers.indexOf(handler);
    if (idx !== -1) {
      handlers.splice(idx, 1);
    }
    if (handlers.length === 0) {
      this._events.delete(event);
    }
  }

  emit<EventName extends string>(event: EventName, ...data: PayloadOf<EventName>): void {
    const key = event as string;
    // Snapshot handlers so that "once" removals during iteration are safe
    const handlers = this._events.get(key);
    if (!handlers || handlers.length === 0) return;
    const snapshot = handlers.slice();
    for (const handler of snapshot) {
      handler(...(data as unknown as any[]));
    }
  }

  removeAllListeners(event?: string): void {
    if (event) {
      this._events.delete(event);
    } else {
      this._events.clear();
    }
  }

  listeners(event: string): GenericEventHandler[] {
    return (this._events.get(event) || []).slice();
  }

  trigger<EventName extends string>(event: EventName, ...data: PayloadOf<EventName>): void {
    this.emit(event, ...data);
  }
}