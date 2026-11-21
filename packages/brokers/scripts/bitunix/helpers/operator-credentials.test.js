import assert from "node:assert/strict"
import test from "node:test"
import { parseBitunixApiCredentials, redactBitunixApiSecrets } from "./operator-credentials.js"
test("operator credential parser trims required values and rejects incomplete pairs",()=>{assert.deepEqual(parseBitunixApiCredentials({env:{BITUNIX_API_KEY:" key ",BITUNIX_API_SECRET:" secret "}}),{apiKey:"key",apiSecret:"secret"},"credentials should be trimmed before Broker construction");assert.throws(()=>parseBitunixApiCredentials({env:{BITUNIX_API_KEY:"key"}}),/BITUNIX_API_SECRET/,"an incomplete LIVE credential pair must be rejected")})
test("operator output redaction removes every configured secret",()=>{assert.equal(redactBitunixApiSecrets({message:"key-secret failed",secrets:["key","secret"]}),"[REDACTED]-[REDACTED] failed","operator output must not expose configured API credentials")})
