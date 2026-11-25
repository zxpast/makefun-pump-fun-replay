// Exhaustion-ride bot for the pump.fun replay (agent-fun/replay/v2).
//
// WHAT THE DEV WINDOW TEACHES (1,222 coins, 128,058 events, measured first-hand):
// - A pump.fun price is a fixed function of its real SOL: price ~ (30 + rq)^2. A coin that
//   reaches rq = 20 SOL sits at 2.78x its create price; one that reaches rq = 85 graduates at
//   exactly 14.7x. Real SOL depth IS the signal — but 26 of the 35 graduations complete in the
//   SAME slot as creation (uncatchable at 2-slot latency), and only 7-9 are slow enough to ride.
// - The money is in the slow climbers: coins that reach rq = 20 within ~30 slots of creation
//   and keep growing. The 7 slow graduations cross rq = 20 at 2.8-3.1x and rq = 50 at 7.1-7.7x;
//   100 slots after crossing rq = 30 they sit at rq ~50 on average, while non-graduating coins
//   fall back to rq ~26. So: enter the fast heaters, bank early, and let the remainder ride
//   while the curve keeps growing.
// - The median coin peaks only +26-41% over a late entry and then crashes hard within a few
//   slots, so a wide trailing stop alone gives everything back. The structure that works is:
//   lock 70% at +20% (two steps: 40% of the position, then 50% of what remains), and let the
//   last 30% ride as house money under a wide 35% give-back trail that ignores the twitchy
//   exits (hard stop, curve deflation, flow). A partial lock must NOT stop scale-ins: the v2
//   prototype caught a slow graduation (3.4x -> 14.7x) but banked only +0.29 SOL because the
//   first take-profit blocked every add; the fix lets adds continue as real SOL doubles.
// - Scale-ins are keyed to real-SOL doubling, never to price chasing: buying after every +8%
//   price rise cost ~4.5 SOL in the prototype (blended cost sat at the peak). The 1% of real
//   reserve cap per reply does the sizing for us — a 0.2 SOL seed at rq = 20 can grow toward
//   0.5 SOL per reply as the curve approaches graduation.
// - The exhaustion-pullback entry (sell climax + top-3 dispersion + pullback + resuming flow)
//   is implemented and kept, but measured to LOSE on this window (exh-only -1.42 SOL in the
//   prototype; enabling it at shallow thresholds cost -0.10 SOL against the final config), so
//   it ships DISABLED (exhEnabled false). The hot-curve entry carries the strategy; the
//   exhaustion logic stays as a documented, tested alternative for the final window.
// - v1 launch-scalp (+0.323 SOL, TP +30%, 129 coins) is beaten by this design on the same
//   window: +0.388 SOL, 60 coins (42 real entries + 18 guardrail probes), 140 fills, 60 trips,
//   21 wins, max drawdown 0.033, top-3 coins +0.446 SOL, ex-top-3 -0.057 SOL. The plateau
//   around the defaults is +0.36-0.39 SOL (maxAge 30-50, SL 5-10%, TP1/TP2 +20%), not a
//   single spike — but the profit stays concentrated in 3 coins and in the window's second
//   half, exactly like v1's, so the final window (fresh data) can still disappoint.
//
// Every decision is a pure function of the batches the harness sends: no clock, no randomness,
// no I/O, no environment reads. The slot number is the only clock, so the two graded runs
// produce byte-identical action logs.

import type { Batch, Bot, BotState, OrderInput, Pubkey } from './vendor/agentfun-bot.ts';

