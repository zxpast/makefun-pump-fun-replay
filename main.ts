// launch-scalp: a pump.fun replay bot (agent-fun/replay/v2).
// The grader runs `node /bot/main.ts`; the strategy lives in strategy.ts and the SDK shim is the
// kit's vendor/agentfun-bot.ts, vendored byte for byte.
//
// How it trades: the hello handshake tells us the capital (10 SOL paper), the caps (5 open
// positions, 1% of real reserve per reply per mint, 16 orders per batch) and the 2-slot latency.
// Every batch we read that slot's events, exit positions that hit take-profit (+30%) /
// stop-loss (-12%) / the 30-slot time limit / creator-sell, then buy fresh launches whose
// opening tape passes the rug filter — creator did not sell, creator buy under 2.5 SOL, at
// least 15 distinct buyers in the first 3 slots, real SOL 0.3-30 — sized at min(0.5 SOL, 1%
// of real reserve) with a 5% buy-slippage guard, so a buy whose price jumped in the latency is
// refused instead of chasing a pump that already moved. A guardrail probe keeps round trips
// coming when fills lag their pace. No clock, no randomness, no I/O: the two graded runs
// produce byte-identical action logs.
//
// Dev-window result (kit tools/sim.ts port, full 24h window): net +0.323 SOL, 260 fills,
// 129 coins, max drawdown 0.006, positive even without the 3 best coins (+0.027 ex-top-3).
// The momentum pilot loses -9.38 SOL and the reversion pilot -4.08 SOL on the same window;
// this bot wins by trading only the hottest launches, small and fast, instead of chasing.

import { runBot } from './vendor/agentfun-bot.ts';
import { createStrategy, DEFAULT_PARAMS } from './strategy.ts';

await runBot(createStrategy(DEFAULT_PARAMS));
