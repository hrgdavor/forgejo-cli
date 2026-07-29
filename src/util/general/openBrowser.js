// openBrowser.js - Open a URL in the user's default system browser
import { spawnSync } from "bun";

/**
 * Opens a URL in the user's default system browser using Bun.spawn.
 * @param url The full URL string to open (e.g., "https://bun.sh")
 */
export function openBrowser(url) {
  let cmd;

  switch (process.platform) {
    case "darwin":
      cmd = ["open", url];
      break;
    case "win32":
      cmd = ["cmd.exe", "/c", "start", "", url];
      break;
    default:
      cmd = ["xdg-open", url];
      break;
  }

  spawnSync(cmd, {
    stdout: "ignore",
    stderr: "ignore",
  });
}