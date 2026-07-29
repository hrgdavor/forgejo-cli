// postLastCommitMessage.js - Post the last commit message as a Redmine note
import { addRedmineNote } from "./addRedmineNote.js";
import { prepCommitMsg } from "./prepCommitMsg.js";
import { getLastCommitMessage } from "../git/getLastCommitMessage.js";
import { getRedmineConfig } from "./getRedmineConfig.js";
import { info } from "../general/info.js";

export async function postLastCommitMessage(pkg, ticketId, label, gitGuiFriendly = false) {
    if (gitGuiFriendly) {
        const cfg = getRedmineConfig(true);
        if (!cfg.baseUrl || !cfg.apiKey) {
            info(`Running in ${label} mode - Redmine credentials not available in this environment, skipping note.`);
            return;
        }
    }
    info(`Running in ${label} mode - pushing last commit message to Redmine...`);
    const message = getLastCommitMessage();
    info(`Commit message: ${message.split("\n")[0]}`);
    await addRedmineNote(ticketId, prepCommitMsg(pkg, message), gitGuiFriendly);
}