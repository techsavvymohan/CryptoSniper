"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.selectRandomJitoTipAccount = selectRandomJitoTipAccount;
exports.generateId = generateId;
exports.retry = retry;
exports.sleep = sleep;
const index_js_1 = require("../constants/index.js");
function selectRandomJitoTipAccount() {
    return index_js_1.JITO_TIP_ACCOUNTS[Math.floor(Math.random() * index_js_1.JITO_TIP_ACCOUNTS.length)];
}
function generateId() {
    return crypto.randomUUID();
}
async function retry(fn, maxAttempts = 5, baseDelayMs = 500) {
    let lastError;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
            return await fn();
        }
        catch (err) {
            lastError = err;
            if (attempt < maxAttempts - 1) {
                const delay = Math.min(baseDelayMs * 2 ** attempt, 30_000);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
    throw lastError;
}
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
