export const brand = {
  name: "Tackboard",
  cli: "tackboard",
  dataDir: ".tackboard",
  dbFile: "tackboard.db",
  configFile: "config.json",
  refPrefix: "refs/tackboard/",
  bundle: "tackboard.js",
  hostId: "tackboard-root",
  tokenHeader: "x-tackboard-token",
  configGlobal: "__TACKBOARD__",
  envPrefix: "TACKBOARD_",
  sourceAttr: "data-tb-src",
} as const;
