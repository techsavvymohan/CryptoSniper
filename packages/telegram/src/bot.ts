import TelegramBot, { InlineKeyboardMarkup } from 'node-telegram-bot-api';
import Redis from 'ioredis';
import { WalletManager, RiskEngine } from '@mev-research/execution';
import { ExecutionRepository } from '@mev-research/database';

type BotAction = 'wallet' | 'orders' | 'pnl' | 'alerts' | 'kill' | 'resume' | 'menu' | 'status';

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
    redisUrl: string
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

/wallet /orders /pnl /alerts
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
    subscriber.subscribe('mev:opportunities');

    subscriber.on('message', (_channel: string, message: string) => {
      try {
        const event = JSON.parse(message);
        this.handleExecutionEvent(event);
      } catch {
        // Malformed message — ignore
      }
    });
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
