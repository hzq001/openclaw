---
name: ai-trade
description: "AI-Trade CLI. Monitor Jin10/CLS financial news, manage portfolio/database, fetch market data (futures, ETF, Dragon-Tiger list, industry MA20, Finviz, etc.), backfill history, and run report vector indexing/semantic retrieval. Use when the user wants any ai-trade command: listener, market-data, portfolio, health, reports, or dynamic-topic tuning."
metadata: { "openclaw": { "emoji": "📈", "requires": { "bins": ["uv", "imsg", "python"] } } }
---

# AI Trade Skill

AI-Trade is a comprehensive financial news listener, market data fetcher, and portfolio management tool. It analyzes market events using LLMs and can push alerts via iMessage.

## ⚠️ MANDATORY INSTRUCTIONS FOR THE AGENT

**CRITICAL**: When the user asks about ANY of the following topics:

- Stock prices, K-lines (K线), or trends
- Capital flows (资金流向, 主力资金)
- Commodity futures/spot prices (商品期货, 现货, 沪金, 沪铜, etc.)
- ETF Holdings (ETF持仓)
- Dragon-Tiger lists (龙虎榜)
- Market maps / Industry strong/weak (大盘云图, 行业强弱, Finviz)
- Research reports (研究报告)
- Portfolio management / checking positions (持仓)

**YOU MUST NOT USE WEB SEARCH**. You **MUST** use the `bash` tool to run the appropriate `ai_trade.py` CLI command documented below. Always rely on the `akshare` data returned by these commands.

**CRITICAL REPORTING REQUIREMENT:** When generating your final output based on the fetched JSON data, you MUST include BOTH the **Stock Code (代码)** and the **Stock Name (股票名称)** in your explanation (e.g. "紫金矿业 (601899)"). Never output just the stock code.

**CRITICAL TOPIC-RULE REQUIREMENT:** If the task involves dynamic topic tuning in `data/config/dynamic_context_topics.json`, always include a semantic description field:

- `topic_description` (preferred)
- fallback compatibility key: `description`

This description is used to improve report vector retrieval quality.

## Commands

### 1. Market Data (行情与数据)

**First Step: Always search for the stock/security code if you don't know it:**

```bash
cd /Users/huangziquan/mac-doc/code/my/ai-trade && uv run python scripts/ai_trade.py market-data search-code 茅台
```

**Capital Flow (资金流向 - VERY IMPORTANT):**

```bash
cd /Users/huangziquan/mac-doc/code/my/ai-trade && uv run python scripts/ai_trade.py market-data capital-flow --stock-code 600519 --market sh --mode daily --limit 5
```

_(Note: Change `--market sh` to `--market sz` for Shenzhen stocks. Change `--stock-code` based on search results.)_

**Stock K-Line (股票K线 - VERY IMPORTANT):**

```bash
cd /Users/huangziquan/mac-doc/code/my/ai-trade && uv run python scripts/ai_trade.py market-data stock-kline --code 600519 --limit 10
```

**Commodity Futures / Spot (商品期货/现货):**

```bash
cd /Users/huangziquan/mac-doc/code/my/ai-trade && uv run python scripts/ai_trade.py market-data commodity-futures --symbol 沪铜 --type all
cd /Users/huangziquan/mac-doc/code/my/ai-trade && uv run python scripts/ai_trade.py market-data commodity-multi --symbols 沪铜,沪金 --type all
```

**Sector Flow (板块资金流):**

```bash
cd /Users/huangziquan/mac-doc/code/my/ai-trade && uv run python scripts/ai_trade.py market-data sector-flow --type industry --indicator 今日
```

**Market Volume (大盘成交):**

```bash
cd /Users/huangziquan/mac-doc/code/my/ai-trade && uv run python scripts/ai_trade.py market-data market-volume --market all --mode realtime
```

**Security Search (证券代码搜索):**

```bash
cd /Users/huangziquan/mac-doc/code/my/ai-trade && uv run python scripts/ai_trade.py market-data search-code 茅台
```

**Tungsten Price (钨价):**

```bash
cd /Users/huangziquan/mac-doc/code/my/ai-trade && uv run python scripts/ai_trade.py market-data tungsten-price --source quheqihuo --days 1
```

### 3. Historical Data Backfill (历史数据回补)

