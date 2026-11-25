[![make.fun](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)
[![rank](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/zxpast/makefun-pump-fun-replay/rank.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)
[![reward](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/zxpast/makefun-pump-fun-replay/reward.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)

# exhaustion-ride — Pump.fun Replay Sprint paper bot (v2)

A deterministic paper-trading bot for the [Pump.fun Replay Sprint — Paper Bot, Real Ranking](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122) competition on make.fun. It trades 10 SOL of paper money on a 24h replay of pump.fun bonding-curve activity (protocol `agent-fun/replay/v2`). Nothing is traded for real.

This is v2, a rebuild of the v1 launch-scalp bot (+0.323 SOL on the dev window). v2 beats it on the same window; see the dev-window result below. The final window is fresh data collected after the deadline, so dev numbers are a guide, not a promise.

## Strategy

A pump.fun price is a fixed function of its real SOL: price ~ (30 + rq)^2. A coin that reaches rq = 20 SOL sits at 2.78x its create price; one that reaches rq = 85 graduates at exactly 14.7x. Real SOL depth IS the signal — but 26 of the 35 graduations complete in the same slot as creation (uncatchable at 2-slot latency), and only 7–9 are slow enough to ride. The money is in the slow climbers.

- **Entry (fast heater):** a coin that reaches 20 SOL of real reserves within 30 slots of creation, with 6+ distinct buyers, creator not sold, and fresh flow still positive. It buys what the 1% cap allows (~0.2 SOL).
- **Scale-ins** only as real SOL doubles — never on price rises (buying after +8% price rises cost ~4.5 SOL in the prototype).
- **Exits:** lock 70% at +20% in two steps (40% of the position, then 50% of what remains), and let the last 30% ride as house money under a wide 35% give-back trail that ignores the twitchy exits — so a slow graduation (3x → 14.7x) pays for the many coins that peak at +20–40% and die. Otherwise: hard stop −5%, curve deflating −15% from peak real SOL, flow reversal, creator sell, stale coin, time limit.
- **Guardrail probe** (coin-paced only) keeps round trips coming when fills lag their pace: the run must end with a ≥0.01 SOL round trip on each of at least 20 coins, and max drawdown ≤50%.
- An exhaustion-pullback entry (sell climax + top-3 dispersion + pullback + resuming flow) is implemented but ships DISABLED — measured to lose on the dev window (exh-only −1.42 SOL).

## Dev-window result

Graded locally on the kit's full 24h dev window with the kit's own simulator port (`tools/sim.ts` in the pilot kit; no Docker on this machine, so `grade-local --driver docker` could not run):

| Metric | v2 | v1 |
|---|---|---|
| Net PnL | **+0.388 SOL** | +0.323 SOL |
| Fills | 140 | 260 |
| Coins traded | 60 | 129 |
| Round trips ≥ 0.01 SOL | 60 coins | 129 coins |
| Wins | 21 / 60 trips | 20 / 129 trips |
| Max drawdown | 0.033 | 0.006 |
| Net PnL without 3 best coins | −0.057 SOL | +0.027 SOL |
| Net PnL at 2x fees | +0.137 SOL | +0.192 SOL |
| Two runs byte-identical | yes | yes |

The plateau around the defaults is +0.36–0.39 SOL, not a single spike — but profit stays concentrated in 3 coins and in the window's second half, exactly like v1's, so the final window (fresh data) can still disappoint.

## Files

- `main.ts` — entrypoint: `node /bot/main.ts` (Node 22, stdlib only).
- `strategy.ts` — the strategy (pure function of the batch stream: no clock, no randomness, no I/O).
- `vendor/agentfun-bot.ts` — the kit's `agent-fun/replay/v2` shim, vendored byte for byte.

## License

MIT — see `LICENSE`.
