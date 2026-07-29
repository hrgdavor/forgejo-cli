// promptChoice.js - Prompt the user with a question and return true/false
//
// The matcher receives the trimmed lowercase input and returns true for a "yes".

export function promptChoice(question, matcher) {
    return new Promise(resolve => {
        process.stdout.write(question);
        process.stdin.once("data", data => {
            resolve(matcher(data.toString().trim().toLowerCase()));
        });
    });
}