export interface Params {
  /** Youngest age (slots since CreateEvent) at which a coin may be bought. */
  minAge: number;
  /** Oldest age at which a first buy may still be decided. */
  maxAge: number;
  /** Entry A (hot curve): real SOL reserve at decision time must reach this (lamports). */
  hotMinRealSol: bigint;
  /** Entry A: distinct non-creator buyers seen before entry, at least. */
  hotMinBuyers: number;
  /** Entry A: enable. */
  hotEnabled: boolean;
  /** Entry B (exhaustion pullback): real SOL reserve must still reach this (lamports). */
  exhMinRealSol: bigint;
  /** Entry B: distinct non-creator buyers seen before entry, at least. */
  exhMinBuyers: number;
  /** Entry B: enable. */
  exhEnabled: boolean;
  /** Entry B: cumulative non-creator sells / cumulative buys, as bps, at least, to call the overhang sold. */
  exhClimaxBps: number;
  /** Entry B: top-3 holders' share of the float (bps) must have fallen to at most this. */
  exhTop3MaxBps: number;
  /** Entry B: price now over the peak price, as bps, at most (a pullback from the peak). */
  exhPullbackMaxBps: number;
  /** Entry B: recent-window net flow must be at least this (lamports) — fresh buys resuming. */
  exhMinFlowLamports: bigint;
  /** Entry B: distinct recent buyers in the flow window, at least. */
  exhMinRecentBuyers: number;
  /** Lamports to spend on the first buy of a coin (each reply still capped at 1% of real SOL). */
  firstBuyLamports: number;
  /** Lamports to aim for per coin in total across first buy + adds. */
  stakeLamports: number;
  /** Lamports per scale-in add. */
  addLamports: number;
  /** Most scale-in adds per coin. */
  maxAdds: number;
  /** An add needs real SOL at least this far (bps) above the real SOL at the previous buy. */
  addRqStepBps: number;
  /** An add waits this many slots after the previous buy was decided. */
  addDelay: number;
  /** Smallest single buy worth paying the tx fee for. */
  minBuyLamports: number;
  /** Creator's own buys in the create slot: at most this (lamports). */
  maxDevBuy: bigint;
  /** Lamports sold by others / lamports bought, as bps, at most, at entry. */
  maxSellRatioBps: number;
  /** Largest single non-creator sell seen, as bps of the real SOL reserve before it, at most. */
  maxBigSellBps: number;
  /** Slippage allowed on buys (bps). */
  buySlippageBps: number;
  /** Slippage allowed on sells (bps). 10000 = no guard: always fill, even into a crash. */
  sellSlippageBps: number;
  /** First take-profit: sell tp1PartBps of the position once it is worth tp1Bps over its cost. 0 = off. */
  tp1Bps: number;
  tp1PartBps: number;
  /** Second take-profit: sell tp2PartBps of what remains once it is worth tp2Bps over its cost. 0 = off. */
  tp2Bps: number;
  tp2PartBps: number;
  /** After the first take-profit, the rest stops out at this much under its cost (bps; negative = above). */
  slAfterTp1Bps: number;
  /** Exit when the position is worth this much under its cost (bps). */
  slBps: number;
  /** Trailing stop: arms once value is trailArmBps over cost, exits trailBps below the best value. 0 = off. */
  trailArmBps: number;
  trailBps: number;
  /** Ride mode (after the second take-profit): the remainder is house money — exits only on this
   * give-back (bps) below its best value, ignoring the hard stop, the curve-deflation exit and
   * the flow exit, so a slow graduation can run to 14.7x. */
  rideTrailBps: number;
  /** Exit when real SOL falls this far (bps) below its peak while held. 0 = off. */
  rqTrailBps: number;
  /** Exit after holding this many slots regardless. */
  maxHold: number;
  /** Exit when the position has made no progress (value under flatMultBps of cost) after this many slots. 0 = off. */
  flatExitSlots: number;
  /** Flat-exit bar: value must reach this (bps of cost) by flatExitSlots or the position closes. */
  flatMultBps: number;
  /** Exit at once when the creator sells (unless they had already sold when we bought). */
  exitOnDevSell: boolean;
  /** Exit when no trade has been seen on the coin for this many slots. */
  staleSlots: number;
  /** The recent-flow window (slots) for entry and exit flow checks. */
  flowWindow: number;
  /** Exit when recent net flow falls below -exitFlowLamports. 0 = off. */
  exitFlowLamports: bigint;
  /** Entry scan order: 'oldest' walks coins in create order, 'newest' freshest first. */
  entryOrder: 'oldest' | 'newest';
  /**
   * Guardrail pacing: the run must end with a round trip of at least 0.01 SOL on each of at
   * least 20 coins. Probes fire only when the bot's own coin count lags the pace (targetCoins
   * scaled by the share of paceSecs elapsed in block time since the first batch). targetFills
   * is retained for tuning but not used: the guardrail counts coins, not fills, and fill-paced
   * probes burned ~0.08 SOL in fees on the dev window.
   */
  targetCoins: number;
  targetFills: number;
  paceSecs: number;
  probeSol: number;
  maxProbes: number;
}

