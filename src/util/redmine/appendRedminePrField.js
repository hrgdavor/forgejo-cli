// appendRedminePrField.js - Append a note to a Redmine custom field
import { getRedmineField } from "./getRedmineField.js";
import { updateRedmineField } from "./updateRedmineField.js";
import { addRedmineNote } from "./addRedmineNote.js";
import { ok } from "../general/ok.js";

export async function appendRedminePrField(pkg, ticketId, note, gitGuiFriendly = false) {
    const fieldId = pkg.redmine_pr_info_field;
    if (!fieldId) {
        const added = await addRedmineNote(ticketId, note, gitGuiFriendly);
        if (added) {
            ok(`Note added to Redmine issue #${ticketId}.`);
        }
        return;
    }

    let fieldValue = await getRedmineField(ticketId, fieldId, gitGuiFriendly) || '';
    if (!fieldValue.endsWith("\n")) fieldValue += "\n";
    fieldValue += note;

    const updated = await updateRedmineField(ticketId, fieldId, fieldValue, gitGuiFriendly);
    if (updated) {
        ok(`Redmine custom field #${fieldId} updated.`);
    }
}