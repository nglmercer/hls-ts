export type EventHandler = (...args: any[]) => void;

export interface HlsEventEmitter {
  on(event: string, handler: EventHandler): void;
  once(event: string, handler: EventHandler): void;
  off(event: string, handler: EventHandler): void;
  emit(event: string, ...args: any[]): void;
  removeAllListeners(event?: string): void;
  listeners(event: string): EventHandler[];
  trigger(event: string, ...args: any[]): void;
}

export class EventEmitter implements HlsEventEmitter {
  private _events: Map<string, EventHandler[]> = new Map();
  private _once: Map<string, EventHandler[]> = new Map();

  on(event: string, handler: EventHandler): void {
    const handlers = this._events.get(event);
    if (handlers) {
      handlers.push(handler);
    } else {
      this._events.set(event, [handler]);
    }
  }

  once(event: string, handler: EventHandler): void {
    const onceHandlers = this._once.get(event);
    if (onceHandlers) {
      onceHandlers.push(handler);
    } else {
      this._once.set(event, [handler]);
    }
    this.on(event, handler);
  }

  off(event: string, handler: EventHandler): void {
    const handlers = this._events.get(event);
    if (!handlers) return;

    const idx = handlers.indexOf(handler);
    if (idx !== -1) {
      handlers.splice(idx, 1);
    }

    const onceHandlers = this._once.get(event);
    if (onceHandlers) {
      const onceIdx = onceHandlers.indexOf(handler);
      if (onceIdx !== -1) {
        onceHandlers.splice(onceIdx, 1);
      }
    }

    if (handlers.length === 0) {
      this._events.delete(event);
    }
  }

  emit(event: string, ...args: any[]): void {
    const handlers = this._events.get(event);
    if (!handlers) return;

    const onceHandlers = this._once.get(event) || [];

    for (const handler of handlers) {
      handler(...args);
    }

    for (const handler of onceHandlers) {
      this.off(event, handler);
    }

    if (onceHandlers.length > 0) {
      this._once.delete(event);
    }
  }

  removeAllListeners(event?: string): void {
    if (event) {
      this._events.delete(event);
      this._once.delete(event);
    } else {
      this._events.clear();
      this._once.clear();
    }
  }

  listeners(event: string): EventHandler[] {
    return this._events.get(event) || [];
  }

  trigger(event: string, ...args: any[]): void {
    this.emit(event, ...args);
  }
}
