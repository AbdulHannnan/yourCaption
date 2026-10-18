#!/usr/bin/env node
// cli.js — the single entry point for yourCaption's commands.
// Commands are added module by module; Module 2 adds `extract`.

import { extract } from "./commands/extract.js";
import { transcribe } from "./commands/transcribe.js";
import { render } from "./commands/render.js";
import { enhance } from "./commands/enhance.js";

const commands = {
  extract: {
    run: extract,
    usage: "extract <video>               Extract a 16kHz mono WAV from a video into output/",
  },
  transcribe: {
    run: transcribe,
    usage: "transcribe <audio> --lang ur  Transcribe audio to words + timings (ur/hi)",
  },
  render: {
    run: render,
    usage: "render <video>                Burn the caption JSON onto the video",
  },
  enhance: {
    run: enhance,
    usage: "enhance <audio> [--ai]        Clean up audio (denoise, high-pass, normalize)",
  },
};

function printHelp() {
  console.log("yourCaption — CLI\n");
  console.log("Usage:");
  console.log("  node src/cli.js <command> [args]");
  console.log("  npm run <command> -- [args]\n");
  console.log("Commands:");
  for (const { usage } of Object.values(commands)) {
    console.log(`  ${usage}`);
  }
  console.log("");
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);

  if (!cmd || ["help", "--help", "-h"].includes(cmd)) {
    printHelp();
    process.exit(cmd ? 0 : 1);
  }

  const entry = commands[cmd];
  if (!entry) {
    console.error(`Unknown command: ${cmd}\n`);
    printHelp();
    process.exit(1);
  }

  try {
    await entry.run(rest);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

main();
