import TelegramBot, { InlineKeyboardMarkup } from 'node-telegram-bot-api';
import Redis from 'ioredis';
import { WalletManager, RiskEngine } from '@mev-research/execution';
import { ExecutionRepository, GodfatherRepository } from '@mev-research/database';
import type { GodfatherTrade } from '@mev-research/shared';

type BotAction = 'wallet' | 'orders' | 'pnl' | 'alerts' | 'kill' | 'resume' | 'menu' | 'status' | 'godfather';

export class TelegramAlertBot {
  private bot: TelegramBot;
  private redis: Redis;
  private adminChatIds: Set<string>;
  private alertEnabledChats: Set<string> = new Set();

  constructor(
    token: string,
    private walletManager: WalletManager,
    private riskEngine: RiskEngine,
    private executionRepo: ExecutionRepository,
    redisUrl: string,
    private godfatherRepo?: GodfatherRepository,
  ) {
    this.bot = new TelegramBot(token, { polling: true });
    this.redis = new Redis(redisUrl);
    const raw = process.env.TELEGRAM_ADMIN_CHAT_ID || '';
    this.adminChatIds = new Set(
      raw.split(/[,|]/).map(s => s.trim()).filter(Boolean),
    );

    this.setupCommands();
    this.setupCallbacks();
    this.setupEventListeners();
    console.log('[Telegram] Bot polling started');
  }

  private isAdmin(chatId: string | number): boolean {
    return this.adminChatIds.has(String(chatId));
  }

  private mainMenuKeyboard(chatId: string | number): InlineKeyboardMarkup {
    const row1 = [
      { text: '💳 Wallet', callback_data: 'action:wallet' },
      { text: '📋 Orders', callback_data: 'action:orders' },
    ];
    const row2 = [
      { text: '💰 P&L', callback_data: 'action:pnl' },
      { text: '📊 Status', callback_data: 'action:status' },
      { text: '🎩 Godfather', callback_data: 'action:godfather' },
    ];
    const row3 = [
      { text: '🔔 Alerts', callback_data: 'action:alerts' },
      { text: '🏠 Menu', callback_data: 'action:menu' },
    ];
    const rows = [row1, row2, row3];

    if (this.isAdmin(chatId)) {
      rows.push([
        { text: '⛔ Kill Switch', callback_data: 'action:kill' },
        { text: '▶️ Resume', callback_data: 'action:resume' },
      ]);
    }

    return { inline_keyboard: rows };
  }

  private async sendMenu(chatId: number) {
    const simulation = process.env.SIMULATION_MODE === 'true';
    const text = `🤖 *MEV Research Bot*

Mode: ${simulation ? '🔵 SIMULATION' : '🔴 LIVE'}
Tap a button below or use commands.

/wallet /orders /pnl /godfather /alerts
${this.isAdmin(chatId) ? '/kill /resume (admin)' : ''}`;

    await this.bot.sendMessage(chatId, text, {
      parse_mode: 'Markdown',
      reply_markup: this.mainMenuKeyboard(chatId),
    });
  }

  private setupCommands() {
    this.bot.onText(/\/start/, (msg) => {
      this.sendMenu(msg.chat.id).catch(() => {});
    });

    this.bot.onText(/\/help/, (msg) => {
      this.sendMenu(msg.chat.id).catch(() => {});
    });

    this.bot.onText(/\/wallet/, (msg) => {
      this.handleWallet(msg.chat.id).catch(() => {});
    });

    this.bot.onText(/\/orders/, (msg) => {
      this.handleOrders(msg.chat.id).catch(() => {});
    });

    this.bot.onText(/\/pnl/, (msg) => {
      this.handlePnl(msg.chat.id).catch(() => {});
    });

    this.bot.onText(/\/godfather/, (msg) => {
      this.handleGodfather(msg.chat.id).catch(() => {});
    });

    this.bot.onText(/\/kill/, (msg) => {
      this.handleKill(msg.chat.id).catch(() => {});
    });

    this.bot.onText(/\/resume/, (msg) => {
      this.handleResume(msg.chat.id).catch(() => {});
    });

    this.bot.onText(/\/alerts/, (msg) => {
      this.handleAlerts(msg.chat.id).catch(() => {});
    });
  }

