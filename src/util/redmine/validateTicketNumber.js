// validateTicketNumber.js - Validate that a ticket number is numeric
import { fail } from "../general/fail.js";

export function validateTicketNumber(ticketNumber) {
    if (!/^\d+$/.test(ticketNumber)) {
        fail(`"${ticketNumber}" is not a valid numeric ticket number.`);
    }
}