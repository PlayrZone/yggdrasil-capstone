import { EventBus } from '../core/EventBus.js';
import type { SimEvent } from './contract.js';

/**
 * The single stream of physical truth. Every world occurrence is one
 * event; perception filters it into N subjective views. The runner
 * subscribes to persist the append-only log (the research dataset).
 */
export class SimEventBus {
  private bus = new EventBus<{ event: SimEvent }>();

  on(listener: (event: SimEvent) => void): () => void {
    return this.bus.on('event', listener);
  }

  emit(event: SimEvent): void {
    this.bus.emit('event', event);
  }
}
