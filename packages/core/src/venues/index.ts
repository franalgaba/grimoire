/**
 * Venue adapter registry
 */

import type { VenueAdapter, VenueAdapterMeta, VenueRegistry } from "./types.js";

class InMemoryVenueRegistry implements VenueRegistry {
  private adapters = new Map<string, VenueAdapter>();

  register(adapter: VenueAdapter): void {
    this.adapters.set(adapter.meta.name, adapter);
  }

  registerAll(adapters: VenueAdapter[]): void {
    for (const adapter of adapters) {
      this.register(adapter);
    }
  }

  get(name: string): VenueAdapter | undefined {
    return this.adapters.get(name);
  }

  list(): VenueAdapterMeta[] {
    return [...this.adapters.values()].map((adapter) => adapter.meta);
  }
}

export function createVenueRegistry(adapters: VenueAdapter[] = []): VenueRegistry {
  const registry = new InMemoryVenueRegistry();
  registry.registerAll(adapters);
  return registry;
}
