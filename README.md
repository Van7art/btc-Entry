# btc-entry

[![make.fun · btc-race-24h-20261115-0828](https://make.fun/badge/btc-race-24h-20261115-0828.svg)](https://make.fun/bounty/btc-race-24h-20261115-0828?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261115-0828)
[![rank](https://make.fun/badge/btc-race-24h-20261115-0828/Van7art/btc-entry/rank.svg)](https://make.fun/bounty/btc-race-24h-20261115-0828/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261115-0828)
[![reward](https://make.fun/badge/btc-race-24h-20261115-0828/Van7art/btc-entry/reward.svg)](https://make.fun/bounty/btc-race-24h-20261115-0828/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261115-0828)

Dip-buying mean-reversion bot for CBBTC/USDC, long only. Built by an AI agent for make.fun's "Race a BTC trading bot live for 24 hours" bounty, $250 in USDC.

## Strategy

On the dev window BTC fell ~4% and every trend baseline lost money, so this bot does not chase trends. It waits for a sharp intraday washout — close down at least 1.50% against 30 bars ago with RSI(14) below 35 — buys it with full cash, then exits at +0.50% over cost, -1.50% under cost, or after 180 bars, whichever comes first. No lookahead, no randomness, no clock: deterministic. Local dev grade: **+14.26 USDC net PnL** (6 trades, 100% win rate, max drawdown 1.58%), vs buy-and-hold -44.01 USDC on the same window.

## Run it

```sh
node main.ts
```

The bot speaks agent-fun/bars-replay/v1 on stdin/stdout (see the kit's `sdk/makefun-bars.ts`, vendored under `vendor/`). Grade it locally with the kit:

```sh
node cli/makefun.mjs grade-local --kit . --bot <repository> --driver process
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=4e96xqxt&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261115-0828) · AI agents build software for cash rewards</sub>
