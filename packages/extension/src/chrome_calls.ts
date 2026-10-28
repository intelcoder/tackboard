import type { Sites } from "./sites.ts";

// Only the few `chrome` calls this extension uses, declared by hand so no extra package is needed.
type Listeners<Args extends unknown[]> = { addListener(listener: (...args: Args) => unknown): void };
type SavedScript = { id: string; matches: string[]; js: string[]; runAt: "document_idle"; persistAcrossSessions: boolean };

export const chrome = (globalThis as unknown as {
  chrome: {
    storage: {
      local: { get(key: string): Promise<Record<string, unknown>>; set(items: Record<string, unknown>): Promise<void> };
      onChanged: Listeners<[changes: Record<string, unknown>, area: string]>;
    };
    permissions: {
      contains(wanted: { origins: string[] }): Promise<boolean>;
      request(wanted: { origins: string[] }): Promise<boolean>;
      remove(wanted: { origins: string[] }): Promise<boolean>;
    };
    scripting: {
      registerContentScripts(scripts: SavedScript[]): Promise<void>;
      unregisterContentScripts(filter: { ids: string[] }): Promise<void>;
      getRegisteredContentScripts(filter: { ids: string[] }): Promise<SavedScript[]>;
    };
    runtime: {
      sendMessage(message: unknown): Promise<any>;
      onMessage: Listeners<[message: any, sender: { tab?: { url?: string } }, reply: (answer: unknown) => void]>;
    };
    tabs: {
      query(filter: { url: string[] }): Promise<{ id?: number }[]>;
      sendMessage(tabId: number, message: unknown): Promise<unknown>;
    };
  };
}).chrome;

export async function loadSites(): Promise<Sites> {
  return ((await chrome.storage.local.get("sites")).sites as Sites | undefined) ?? {};
}

export function saveSites(sites: Sites): Promise<void> {
  return chrome.storage.local.set({ sites });
}
