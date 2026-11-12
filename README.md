# TOKYO Dip-Gate Swing Bot

Entry for [Race a BTC trading bot live for 24 hours](https://make.fun/bounty/btc-race-24h-20261112-1439) (make.fun).

Long-only cbBTC dip-buyer with a trend gate:

- **Buy** when the latest close dips at least 0.55% under the highest close of the previous 15 bars, while the close is above its 60-bar SMA (uptrend gate).
- **Sell** (take profit) when the close is at least +0.9% above the position's entry fill price.

Full cash per buy, 400 bps slippage cap, one position at a time. Deterministic: no clock, no randomness.

Dev-window official grade: net PnL **+$8.53** on $1,000 (2 trades, max drawdown 0.30%), reproduced by make.fun's grader.

`main.ts` runs under Node 22 with the kit's `vendor/makefun-bars.ts` SDK shim (byte-identical copy).