  private setupCallbacks() {
    this.bot.on('callback_query', async (query) => {
      const chatId = query.message?.chat.id;
      const data = query.data;
      if (!chatId || !data?.startsWith('action:')) return;

      const action = data.replace('action:', '') as BotAction;

      try {
        await this.bot.answerCallbackQuery(query.id);

        switch (action) {
          case 'wallet':
            await this.handleWallet(chatId);
            break;
          case 'orders':
            await this.handleOrders(chatId);
            break;
          case 'pnl':
            await this.handlePnl(chatId);
            break;
          case 'godfather':
            await this.handleGodfather(chatId);
            break;
          case 'alerts':
            await this.handleAlerts(chatId);
            break;
          case 'status':
            await this.handleStatus(chatId);
            break;
          case 'kill':
            await this.handleKill(chatId);
            break;
          case 'resume':
            await this.handleResume(chatId);
            break;
          case 'menu':
            await this.sendMenu(chatId);
            break;
        }
      } catch {
        await this.bot.answerCallbackQuery(query.id, { text: 'Something went wrong' }).catch(() => {});
      }
    });
  }

  private async replyWithKeyboard(chatId: number, text: string) {
    await this.bot.sendMessage(chatId, text, {
      parse_mode: 'Markdown',
      reply_markup: this.mainMenuKeyboard(chatId),
    });
  }

  private async handleWallet(chatId: number) {
    const state = this.walletManager.getCurrentState();
    const address = this.walletManager.getPublicKey().toBase58();
    const shortAddress = `${address.slice(0, 4)}...${address.slice(-4)}`;
    const daily = await this.executionRepo.getDailyStats(new Date());

    const text = `💳 *Wallet Status*
Address: \`${shortAddress}\`
SOL: \`${state.solBalance.toFixed(4)}\` SOL
USDC: \`$${state.usdcBalance.toLocaleString()}\`
Daily P&L: \`$${daily.netProfitUsdc.toFixed(2)}\``;

    await this.replyWithKeyboard(chatId, text);
  }

  private async handleOrders(chatId: number) {
    const orders = await this.executionRepo.getRecentOrders(5);
    let text = `📋 *Recent Orders*\n`;

    if (orders.length === 0) {
      text += '_No recent orders found._';
    } else {
      orders.forEach((o: { status: string; opportunity?: { pair?: string; buyDex?: string; sellDex?: string }; netProfitUsd?: number }) => {
        const statusIcon = o.status === 'landed' ? '✅' : o.status === 'failed' ? '❌' : '⏳';
        text += `${statusIcon} ${o.opportunity?.pair || 'SOL/USDC'} | ${o.opportunity?.buyDex}→${o.opportunity?.sellDex} | ${o.status} | $${o.netProfitUsd?.toFixed(2) || '0.00'}\n`;
      });
    }

    await this.replyWithKeyboard(chatId, text);
  }

  private async handlePnl(chatId: number) {
    const stats = await this.executionRepo.getDailyStats(new Date());
    const recent = await this.executionRepo.getRecentOrders(50);
    const wins = recent.filter(o => o.status === 'landed').length;
    const winRate = recent.length > 0 ? (wins / recent.length) * 100 : 0;

    const text = `💰 *Live P&L Summary*
Today: \`$${stats.netProfitUsdc.toFixed(2)}\`
Win Rate: \`${winRate.toFixed(1)}%\`
Total Orders (Recent): \`${recent.length}\``;

    await this.replyWithKeyboard(chatId, text);
  }

  private async handleStatus(chatId: number) {
    const simulation = process.env.SIMULATION_MODE === 'true';
    const state = this.walletManager.getCurrentState();

    const text = `📊 *Bot Status*
Mode: \`${simulation ? 'SIMULATION' : 'LIVE'}\`
SOL: \`${state.solBalance.toFixed(4)}\`
USDC: \`$${state.usdcBalance.toLocaleString()}\`
Alerts: \`${this.alertEnabledChats.has(String(chatId)) ? 'ON' : 'OFF'}\``;

    await this.replyWithKeyboard(chatId, text);
  }

