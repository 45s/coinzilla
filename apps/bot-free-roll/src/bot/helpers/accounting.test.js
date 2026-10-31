import test from "node:test"
import assert from "node:assert/strict"


test("buy and sell quote accounting return exact decimal strings", () => {

test("exact fee and fill accounting preserve decimal strings", () => {

test("zero maker commission selects post-only orders and zero SELL fee reserve", () => {

test("actual BUY commissions are applied in the asset Binance charged", () => {

test("actual SELL commissions are applied in the asset Binance charged", () => {

test("zero commissions do not require an inferred commission asset", () => {

test("third-asset and incomplete commissions fail closed", () => {

test("calculates effective commission rate from the actual commission asset", () => {
