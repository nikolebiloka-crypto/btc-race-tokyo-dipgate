// TOKYO Dip-Gate swing bot — make.fun btc-race-24h-20261112-1439
//
// Strategy: long-only dip-buyer with a trend gate.
//   Buy   when the latest close dips at least 0.6% under the highest close of the
//         previous 15 bars, AND the close is above its 60-bar SMA (uptrend gate).
//   Sell  when the close is at least +0.8% above the position's entry price.
// Full cash per buy, wide slippage cap, one position at a time. Deterministic: the
// only state is the SMA window and the closes history; no clock, no randomness.
//
// Entry price is taken from the buy fill reported in the next batch (fees included),
// not derived from cost basis.
import { runBars, type BarsState, type Batch, type OrderInput } from './vendor/makefun-bars.ts';

const DIP_LOOK = 15; // bars for the recent-high lookback
const DIP_BP = 0.0055; // dip depth: close <= recentHigh * (1 - DIP_BP)
const GATE_LEN = 60; // SMA length for the trend gate
const TP_BP = 0.009; // take-profit above entry
const MAX_SLIPPAGE_BPS = 400; // generous: modelled 2 bps + impact (~7 bps full size)
const ARM_BP = 0.005; // arm the trailing floor once 0.5% above entry
const TRAIL_BP = 0.003; // trail width once armed

const closes: (number | null)[] = []; // closes by seq
let entryPx: number | null = null; // position entry price (fill price)
let buyInFlight = false; // a buy was sent and not yet resolved
let trailFloor = 0; // trailing sell floor, rises with closes while armed
let smaSum = 0; // sum of the last GATE_LEN closes

/** Rolling SMA of the last GATE_LEN closes ending at seq; null while warming up. */
function sma(seq: number): number | null {
  if (seq + 1 < GATE_LEN) return null;
  return smaSum / GATE_LEN;
}

// Review pass 1: split magic dip threshold into a helper so the entry condition reads as prose.
/** True when the latest close is a qualifying dip under the recent high. */
function isDip(seq: number, hi: number): boolean {
  return hi > 0 && closes[seq]! <= hi * (1 - DIP_BP);
}

await runBars({
  onBatch(state: BarsState, batch: Batch): OrderInput[] {
    const bar = batch.bars[0];
    if (!bar) return [];
    const seq = batch.seq;
    const c = Number(bar.c) / 1e8;
    closes[seq] = c;
    if (entryPx != null) trailFloor = Math.max(trailFloor, c * (1 - TRAIL_BP));

    // maintain the rolling SMA sum
    smaSum += c;
    const out = closes[seq - GATE_LEN];
    if (seq >= GATE_LEN && out != null) smaSum -= out;

    // book the previous batch's fills: learn the entry price, clear the in-flight flag
    for (const f of batch.fills) {
      if (f.side === 'buy') {
        buyInFlight = false;
        if (f.status === 'filled') { entryPx = Number(f.price) / 1e8; trailFloor = 0; } // raw price (price_scale 8) -> USDC
      }
      if (f.side === 'sell' && f.status === 'filled') entryPx = null;
    }

    const heldQty = state.positions.get(bar.symbol);
    const orders: OrderInput[] = [];

    if (seq < Math.max(DIP_LOOK, GATE_LEN)) return orders;

    if (heldQty === undefined) {
      if (buyInFlight || entryPx !== null) return orders; // buy in flight, wait for its fill
      // recent high over the previous DIP_LOOK bars
      let hi = 0;
      for (let j = seq - DIP_LOOK; j < seq; j++) {
        const v = closes[j];
        if (v == null) return orders;
        if (v > hi) hi = v;
      }
      const s = sma(seq);
      const dip = isDip(seq, hi);
      const gate = s != null && c > s;
      if (dip && gate && state.cash > 1_000_000n) {
        // Review pass 3: no console output — stdout is the wire protocol, printing breaks the batch reply.
        buyInFlight = true;
        trailFloor = 0;
        orders.push({ side: 'buy', symbol: bar.symbol, notional_quote_units: state.cash, max_slippage_bps: MAX_SLIPPAGE_BPS });
      }
    } else if (entryPx != null) {
      // take profit, or trail the position once it is 0.5% above entry to lock in gains
      if (c >= entryPx * (1 + TP_BP)) {
        orders.push({ side: 'sell', symbol: bar.symbol, qty: heldQty.qty, max_slippage_bps: MAX_SLIPPAGE_BPS });
      } else if (c >= entryPx * (1 + ARM_BP) && c <= trailFloor) {
        orders.push({ side: 'sell', symbol: bar.symbol, qty: heldQty.qty, max_slippage_bps: MAX_SLIPPAGE_BPS });
      }
    }
    return orders;
  },
});