  private async handleGodfather(chatId: number) {
    try {
      let openTrades: GodfatherTrade[] = [];
      let dailyPnl = 0;

      if (this.godfatherRepo) {
        openTrades = await this.godfatherRepo.getOpenTrades();
        dailyPnl = await this.godfatherRepo.getDailyPnl(new Date());
      } else {
        const port = process.env.API_PORT || '3001';
        const res = await fetch(`http://127.0.0.1:${port}/api/v1/godfather/status`);
        if (res.ok) {
          const data: any = await res.json();
          openTrades = data.openTrades || [];
          dailyPnl = data.dailyPnlUsd || 0;
        }
      }

      let text = `🎩 *GODFATHER SMC Directional Positions*\n`;
      text += `Today's Realized PnL: *${dailyPnl >= 0 ? '+' : ''}$${dailyPnl.toFixed(2)} USDC*\n`;
      text += `Active Positions: *${openTrades.length}*\n\n`;

      if (openTrades.length === 0) {
        text += `_No active Godfather positions currently open._\n`;
        text += `Scanning M1/M15 order flow on BTC & SOL...`;
      } else {
        for (const t of openTrades) {
          const dirIcon = t.direction === 'BUY' ? '🟢 LONG' : '🔴 SHORT';
          const beStatus = t.isBreakevenLocked ? '🔒 LOCKED' : '⏳ ACTIVE';
          text += `*${t.symbol}* (${dirIcon})\n`;
          text += `• Entry: \`$${Number(t.entryPrice).toFixed(2)}\`\n`;
          text += `• Stop Loss: \`$${Number(t.stopLoss).toFixed(2)}\` (BE: ${beStatus})\n`;
          text += `• Total Size: \`${t.totalSize}\` (Remaining: \`${t.remainingSize}\`)\n`;

          if (t.tranches && t.tranches.length > 0) {
            text += `• *Tranches:*\n`;
            for (const tr of t.tranches) {
              const trIcon = tr.status === 'TAKEN' ? '✅' : (tr.status === 'CANCELLED' || tr.status === 'STOPPED_OUT') ? '❌' : '⏳';
              const targetStr = tr.targetPrice ? `$${Number(tr.targetPrice).toFixed(2)}` : 'Chandelier ATR';
              const trailStr = tr.trailingStop ? ` [Trail: $${Number(tr.trailingStop).toFixed(2)}]` : '';
              text += `  ${trIcon} T${tr.trancheNumber}: ${targetStr}${trailStr} (${(tr.volumeFraction * 100).toFixed(0)}%)\n`;
            }
          }
          text += `\n`;
        }
      }

      await this.replyWithKeyboard(chatId, text);
    } catch (err: any) {
      await this.replyWithKeyboard(chatId, `⚠️ Failed to fetch Godfather status: ${err.message}`);
    }
  }

  private async handleKill(chatId: number) {
    if (!this.isAdmin(chatId)) {
      await this.bot.sendMessage(chatId, '🚫 Unauthorized.', {
        reply_markup: this.mainMenuKeyboard(chatId),
      });
      return;
    }

    await this.riskEngine.triggerKillSwitch('telegram-manual');
    await this.replyWithKeyboard(chatId, '⛔ *Kill switch activated.* All trading paused for 1 hour.');
  }

  private async handleResume(chatId: number) {
    if (!this.isAdmin(chatId)) {
      await this.bot.sendMessage(chatId, '🚫 Unauthorized.', {
        reply_markup: this.mainMenuKeyboard(chatId),
      });
      return;
    }

    await this.riskEngine.releaseKillSwitch();
    await this.replyWithKeyboard(chatId, '▶️ *Kill switch released.* Trading resumed.');
  }

  private async handleAlerts(chatId: number) {
    this.alertEnabledChats.add(String(chatId));
    await this.replyWithKeyboard(chatId, '🔔 *Alerts enabled* for this chat. You will receive trade notifications.');
  }

