import { test } from "node:test";
import assert from "node:assert/strict";

type Listener = (...args: any[]) => unknown;
const listeners: Record<string, Listener> = {};
const adder = (name: string) => ({ addListener: (listener: Listener) => void (listeners[name] = listener) });
const calls = { sitesRead: 0, badgeText: 0 };
let tabGone = false;

const chrome = {
  storage: {
    local: {
      get: async () => {
        calls.sitesRead++;
        return { sites: { "https://xxx.com": { daemon: "http://127.0.0.1:1", token: "t", on: true } } };
      },
      set: async () => {},
    },
    onChanged: adder("storageChanged"),
  },
  runtime: { onMessage: adder("message"), getURL: (path: string) => path },
  tabs: {
    query: async () => [{ id: 1, url: "https://xxx.com/" }],
    sendMessage: async () => {},
    create: async () => {},
    onUpdated: adder("tabUpdated"),
    onActivated: adder("tabActivated"),
    get: async () => {
      if (tabGone) throw new Error("No tab with id");
      return { id: 1, url: "https://xxx.com/" };
    },
  },
  action: {
    onClicked: adder("clicked"),
    setBadgeText: async () => void calls.badgeText++,
    setBadgeBackgroundColor: async () => {},
    setBadgeTextColor: async () => {},
    setTitle: async () => {},
  },
};

(globalThis as any).chrome = chrome;
await import("../src/background.ts");

test("a tab that closed before onActivated ran does not make the listener fail", async () => {
  tabGone = true;
  await listeners.tabActivated!({ tabId: 1 });
});

test("a storage change loads the saved sites once", async () => {
  calls.sitesRead = 0;
  await listeners.storageChanged!({ sites: {} }, "local");
  assert.equal(calls.sitesRead, 1);
});

test("an update with only a title change does not refresh the badge, one with a url does", async () => {
  const tab = { id: 1, url: "https://xxx.com/" };
  calls.badgeText = 0;
  await listeners.tabUpdated!(1, { title: "New title" }, tab);
  assert.equal(calls.badgeText, 0);
  await listeners.tabUpdated!(1, { url: tab.url }, tab);
  assert.equal(calls.badgeText, 1);
});

test("a failing storage read does not make the onUpdated listener fail", async () => {
  const get = chrome.storage.local.get;
  chrome.storage.local.get = async () => {
    throw new Error("storage is gone");
  };
  try {
    await listeners.tabUpdated!(1, { status: "loading" }, { id: 1, url: "https://xxx.com/" });
  } finally {
    chrome.storage.local.get = get;
  }
});

test("a tab query that fails does not make the storage listener fail", async () => {
  const query = chrome.tabs.query;
  chrome.tabs.query = async () => {
    throw new Error("window is gone");
  };
  try {
    await listeners.storageChanged!({ sites: {} }, "local");
  } finally {
    chrome.tabs.query = query;
  }
});
