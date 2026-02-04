import { createInterface } from "node:readline/promises";

const isTTY = process.stdin.isTTY === true;

export async function confirmPrompt(message: string, defaultYes = true): Promise<boolean> {
  if (!isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const suffix = defaultYes ? "[Y/n]" : "[y/N]";
    const answer = await rl.question(`  ${message} ${suffix}: `);
    const trimmed = answer.trim().toLowerCase();
    if (trimmed === "") return defaultYes;
    return trimmed === "y" || trimmed === "yes";
  } finally {
    rl.close();
  }
}

export async function selectPrompt(message: string): Promise<string> {
  if (!isTTY) return "skip";
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`  ${message}: `);
    return answer.trim() || "skip";
  } finally {
    rl.close();
  }
}
