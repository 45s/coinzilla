import { simulatePriceMovement } from "./price-simulator.js"

async function main() {
  for await (const candle of simulatePriceMovement({ speed: 60 })) {
    console.log(`${candle.date} | DOGE: $${candle.close.toFixed(6)}`)

    // Your strategy can process each candle here.
  }
}

main().catch(console.error)