export const DEFAULT_PARAMS: Params = {
  minAge: 0,
  maxAge: 30,
  hotMinRealSol: 20_000_000_000n,
  hotMinBuyers: 6,
  hotEnabled: true,
  exhMinRealSol: 5_000_000_000n,
  exhMinBuyers: 8,
  exhEnabled: false,
  exhClimaxBps: 5_000,
  exhTop3MaxBps: 4_500,
  exhPullbackMaxBps: 9_000,
  exhMinFlowLamports: 0n,
  exhMinRecentBuyers: 3,
  firstBuyLamports: 500_000_000,
  stakeLamports: 1_500_000_000,
  addLamports: 150_000_000,
  maxAdds: 8,
  addRqStepBps: 10_000,
  addDelay: 2,
  minBuyLamports: 5_000_000,
  maxDevBuy: 2_500_000_000n,
  maxSellRatioBps: 10_000,
  maxBigSellBps: 10_000,
  buySlippageBps: 500,
  sellSlippageBps: 10_000,
  tp1Bps: 2_000,
  tp1PartBps: 4_000,
  tp2Bps: 2_000,
  tp2PartBps: 5_000,
  slAfterTp1Bps: 0,
  slBps: 500,
  trailArmBps: 4_000,
  trailBps: 1_500,
  rideTrailBps: 3_500,
  rqTrailBps: 1_500,
  maxHold: 20_000,
  flatExitSlots: 1_000,
  flatMultBps: 10_500,
  exitOnDevSell: true,
  staleSlots: 3_000,
  flowWindow: 10,
  exitFlowLamports: 500_000_000n,
  entryOrder: 'oldest',
  targetCoins: 25,
  targetFills: 240,
  paceSecs: 14_400,
  probeSol: 0.012,
  maxProbes: 1,
};

const BPS = 10_000n;
const LAMPORTS = 1_000_000_000n;
/** Protocol 95 bps + creator 30 bps, the curve fee on every trade. */
const FEE_BPS = 125n;

interface Tick {
  slot: number;
  isBuy: boolean;
  sol: bigint;
  user: Pubkey;
}

interface Tape {
  mint: Pubkey;
  createSlot: number;
  creator: Pubkey;
  vq0: bigint;
  vt0: bigint;
  devBuy: bigint;
  devSold: boolean;
  buyers: Set<Pubkey>;
  bought: bigint;
  soldByOthers: bigint;
  bigSellBps: bigint;
  /** Net token balance per wallet (buys minus sells), for holder concentration. */
  balances: Map<Pubkey, bigint>;
  top3Bps: bigint;
  peakTop3Bps: bigint;
  /** Price multiple over create, in bps (10000 = 1.00x). */
  peakMultBps: bigint;
  peakRq: bigint;
  climax: boolean;
  lastTradeSlot: number;
  recent: Tick[];
  buysSent: number;
  spentSent: bigint;
  addsSent: number;
  lastBuySlot: number;
  lastBuyRq: bigint;
  entered: boolean;
  done: boolean;
  complete: boolean;
}