```bash
cd /Users/huangziquan/mac-doc/code/my/ai-trade && uv run python scripts/ai_trade.py market-data backfill-commodity-snapshots --symbol 沪锡 --days 5
cd /Users/huangziquan/mac-doc/code/my/ai-trade && DATABASE_URL="mysql://root:password@127.0.0.1:3306/ai_trade" uv run python scripts/ai_trade.py market-data backfill-cls-history --days 1 --batch-size 20
```

### 4. Portfolio Management (持仓运维)

Manage and query investment portfolios. You can execute these commands when you need to record trades or check positions:

**List Positions (查看持仓):**

```bash
cd /Users/huangziquan/mac-doc/code/my/ai-trade && DATABASE_URL="mysql://root:password@127.0.0.1:3306/ai_trade" uv run python scripts/ai_trade.py portfolio list-positions --max-positions 20
```

**Record Trade (记录交易):**

```bash
cd /Users/huangziquan/mac-doc/code/my/ai-trade && DATABASE_URL="mysql://root:password@127.0.0.1:3306/ai_trade" uv run python scripts/ai_trade.py portfolio record-trade --trade-no "T123" --account-code "A1" --broker-name "华泰" --account-display-name "主账户" --symbol "600519" --instrument-name "贵州茅台" --side BUY --traded-at "2025-02-25 10:30:00" --quantity 100 --price 1500.0
```

**Trigger Snapshot (触发快照):**

```bash
cd /Users/huangziquan/mac-doc/code/my/ai-trade && DATABASE_URL="mysql://root:password@127.0.0.1:3306/ai_trade" uv run python scripts/ai_trade.py portfolio snapshot --mode auto
```

**List Message Logs (查看推送日志):**

```bash
cd /Users/huangziquan/mac-doc/code/my/ai-trade && DATABASE_URL="mysql://root:password@127.0.0.1:3306/ai_trade" uv run python scripts/ai_trade.py portfolio list-message-logs --limit 20
```

### 5. Research Reports (研究报告)

Manage, index, and search research reports using semantic vector search:

**Import Reports (导入报告):**

```bash
cd /Users/huangziquan/mac-doc/code/my/ai-trade && DATABASE_URL="mysql://root:password@127.0.0.1:3306/ai_trade" uv run python scripts/ai_trade.py reports import --path docs/reports --recursive --tags "macro,crypto"
```

**Search Reports (语义检索):**

```bash
cd /Users/huangziquan/mac-doc/code/my/ai-trade && DATABASE_URL="mysql://root:password@127.0.0.1:3306/ai_trade" uv run python scripts/ai_trade.py reports search --query "美联储降息对有色金属的影响" --top-k 5
```

**List Reports (列出报告):**

```bash
cd /Users/huangziquan/mac-doc/code/my/ai-trade && DATABASE_URL="mysql://root:password@127.0.0.1:3306/ai_trade" uv run python scripts/ai_trade.py reports list --limit 50
```

**Reindex Reports (重建索引):**

```bash
cd /Users/huangziquan/mac-doc/code/my/ai-trade && DATABASE_URL="mysql://root:password@127.0.0.1:3306/ai_trade" uv run python scripts/ai_trade.py reports reindex --failed-only
```

**Dynamic Topic Rules (动态主题规则):**

```bash
cd /Users/huangziquan/mac-doc/code/my/ai-trade && cat data/config/dynamic_context_topics.json
```

Current dynamic topics include metal themes plus AI infra:

- `tungsten`, `lithium`, `gold`, `silver`, `tin`, `copper`
- `ai_compute` (算力 / AIDC / 推理服务)
- `backup_power` (柴油发电 / 数据中心备电)

When editing topic rules, ensure each topic carries:

- `topic_id`
- `topic_description`
- `holding_match` / `message_match`
- `report_tags`

### 6. System Health & Testing

Run health checks:

```bash
cd /Users/huangziquan/mac-doc/code/my/ai-trade && DATABASE_URL="mysql://root:password@127.0.0.1:3306/ai_trade" uv run python scripts/ai_trade.py health check
```

Run tests:

```bash
cd /Users/huangziquan/mac-doc/code/my/ai-trade && uv run pytest -q
```

## Prerequisites

- The `ai-trade` project must be available at `/Users/huangziquan/mac-doc/code/my/ai-trade`
- Needs `uv` Python package manager installed
- Needs `imsg` CLI installed (`brew install steipete/tap/imsg`)
- Database features require MySQL and the `DATABASE_URL` environment variable or `.env` configuration.