  private setupEventListeners() {
    const subscriber = this.redis.duplicate();
    subscriber.subscribe('mev:opportunities', 'godfather:signals', 'godfather:trades');

    subscriber.on('message', (channel: string, message: string) => {
      try {
        const event = JSON.parse(message);
        if (channel === 'godfather:signals') {
          this.handleGodfatherSignal(event);
        } else if (channel === 'godfather:trades') {
          this.handleGodfatherTrade(event);
        } else {
          this.handleExecutionEvent(event);
        }
      } catch {
        // Malformed message — ignore
      }
    });
  }

  private handleGodfatherSignal(event: { type?: string; payload?: any } | any) {
    const signal = event.payload || event;
    const gradeEmoji = signal.grade === 'A_PLUS' ? '🦄 *A+ UNICORN*' : '⭐ *GRADE A*';
    const dirEmoji = signal.direction === 'BUY' ? '🟢 LONG' : '🔴 SHORT';
    const text = `🎩 *GODFATHER SETUP DETECTED*
Setup: ${gradeEmoji}
Asset: \`${signal.symbol}\` | ${dirEmoji}
Entry: \`$${Number(signal.entryPrice).toFixed(2)}\`
Stop Loss: \`$${Number(signal.stopLoss).toFixed(2)}\`
Allocated Risk: \`$${Number(signal.allocatedRiskUsd).toFixed(2)}\`
Position Size: \`${Number(signal.positionSize).toFixed(4)}\`
Session: \`${signal.session}\``;

    this.broadcast(text);
  }

  private handleGodfatherTrade(event: { type: string; payload: any }) {
    const { type, payload } = event;
    if (type === 'TRANCHE_EXIT') {
      const { trade, result } = payload;
      const text = `🎯 *GODFATHER TRANCHE UPDATE*
Asset: \`${trade.symbol}\` (${trade.direction})
Action: *${result.action}*
Note: ${result.message || ''}
Realized PnL: *+$${Number(result.realizedPnlDeltaUsd).toFixed(2)} USDC*
Remaining Size: \`${Number(trade.remainingSize).toFixed(4)}\``;

      this.broadcast(text);
    } else if (type === 'TRADE_CLOSED') {
      const trade = payload;
      const pnl = Number(trade.realizedPnlUsd);
      const icon = pnl >= 0 ? '🏆' : '🛑';
      const text = `${icon} *GODFATHER TRADE CLOSED*
Asset: \`${trade.symbol}\` (${trade.direction})
Exit Reason: \`${trade.exitReason || 'CLOSED'}\`
Final Realized PnL: *${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} USDC*`;

      this.broadcast(text);
    }
  }

  private handleExecutionEvent(event: { type: string; payload: Record<string, unknown> }) {
    const { type, payload } = event;

    if (type === 'ORDER_LANDED') {
      const opp = payload.opportunity as { pair?: string; buyDex?: string; sellDex?: string } | undefined;
      const text = `✅ *TRADE LANDED*
Pair: ${opp?.pair || 'SOL/USDC'}
Route: ${opp?.buyDex} → ${opp?.sellDex}
Profit: *$${Number(payload.netProfitUsd ?? 0).toFixed(4)} USDC*
Tip paid: ${Number(payload.tipLamports ?? 0) / 1e9} SOL`;

      this.broadcast(text);
    } else if (type === 'ORDER_FAILED') {
      const opp = payload.opportunity as { pair?: string } | undefined;
      const text = `❌ *TRADE FAILED*
Reason: \`${payload.failureReason}\`
Opportunity: ${opp?.pair || 'N/A'}`;

      this.sendToAdmin(text);
    } else if (type === 'KILL_SWITCH_TRIGGERED') {
      const text = `🚨 *KILL SWITCH TRIGGERED*
Reason: \`${payload.reason}\`
All trading halted.`;

      this.sendToAdmin(text);
    }
  }

  private broadcast(text: string) {
    this.alertEnabledChats.forEach(chatId => {
      this.bot.sendMessage(chatId, text, { parse_mode: 'Markdown' }).catch(() => {});
    });
    this.sendToAdmin(text);
  }

  private sendToAdmin(text: string) {
    this.adminChatIds.forEach(chatId => {
      this.bot.sendMessage(chatId, text, { parse_mode: 'Markdown' }).catch(() => {});
    });
  }
}
