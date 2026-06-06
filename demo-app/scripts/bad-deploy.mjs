// poolSize 1: with requests holding a slot 30-150ms, one slot serves ~10-20 req/s.
// At --rate=40 the queue outgrows the 2s acquire timeout and 503s accumulate.
// (poolSize 5 serves ~60 req/s — no realistic demo rate saturates it.)
import { deploy } from "./deploy-lib.mjs";
await deploy("1.4.0", 1);
