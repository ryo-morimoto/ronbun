#!/usr/bin/env node

import { defineCommand, runMain } from "citty";

const main = defineCommand({
  meta: {
    name: "ronbun",
    version: "0.1.0",
    description: "A fast, modern browser for academic papers",
  },
  subCommands: {
    search: () => import("./commands/search.ts").then((m) => m.default),
    show: () => import("./commands/show.ts").then((m) => m.default),
    list: () => import("./commands/list.ts").then((m) => m.default),
    related: () => import("./commands/related.ts").then((m) => m.default),
    extractions: () => import("./commands/extractions.ts").then((m) => m.default),
    status: () => import("./commands/status.ts").then((m) => m.default),
  },
});

runMain(main);
