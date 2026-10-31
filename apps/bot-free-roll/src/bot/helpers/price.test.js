import test from "node:test"
import assert from "node:assert/strict"

import { calculateBuyThreshold, roundPriceDown, roundPriceUp, roundQuantityDown } from "./price.js"

test("calculateBuyThreshold uses the last buy price when available", () => {

test("roundPriceDown returns a valid tick without floating-point noise", () => {

test("roundPriceUp returns a valid tick without floating-point noise", () => {

test("roundQuantityDown respects exchange quantity steps", () => {

test("calculateBuyThreshold avoids binary floating-point artifacts", () => {

test("tick and step rounding uses exact decimal increments", () => {