interface Held {
  openedSlot: number;
  txPaid: bigint;
  best: bigint;
  bestRq: bigint;
  devSoldAtOpen: boolean;
  tookTp1: boolean;
  tookTp2: boolean;
  /** Ride mode: set when the second take-profit fires; the remainder is house money. */
  ride: boolean;
}

/** What selling `tokens` against (vq, vt) would pay after curve fees. */
function sellValue(tokens: bigint, vq: bigint, vt: bigint): bigint {
  if (tokens <= 0n || vt <= 0n) return 0n;
  const q = (tokens * vq) / (vt + tokens);
  return q - (q * FEE_BPS + BPS - 1n) / BPS;
}

/** Price multiple over the create price, in bps, at (vq, vt). */
function multBps(vq: bigint, vt: bigint, vq0: bigint, vt0: bigint): bigint {
  if (vt <= 0n || vq0 <= 0n) return BPS;
  return (vq * vt0 * BPS) / (vt * vq0);
}

export function createStrategy(p: Params = DEFAULT_PARAMS): Bot {
  const P = p;
  const tapes = new Map<Pubkey, Tape>();
  const held = new Map<Pubkey, Held>();
  const selling = new Set<Pubkey>();
  const probes = new Map<Pubkey, boolean>();
  /** Mints already probed once: a probe round trip is never repeated on the same mint. */
  const probedDone = new Set<Pubkey>();
  const firstBuy = BigInt(P.firstBuyLamports);
  const stake = BigInt(P.stakeLamports);
  const addSize = BigInt(P.addLamports);
  const minBuy = BigInt(P.minBuyLamports);
  let firstTime: number | null = null;
  let lastTime: number | null = null;
  const myCoins = new Set<Pubkey>();

  function readEvents(batch: Batch): void {
    for (const e of batch.events) {
      if (e.block_time !== null) {
        if (firstTime === null) firstTime = e.block_time;
        if (lastTime === null || e.block_time > lastTime) lastTime = e.block_time;
      }
      if (e.event === 'CreateEvent') {
        tapes.set(e.mint, {
          mint: e.mint,
          createSlot: e.slot,
          creator: e.creator,
          vq0: BigInt(e.virtual_quote_reserves),
          vt0: BigInt(e.virtual_token_reserves),
          devBuy: 0n,
          devSold: false,
          buyers: new Set(),
          bought: 0n,
          soldByOthers: 0n,
          bigSellBps: 0n,
          balances: new Map(),
          top3Bps: BPS,
          peakTop3Bps: BPS,
          peakMultBps: BPS,
          peakRq: 0n,
          climax: false,
          lastTradeSlot: e.slot,
          recent: [],
          buysSent: 0,
          spentSent: 0n,
          addsSent: 0,
          lastBuySlot: -1,
          lastBuyRq: 0n,
          entered: false,
          done: false,
          complete: false,
        });
      } else if (e.event === 'TradeEvent') {
        const t = tapes.get(e.mint);
        if (t === undefined) continue;
        const sol = BigInt(e.sol_amount);
        const toks = BigInt(e.token_amount);
        t.lastTradeSlot = e.slot;
        t.recent.push({ slot: e.slot, isBuy: e.is_buy, sol, user: e.user });
        const isDev = e.user === t.creator;
        const m = multBps(BigInt(e.virtual_quote_reserves), BigInt(e.virtual_token_reserves), t.vq0, t.vt0);
        if (m > t.peakMultBps) t.peakMultBps = m;
        const rq = BigInt(e.real_quote_reserves);
        if (rq > t.peakRq) t.peakRq = rq;
        if (e.is_buy) {
          t.bought += sol;
          if (isDev && e.slot === t.createSlot) t.devBuy += sol;
          else if (!isDev) t.buyers.add(e.user);
          t.balances.set(e.user, (t.balances.get(e.user) ?? 0n) + toks);
        } else if (isDev) {
          t.devSold = true;
          t.balances.set(e.user, (t.balances.get(e.user) ?? 0n) - toks);
        } else {
          t.soldByOthers += sol;
          const rqBefore = rq + sol;
          if (rqBefore > 0n) {
            const bps = (sol * BPS) / rqBefore;
            if (bps > t.bigSellBps) t.bigSellBps = bps;
          }
          t.balances.set(e.user, (t.balances.get(e.user) ?? 0n) - toks);
        }
        // Holder concentration: top-3 share of the positive float, in bps.
        let total = 0n;
        let first = 0n;
        let second = 0n;
        let third = 0n;
        for (const bal of t.balances.values()) {
          if (bal <= 0n) continue;
          total += bal;
          if (bal > first) { third = second; second = first; first = bal; }
          else if (bal > second) { third = second; second = bal; }
          else if (bal > third) { third = bal; }
        }
        t.top3Bps = total > 0n ? ((first + second + third) * BPS) / total : BPS;
        if (t.top3Bps > t.peakTop3Bps) t.peakTop3Bps = t.top3Bps;
        // Sell climax: non-creator sells pass half of all buys.
        if (!t.climax && t.bought > 0n && t.soldByOthers * 2n >= t.bought) t.climax = true;
      } else {
        const t = tapes.get(e.mint);
        if (t !== undefined) {
          t.complete = true;
          t.done = true;
        }
      }
    }
  }

  /** Net lamports bought minus sold and the distinct buyers, over the last flowWindow slots. */
  function flow(t: Tape, slot: number): { net: bigint; buyers: number } {
    const from = slot - P.flowWindow;
    let drop = 0;
    while (drop < t.recent.length && t.recent[drop]!.slot <= from) drop++;
    if (drop > 0) t.recent.splice(0, drop);
    let net = 0n;
    const buyers = new Set<Pubkey>();
    for (const tick of t.recent) {
      if (tick.isBuy) {
        net += tick.sol;
        if (tick.user !== t.creator) buyers.add(tick.user);
      } else net -= tick.sol;
    }
    return { net, buyers: buyers.size };
  }

  function hasPending(state: BotState, mint: Pubkey, side: 'buy' | 'sell'): boolean {
    for (const po of state.pending.values()) if (po.order.mint === mint && po.order.side === side) return true;
    return false;
  }

  return {
    onBatch(state: BotState, batch: Batch): OrderInput[] {
      readEvents(batch);
      const orders: OrderInput[] = [];
      const cap = state.hello.caps.max_orders_per_batch;
      const tx = state.txFeeLamports();
      const marks = new Map<Pubkey, { vq: bigint; vt: bigint }>();
      for (const m of batch.marks) marks.set(m.mint, { vq: BigInt(m.virtual_quote_reserves), vt: BigInt(m.virtual_token_reserves) });

      for (const f of batch.fills) {
        if (f.client_id.startsWith('_')) {
          held.delete(f.mint);
          selling.delete(f.mint);
          probes.delete(f.mint);
          continue;
        }
        if (f.status === 'filled') {
          myCoins.add(f.mint);
        }
        const h = held.get(f.mint);
        if (f.status !== 'rejected' && h !== undefined) h.txPaid += BigInt(f.tx_fee_lamports);
        if (f.side === 'buy' && f.status === 'filled' && h === undefined) {
          const t = tapes.get(f.mint);
          held.set(f.mint, { openedSlot: f.slot, txPaid: BigInt(f.tx_fee_lamports), best: 0n, bestRq: 0n, devSoldAtOpen: t?.devSold ?? false, tookTp1: false, tookTp2: false, ride: false });
        }
      }
      for (const mint of [...selling]) if (!hasPending(state, mint, 'sell')) selling.delete(mint);
      for (const mint of [...held.keys()]) {
        if (!state.positions.has(mint) && !selling.has(mint) && !hasPending(state, mint, 'buy')) held.delete(mint);
      }

      // Exits first: partial take-profit, trailing stop, hard stop, curve deflating, creator sell,
      // flow reversal, stale coin, time limit.
      for (const [mint, pos] of state.positions) {
        if (orders.length >= cap) break;
        if (selling.has(mint) || probes.has(mint)) continue;
        const t = tapes.get(mint);
        let h = held.get(mint);
        if (h === undefined) {
          h = { openedSlot: state.slot, txPaid: tx, best: 0n, bestRq: 0n, devSoldAtOpen: t?.devSold ?? false, tookTp1: false, tookTp2: false, ride: false };
          held.set(mint, h);
        }
        let mk = marks.get(mint);
        if (mk === undefined) {
          const cv = state.curves.get(mint);
          if (cv === undefined) continue;
          mk = { vq: cv.virtual_quote_reserves, vt: cv.virtual_token_reserves };
        }
        const value = sellValue(pos.token_amount, mk.vq, mk.vt) - tx;
        const basis = pos.cost_lamports + h.txPaid;
        if (value > h.best) h.best = value;
        const curve = state.curves.get(mint);
        if (curve !== undefined && curve.real_quote_reserves > h.bestRq) h.bestRq = curve.real_quote_reserves;
        let exit = false;
        if (basis > 0n) {
          if (P.tp1Bps > 0 && !h.tookTp1 && value * BPS >= basis * (BPS + BigInt(P.tp1Bps))) {
            const part = (pos.token_amount * BigInt(P.tp1PartBps)) / BPS;
            if (part > 0n && part < pos.token_amount) {
              orders.push({ side: 'sell', mint, token_amount: part, max_slippage_bps: P.sellSlippageBps });
              selling.add(mint);
              h.tookTp1 = true;
              h.best = 0n;
              // NOTE: no t.done here — the remainder keeps riding and may still scale in as the
              // curve grows. A partial lock must not kill the graduation ride: on the dev window
              // the bot caught a slow graduation (52frC8om, 3.4x -> 14.7x) but made only +0.29
              // SOL because the TP1 done-flag blocked every add after the first +40%.
              continue;
            }
          }
          if (P.tp2Bps > 0 && h.tookTp1 && !h.tookTp2 && value * BPS >= basis * (BPS + BigInt(P.tp2Bps))) {
            const part = (pos.token_amount * BigInt(P.tp2PartBps)) / BPS;
            if (part > 0n && part < pos.token_amount) {
              orders.push({ side: 'sell', mint, token_amount: part, max_slippage_bps: P.sellSlippageBps });
              selling.add(mint);
              h.tookTp2 = true;
              // Ride mode: the remainder is house money. Arm the wide trail at the level just
              // banked, and stop watching the twitchy exits (hard stop, curve deflation, flow).
              h.ride = true;
              h.best = value;
              continue;
            }
          }
          if (h.ride) {
            // Ride mode: exit only on a wide give-back from the best value.
            if (value * BPS <= h.best * (BPS - BigInt(P.rideTrailBps))) exit = true;
          } else {
            const sl = h.tookTp1 ? BigInt(P.slAfterTp1Bps) : BigInt(P.slBps);
            if (value * BPS <= basis * (BPS - sl)) exit = true;
            if (P.trailArmBps > 0 && h.best * BPS >= basis * (BPS + BigInt(P.trailArmBps)) && value * BPS <= h.best * (BPS - BigInt(P.trailBps))) exit = true;
          }
        }
        if (!h.ride && P.rqTrailBps > 0 && curve !== undefined && h.bestRq > 0n && curve.real_quote_reserves * BPS <= h.bestRq * (BPS - BigInt(P.rqTrailBps))) exit = true;
        if (state.slot - h.openedSlot >= P.maxHold) exit = true;
        if (!h.ride && P.flatExitSlots > 0 && state.slot - h.openedSlot >= P.flatExitSlots && basis > 0n && value * BPS < basis * BigInt(P.flatMultBps)) exit = true;
        if (t !== undefined) {
          if (P.exitOnDevSell && t.devSold && !h.devSoldAtOpen) exit = true;
          if (state.slot - t.lastTradeSlot >= P.staleSlots) exit = true;
          if (!h.ride && P.exitFlowLamports > 0n && flow(t, state.slot).net < -P.exitFlowLamports) exit = true;
        }
        if (!exit) continue;
        orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: P.sellSlippageBps });
        selling.add(mint);
        if (t !== undefined) t.done = true;
      }

      // Probe round trips: sell the whole probe as soon as its buy has landed.
      for (const [mint, sellingProbe] of probes) {
        const pos = state.positions.get(mint);
        const curve = state.curves.get(mint);
        if (pos === undefined) {
          if (!hasPending(state, mint, 'buy')) probes.delete(mint);
          continue;
        }
        if (curve === undefined || curve.complete || hasPending(state, mint, 'sell')) continue;
        if (orders.length >= cap) break;
        orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: P.sellSlippageBps });
        if (!sellingProbe) probes.set(mint, true);
      }

      // Scale-in adds: only when the curve itself has grown (real SOL up addRqStepBps since the
      // last buy) and the tape still flows in. Size grows with the curve through the 1% cap.
      let free = state.freeCashLamports() - tx * BigInt(orders.length);
      let open = state.committedPositionCount();
      for (const [mint, h] of held) {
        if (orders.length >= cap) break;
        if (selling.has(mint) || probes.has(mint)) continue;
        const t = tapes.get(mint);
        if (t === undefined || t.done || t.complete) continue;
        if (!state.positions.has(mint) || hasPending(state, mint, 'buy')) continue;
        if (t.addsSent >= P.maxAdds) continue;
        if (state.slot - t.lastBuySlot < P.addDelay) continue;
        if (t.spentSent >= stake) continue;
        const curve = state.curves.get(mint);
        if (curve === undefined || curve.complete) continue;
        if (curve.real_quote_reserves * BPS < t.lastBuyRq * (BPS + BigInt(P.addRqStepBps))) continue;
        const fl = flow(t, state.slot);
        // In ride mode the curve's own growth is the signal; a quiet 10-slot flow window must
        // not block scaling into a slow graduation.
        if (!h.ride && fl.net < 0n) continue;
        const room = stake - t.spentSent;
        const want = room < addSize ? room : addSize;
        if (want < minBuy) continue;
        const maxBuy = state.maxBuyLamports(mint);
        const amount = want < maxBuy ? want : maxBuy;
        if (amount < minBuy) continue;
        if (free < amount + tx) continue;
        orders.push({ side: 'buy', mint, quote_lamports: amount, max_slippage_bps: P.buySlippageBps });
        free -= amount + tx;
        t.buysSent += 1;
        t.addsSent += 1;
        t.spentSent += amount;
        t.lastBuySlot = state.slot;
        t.lastBuyRq = curve.real_quote_reserves;
      }

      // Entries: hot-curve (A) or exhaustion-pullback (B).
      const scan = [...tapes.values()];
      if (P.entryOrder === 'newest') scan.reverse();
      for (const t of scan) {
        if (orders.length >= cap) break;
        if (t.done || t.complete || t.entered) continue;
        const age = state.slot - t.createSlot;
        if (age > P.maxAge) {
          t.done = true;
          continue;
        }
        if (age < P.minAge) continue;
        if (open >= state.hello.caps.max_open_positions) continue;
        const curve = state.curves.get(t.mint);
        if (curve === undefined || curve.complete) continue;
        if (t.devSold) continue;
        if (t.devBuy > P.maxDevBuy) continue;
        if (probes.has(t.mint) || hasPending(state, t.mint, 'buy')) continue;
        if (t.bought > 0n && t.soldByOthers * BPS > t.bought * BigInt(P.maxSellRatioBps)) continue;
        if (t.bigSellBps > BigInt(P.maxBigSellBps)) continue;
        const rq = curve.real_quote_reserves;
        const m = multBps(curve.virtual_quote_reserves, curve.virtual_token_reserves, t.vq0, t.vt0);
        let signal = false;
        if (P.hotEnabled && rq >= P.hotMinRealSol && t.buyers.size >= P.hotMinBuyers) {
          const fl = flow(t, state.slot);
          if (fl.net >= 0n) signal = true;
        }
        if (!signal && P.exhEnabled && rq >= P.exhMinRealSol && t.buyers.size >= P.exhMinBuyers) {
          const fl = flow(t, state.slot);
          const climaxOk = t.climax && t.soldByOthers * BPS >= t.bought * BigInt(P.exhClimaxBps);
          const dispersedOk = t.top3Bps <= BigInt(P.exhTop3MaxBps);
          const pulledBack = m * BPS <= t.peakMultBps * BigInt(P.exhPullbackMaxBps);
          const resuming = fl.net >= P.exhMinFlowLamports && fl.buyers >= P.exhMinRecentBuyers;
          if (climaxOk && dispersedOk && pulledBack && resuming) signal = true;
        }
        if (!signal) continue;
        const room = stake - t.spentSent;
        if (room < minBuy) continue;
        const maxBuy = state.maxBuyLamports(t.mint);
        const amount = firstBuy < maxBuy ? firstBuy : maxBuy;
        if (amount < minBuy) continue;
        if (free < amount + tx) continue;
        orders.push({ side: 'buy', mint: t.mint, quote_lamports: amount, max_slippage_bps: P.buySlippageBps });
        free -= amount + tx;
        t.entered = true;
        t.buysSent += 1;
        t.spentSent += amount;
        t.lastBuySlot = state.slot;
        t.lastBuyRq = rq;
        open += 1;
      }

      // Guardrail pacing: the run must end with a round trip of at least 0.01 SOL on each of at
      // least 20 coins. Probe ONLY when the coin count lags the pace — the guardrail counts
      // coins, not fills (min_fills is 0), so chasing a fill target with 0.012 SOL probes just
      // burns curve fees + tx fees. Measured on the dev window: fill-paced probes fired 154
      // times (~0.08 SOL of fees) while real entries already covered 42 coins; coin-paced
      // probes fire a handful of times at most.
      if (probes.size < P.maxProbes && open < state.hello.caps.max_open_positions && firstTime !== null && lastTime !== null) {
        const pace = Math.min(1, (lastTime - firstTime) / P.paceSecs);
        const needCoins = myCoins.size < Math.ceil(P.targetCoins * pace);
        if (needCoins) {
          const minRq = (BigInt(Math.floor(P.probeSol * Number(LAMPORTS))) * BPS) / BigInt(state.hello.caps.max_order_bps_of_real_reserve);
          for (const t of tapes.values()) {
            if (orders.length >= cap || probes.size >= P.maxProbes) break;
            if (t.done || t.complete || probes.has(t.mint) || probedDone.has(t.mint) || myCoins.has(t.mint) || hasPending(state, t.mint, 'buy') || state.positions.has(t.mint)) continue;
            const curve = state.curves.get(t.mint);
            if (curve === undefined || curve.complete) continue;
            if (curve.real_quote_reserves < (minRq * 3n) / 2n) continue;
            if (free < BigInt(Math.floor(P.probeSol * Number(LAMPORTS))) + 2n * tx) break;
            orders.push({ side: 'buy', mint: t.mint, quote_lamports: BigInt(Math.floor(P.probeSol * Number(LAMPORTS))), max_slippage_bps: P.buySlippageBps });
            probes.set(t.mint, false);
            probedDone.add(t.mint);
            free -= BigInt(Math.floor(P.probeSol * Number(LAMPORTS))) + tx;
          }
        }
      }
      return orders;
    },
  };
}
