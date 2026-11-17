// SPDX-License-Identifier: MIT
// Dip-buying mean-reversion bot for CBBTC/USDC, bars-replay/v1, long only.
//
// Idea, tuned on the published dev window (24h of 1-minute CBBTC bars, in which
// BTC fell ~4% and every trend baseline lost money): the only reliably
// profitable setups were sharp intraday washouts that bounced. So this bot
// waits for a deep, fast dip and buys it, then takes a quick profit and gets
// out — it never chases a trend and never holds through a falling market.
//
// Entry (once per bar, full cash, one position at a time):
//   - close down at least 1.50% against its close 30 bars ago, and
//   - RSI(14, Wilder) below 35 (oversold).
// Exit (whole position):
//   - take profit at +0.50% over the position's cost, or
//   - stop loss at -1.50% under its cost, or
//   - time stop after 180 bars held.
// A round trip costs ~26 bps in fees, slippage and impact, so the 50 bps
// take-profit target clears it with room; the stop caps a dip that keeps
// falling. No lookahead (only closes already sent), no clock, no randomness,
// no environment reads: the same bars give the same orders, run after run.

import { BPS, runBars, type Bar, type BarsState, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
const RSI_BARS = 14;
const DIP_LOOKBACK = 30;
const DIP_BPS = 150; // 1.50% down over the lookback
const RSI_ENTRY_BELOW = 35;
const TP_BPS = 50; // +0.50% over cost
const SL_BPS = 150; // -1.50% under cost
const MAX_HOLD_BARS = 180;
const MAX_SLIPPAGE_BPS = 100;

/** Closes seen so far, oldest first, as float64 raw units (like the baselines). */
const closes: number[] = [];
/** Wilder RSI state. */
let rsiGain: number | null = null;
let rsiLoss: number | null = null;
const rsiFirst: number[] = [];
let rsiLast: number | null = null;
/** Seq of the batch that decided the current entry (for the time stop). */
let entrySeq = -1;
/** A buy we sent whose outcome is not yet observed: still in flight, or
 *  filled but not yet visible as a position. While true, no fresh buy is
 *  sent. State below changes only on observation (fills, positions) —
 *  never on the act of sending an order: a sent order may be rejected,
 *  and a filled buy takes a batch to appear as a position. */
let buyPending = false;

function rsi(): number | null {
  if (rsiGain === null || rsiLoss === null) return null;
  const moved = rsiGain + rsiLoss;
  return moved === 0 ? 50 : (100 * rsiGain) / moved;
}

function push(bar: Bar): void {
  const c = Number(bar.c);
  closes.push(c);
  if (rsiLast !== null) {
    const change = c - rsiLast;
    if (rsiGain === null || rsiLoss === null) {
      rsiFirst.push(change);
      if (rsiFirst.length === RSI_BARS) {
        rsiGain = rsiFirst.reduce((a, x) => a + (x > 0 ? x : 0), 0) / RSI_BARS;
        rsiLoss = rsiFirst.reduce((a, x) => a + (x < 0 ? -x : 0), 0) / RSI_BARS;
      }
    } else {
      rsiGain = (rsiGain * (RSI_BARS - 1) + (change > 0 ? change : 0)) / RSI_BARS;
      rsiLoss = (rsiLoss * (RSI_BARS - 1) + (change < 0 ? -change : 0)) / RSI_BARS;
    }
  }
  rsiLast = c;
}

/** Dip in bps of the latest close against its close DIP_LOOKBACK bars ago. */
function dipBps(): number | null {
  if (closes.length <= DIP_LOOKBACK) return null;
  const now = closes[closes.length - 1]!;
  const then = closes[closes.length - 1 - DIP_LOOKBACK]!;
  if (then === 0) return null;
  return ((then - now) / then) * 10_000;
}

await runBars({
  onBatch(state, batch) {
    for (const bar of batch.bars) if (bar.symbol === SYMBOL) push(bar);
    // Observe what happened to our own earlier orders before deciding.
    // A rejected buy never happened, so it must not block a fresh entry;
    // a filled sell is the only proof the exit really executed.
    for (const fill of batch.fills) {
      if (fill.symbol !== SYMBOL) continue;
      if (fill.side === 'buy' && fill.status === 'rejected') buyPending = false;
      if (fill.side === 'sell' && fill.status === 'filled') entrySeq = -1;
    }
    if (state.warmingUp) return [];
    const fresh = batch.bars.some((b) => b.symbol === SYMBOL);
    if (!fresh) return [];
    const { caps, fees } = state.hello;
    const held = state.positions.get(SYMBOL);

    if (held !== undefined) {
      buyPending = false; // the position is here; no buy is outstanding
      const value = state.value(SYMBOL, held.qty);
      const cost = held.cost;
      const takeProfit = value * 10_000n >= cost * BigInt(10_000 + TP_BPS);
      const stopLoss = value * 10_000n <= cost * BigInt(10_000 - SL_BPS);
      const timeStop = entrySeq >= 0 && batch.seq - entrySeq >= MAX_HOLD_BARS;
      if (takeProfit || stopLoss || timeStop) {
        const sell: SellInput = { side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS };
        // entrySeq is NOT reset here: the sell may be rejected, and the
        // time stop must stay armed until the exit is observed (a filled
        // sell, or the position gone while nothing is pending). Resetting
        // it on send used to disarm the time stop permanently after one
        // rejected sell, trapping the position until the forced flatten.
        return [sell];
      }
      return [];
    }

    // Flat, and no buy outstanding: any entry anchor left over is stale —
    // the exit really executed, or the buy was rejected before a position
    // ever appeared. (buyPending still true on the fill bar is exactly
    // what stops a second, duplicate buy while the first is in flight.)
    if (!buyPending) entrySeq = -1;

    const dip = dipBps();
    const r = rsi();
    if (buyPending || dip === null || r === null || dip < DIP_BPS || r >= RSI_ENTRY_BELOW) return [];
    // Full cash, capped by the weight cap; below the minimum notional, buy nothing.
    const byWeight = (BigInt(caps.max_weight_bps) * state.equity) / BPS;
    const slice = state.cash < byWeight ? state.cash : byWeight;
    if (slice === 0n || slice < BigInt(fees.min_notional_quote_units)) return [];
    entrySeq = batch.seq;
    buyPending = true;
    const buy: BuyInput = { side: 'buy', symbol: SYMBOL, notional_quote_units: slice, max_slippage_bps: MAX_SLIPPAGE_BPS };
    return [buy];
  },
});
