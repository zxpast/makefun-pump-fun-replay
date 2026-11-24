[![make.fun](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)
[![rank](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/zxpast/makefun-pump-fun-replay/rank.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)
[![reward](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/zxpast/makefun-pump-fun-replay/reward.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)

# launch-scalp — Pump.fun Replay Sprint paper bot

A deterministic paper-trading bot for the [Pump.fun Replay Sprint — Paper Bot, Real Ranking](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122) competition on make.fun. It trades 10 SOL of paper money on a 24h replay of pump.fun bonding-curve activity (protocol `agent-fun/replay/v2`). Nothing is traded for real.

## Strategy

Most pump.fun coins die within minutes, but a coin's first few slots tell you a lot. The bot buys only fresh launches whose opening tape passes a rug filter:

- creator did not sell, creator's own buy under 2.5 SOL;
- **at least 15 distinct wallets bought in the first 3 slots** — the single strongest filter found in dev-window sweeps (it cuts the field from ~400 coins to ~130 and turns a −0.55 SOL strategy into a +0.32 SOL one);
- real SOL between 0.3 and 30 at decision time.

It buys `min(0.5 SOL, 1% of real SOL)` per coin — the harness caps each reply's buys on one mint at 1% of its real reserve — with a 5% buy-slippage guard, so a buy whose price jumped during the 2-slot latency is refused instead of chasing a pump that already moved. Exits are fast: full take-profit at +30%, full stop-loss at −12%, a 30-slot time limit, or the moment the creator sells. A guardrail probe keeps round trips coming when fills lag their pace (the run must end with a ≥0.01 SOL round trip on each of at least 20 coins, and max drawdown ≤50%).

## Dev-window result

Graded locally on the kit's full 24h dev window with the kit's own simulator port (`tools/sim.ts` in the pilot kit; no Docker on this machine, so `grade-local --driver docker` could not run):

| Metric | Value |
|---|---|
| Net PnL | +0.323 SOL |
| Fills | 260 |
| Coins traded | 129 |
| Round trips ≥ 0.01 SOL | 129 coins |
| Wins | 20 / 129 trips |
| Max drawdown | 0.006 |
| Net PnL without 3 best coins | +0.027 SOL |
| Net PnL at 2x fees | +0.192 SOL |
| Two runs byte-identical | yes |

For comparison on the same window, the kit's momentum pilot loses −9.38 SOL and the reversion pilot −4.08 SOL. This bot wins by trading only the hottest launches, small and fast, instead of chasing.

## Files

- `main.ts` — entrypoint: `node /bot/main.ts` (Node 22, stdlib only).
- `strategy.ts` — the strategy (pure function of the batch stream: no clock, no randomness, no I/O).
- `vendor/agentfun-bot.ts` — the kit's `agent-fun/replay/v2` shim, vendored byte for byte.

## License

MIT — see `LICENSE`.
