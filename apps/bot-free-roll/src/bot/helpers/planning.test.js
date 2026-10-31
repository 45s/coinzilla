import test from "node:test"
import assert from "node:assert/strict"

import { calculateSellPlan } from "./order-planning.js"

test("calculateSellPlan rounds quantity down before calculating profitable price", () => {

test("calculateSellPlan returns readable money precision without floating-point noise", () => {

test("calculateSellPlan uses realistic 0.075% commission without the former 1% assumption", () => {

test("exact SELL planning rounds quantity down and price up", () => {

test("exact repeated position accumulation and minimum-profit boundary do not drift", () => {
