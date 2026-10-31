import test from "node:test"
import assert from "node:assert/strict"

import { calculateBuyThreshold } from "./price.js"
import { getFeeRate } from "./accounting.js"

test("calculateBuyThreshold applies a percentage drop to the initial reference price", () => {

test("calculateBuyThreshold preserves the configured percentage at different price levels", () => {

test("calculateBuyThreshold rejects invalid prices and percentages", () => {

test("getFeeRate converts pair commission percentages to a conservative decimal rate", () => {

test("getFeeRate rejects missing or invalid commission percentages", () => {

test("percentage points convert to exact decimal fee rates", () => {

test("percentage calculations preserve tiny values and high precision", () => {

test("percentage changes apply increases and decreases exactly", () => {

test("percentage change calculation uses explicit scale and rounding", () => {

test("percentage helpers reject non-string financial inputs and invalid division", () => {
