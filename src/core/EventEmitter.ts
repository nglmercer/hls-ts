import type { HlsEventPayloads, Event } from '../types/events';

export type EventHandler<EventName extends Event> = EventName extends keyof HlsEventPayloads
  ? HlsEventPayloads[EventName] extends void
    ? () => void
    : (data: HlsEventPayloads[EventName]) => void
  : (...args: any[]) => void;

export type GenericEventHandler = (...args: any[]) => void | Promise<void>;

export interface HlsEventEmitter {
  on<EventName extends Event>(event: EventName, handler: EventHandler<EventName>): void;
  once<EventName extends Event>(event: EventName, handler: EventHandler<EventName>): void;
  off<EventName extends Event>(event: EventName, handler: EventHandler<EventName>): void;
  emit<EventName extends Event>(event: EventName, ...data: HlsEventPayloads[EventName] extends void ? [] : [HlsEventPayloads[EventName]]): void;
  removeAllListeners(event?: Event): void;
  listeners(event: Event): GenericEventHandler[];
  trigger<EventName extends Event>(event: EventName, ...data: HlsEventPayloads[EventName] extends void ? [] : [HlsEventPayloads[EventName]]): void;
}

export class EventEmitter implements HlsEventEmitter {
  private _events: Map<string, GenericEventHandler[]> = new Map();
  private _once: Map<string, GenericEventHandler[]> = new Map();

  on<EventName extends Event>(event: EventName, handler: EventHandler<EventName>): void {
    const handlers = this._events.get(event as string);
    if (handlers) {
      handlers.push(handler as GenericEventHandler);
    } else {
      this._events.set(event as string, [handler as GenericEventHandler]);
    }
  }

  once<EventName extends Event>(event: EventName, handler: EventHandler<EventName>): void {
    const onceHandlers = this._once.get(event as string);
    // Wrap handler so it auto-removes on first fire.
    const wrapped: GenericEventHandler = (...args) => {
      this.off(event, handler);
      (handler as GenericEventHandler)(...args);
    };
    if (onceHandlers) {
      onceHandlers.push(wrapped);
    } else {
      this._once.set(event as string, [wrapped]);
    }
    this.on(event, wrapped as EventHandler<EventName>);
  }

  off<EventName extends Event>(event: EventName, handler: EventHandler<EventName>): void {
    const handlers = this._events.get(event as string);
    if (!handlers) return;

    const idx = handlers.indexOf(handler as GenericEventHandler);
    if (idx !== -1) {
      handlers.splice(idx, 1);
    }

    const onceHandlers = this._once.get(event as string);
    if (onceHandlers) {
      const onceIdx = onceHandlers.indexOf(handler as GenericEventHandler);
      if (onceIdx !== -1) {
        onceHandlers.splice(onceIdx, 1);
      }
    }

    if (handlers.length === 0) {
      this._events.delete(event as string);
    }
  }

  emit<EventName extends Event>(event: EventName, ...data: HlsEventPayloads[EventName] extends void ? [] : [HlsEventPayloads[EventName]]): void {
    const key = event as string;
    const handlers = this._events.get(key);
    if (handlers) {
      for (const handler of handlers) {
        handler(...data);
      }
    }

    const onceHandlers = this._once.get(key);
    if (onceHandlers && onceHandlers.length > 0) {
      // Clone to avoid mutation during iteration
      for (const handler of onceHandlers.slice()) {
        this.off(event, handler as EventHandler<EventName>);
      }
      for (const handler of onceHandlers) {
        handler(...data);
      }
    }
  }

  removeAllListeners(event?: Event): void {
    if (event) {
      this._events.delete(event as string);
      this._once.delete(event as string);
    } else {
      this._events.clear();
      this._once.clear();
    }
  }

  listeners(event: Event): GenericEventHandler[] {
    return (this._events.get(event as string) || []).slice();
  }

  trigger<EventName extends Event>(event: EventName, ...data: HlsEventPayloads[EventName] extends void ? [] : [HlsEventPayloads[EventName]]): void {
    this.emit(event, ...data);
  }
}