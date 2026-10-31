import { assertDecimalString, compareDecimal, multiplyDecimal, roundDecimalToIncrement } from "./decimal.js"

export function calculateNotional({ price, quantity }) {
  assertDecimalString(price, "price");
  assertDecimalString(quantity, "quantity");

  if (compareDecimal({ left: price, right: "0" }) <= 0) {
    throw new Error("price must be greater than zero");
  }

  if (compareDecimal({ left: quantity, right: "0" }) < 0) {
    throw new Error("quantity must be non-negative");
  }

  return multiplyDecimal({ left: price, right: quantity });
}

export function meetsMinimumNotional({ price, quantity, minNotional }) {
  assertDecimalString(minNotional, "minNotional");

  if (compareDecimal({ left: minNotional, right: "0" }) < 0) {
    throw new Error("minNotional must be non-negative");
  }

  return compareDecimal({
    left: calculateNotional({ price, quantity }),
    right: minNotional,
  }) >= 0;
}


const TRADING_RULE_DECIMAL_FIELDS = [
  "priceIncrement",
  "quantityIncrement",
  "minQuantity",
  "maxQuantity",
  "minNotional",
  "maxNotional",
  "minPrice",
  "maxPrice",
  "referencePrice",
  "minPriceMultiplier",
  "maxPriceMultiplier",
];

export function validateOrderAgainstTradingRules({ order, rules }) {
  if (!order || typeof order !== "object" || Array.isArray(order)) {
    throw new Error("order must be an object");
  }

  if (!rules || typeof rules !== "object" || Array.isArray(rules)) {
    throw new Error("rules must be an object");
  }

  for (const field of ["priceIncrement", "quantityIncrement"]) {
    assertDecimalString(rules[field], `rules.${field}`);
    if (compareDecimal({ left: rules[field], right: "0" }) <= 0) {
      throw new Error(`rules.${field} must be greater than zero`);
    }
  }

  if (!Array.isArray(rules.supportedOrderTypes) || rules.supportedOrderTypes.length === 0 ||
      rules.supportedOrderTypes.some((type) => typeof type !== "string" || type.length === 0)) {
    throw new Error("rules.supportedOrderTypes must be a non-empty array of order type strings");
  }

  for (const field of TRADING_RULE_DECIMAL_FIELDS) {
    if (rules[field] === undefined || field === "priceIncrement" || field === "quantityIncrement") continue;
    assertDecimalString(rules[field], `rules.${field}`);
    if (["minQuantity", "maxQuantity", "minNotional", "maxNotional", "minPrice", "maxPrice",
      "minPriceMultiplier", "maxPriceMultiplier"].includes(field) &&
      compareDecimal({ left: rules[field], right: "0" }) < 0) {
      throw new Error(`rules.${field} must be non-negative`);
    }
  }

  if (rules.referencePrice !== undefined && compareDecimal({ left: rules.referencePrice, right: "0" }) <= 0) {
    throw new Error("rules.referencePrice must be greater than zero");
  }

  for (const [minimum, maximum, label] of [
    ["minQuantity", "maxQuantity", "quantity"],
    ["minNotional", "maxNotional", "notional"],
    ["minPrice", "maxPrice", "price"],
    ["minPriceMultiplier", "maxPriceMultiplier", "price multiplier"],
  ]) {
    if (rules[minimum] !== undefined && rules[maximum] !== undefined &&
        compareDecimal({ left: rules[minimum], right: rules[maximum] }) > 0) {
      throw new Error(`rules.${minimum} must not exceed rules.${maximum} (${label})`);
    }
  }

  const hasPercentBand = rules.minPriceMultiplier !== undefined || rules.maxPriceMultiplier !== undefined;
  if (hasPercentBand && (rules.referencePrice === undefined ||
      (rules.minPriceMultiplier === undefined || rules.maxPriceMultiplier === undefined))) {
    throw new Error("Percent price bands require referencePrice, minPriceMultiplier, and maxPriceMultiplier");
  }

  assertDecimalString(order.price, "order.price");
  assertDecimalString(order.quantity, "order.quantity");

  const reasons = [];
  const reject = (code, field, message) => reasons.push({ code, field, message });

  if (compareDecimal({ left: order.price, right: "0" }) <= 0) {
    reject("PRICE_NOT_POSITIVE", "price", "Price must be greater than zero");
  }

  if (compareDecimal({ left: order.quantity, right: "0" }) <= 0) {
    reject("QUANTITY_NOT_POSITIVE", "quantity", "Quantity must be greater than zero");
  }

  if (!rules.supportedOrderTypes.includes(order.type)) {
    reject("UNSUPPORTED_ORDER_TYPE", "type", `Order type ${String(order.type)} is not supported`);
  }

  if (compareDecimal({ left: order.price, right: "0" }) > 0 && compareDecimal({
    left: roundDecimalToIncrement({ value: order.price, increment: rules.priceIncrement, direction: "down" }),
    right: order.price,
  }) !== 0) {
    reject("PRICE_INCREMENT", "price", "Price is not aligned to the configured price increment");
  }

  if (compareDecimal({ left: order.quantity, right: "0" }) > 0 && compareDecimal({
    left: roundDecimalToIncrement({ value: order.quantity, increment: rules.quantityIncrement, direction: "down" }),
    right: order.quantity,
  }) !== 0) {
    reject("QUANTITY_INCREMENT", "quantity", "Quantity is not aligned to the configured quantity increment");
  }

  const checkMinimum = (value, minimum, code, field, label) => {
    if (minimum !== undefined && compareDecimal({ left: value, right: minimum }) < 0) {
      reject(code, field, `${label} is below the configured minimum`);
    }
  };
  const checkMaximum = (value, maximum, code, field, label) => {
    if (maximum !== undefined && compareDecimal({ left: value, right: maximum }) > 0) {
      reject(code, field, `${label} exceeds the configured maximum`);
    }
  };

  checkMinimum(order.quantity, rules.minQuantity, "MIN_QUANTITY", "quantity", "Quantity");
  checkMaximum(order.quantity, rules.maxQuantity, "MAX_QUANTITY", "quantity", "Quantity");
  checkMinimum(order.price, rules.minPrice, "MIN_PRICE", "price", "Price");
  checkMaximum(order.price, rules.maxPrice, "MAX_PRICE", "price", "Price");

  if (compareDecimal({ left: order.price, right: "0" }) > 0 &&
      compareDecimal({ left: order.quantity, right: "0" }) > 0) {
    const notional = calculateNotional({ price: order.price, quantity: order.quantity });
    checkMinimum(notional, rules.minNotional, "MIN_NOTIONAL", "notional", "Notional");
    checkMaximum(notional, rules.maxNotional, "MAX_NOTIONAL", "notional", "Notional");
  }

  if (hasPercentBand) {
    const lowerPrice = multiplyDecimal({ left: rules.referencePrice, right: rules.minPriceMultiplier });
    const upperPrice = multiplyDecimal({ left: rules.referencePrice, right: rules.maxPriceMultiplier });
    checkMinimum(order.price, lowerPrice, "PRICE_BELOW_PERCENT_BAND", "price", "Price");
    checkMaximum(order.price, upperPrice, "PRICE_ABOVE_PERCENT_BAND", "price", "Price");
  }

  return { valid: reasons.length === 0, reasons };
}
