// fail.js - Print error message and exit
export function fail(msg) {
    console.error(`❌ ${msg}`);
    process.exit(1);
}