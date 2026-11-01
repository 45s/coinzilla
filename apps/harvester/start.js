import { defaultLogger } from "@coinzilla/utils";
import { main } from "./src/index.js";

await main({ logger: defaultLogger });
