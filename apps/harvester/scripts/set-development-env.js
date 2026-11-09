// Loaded before broker modules so TESTNET commands cannot inherit production endpoints.
process.env.NODE_ENV = "development"
