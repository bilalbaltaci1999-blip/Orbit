import crypto from 'node:crypto';
import { GoogleGenAI } from '@google/genai';
import type Database from 'better-sqlite3';
import type { ServerBotConfig } from '../shared/types.ts';
import { getProfileByUserId } from './auth.ts';
import { hydrateChannelMessage } from './helpers.ts';
import { hasServerPermission } from './permissions.ts';
import type { OrbitRealtimeHub } from './ws.ts';

export const OFFICIAL_BOT_ID = 'bot-orbit-official';

function createGeminiClient(): GoogleGenAI | null {
  const apiKey = (process.env.APP_GEMINI_KEY || process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY' || apiKey === 'MY_APP_GEMINI_KEY') return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export async function generateChannelSummary(
  db: Database.Database,
  channelId: string,
  limit = 25
): Promise<{ ok: true; summary: string } | { ok: false; reason: string; status: number }> {
  const ai = createGeminiClient();
  if (!ai) {
    return {
      ok: false,
      status: 503,
      reason: 'Yapay zekâ özelliği için sunucuda APP_GEMINI_KEY çevre değişkeni yapılandırılmalıdır.',
    };
  }

  const rows = db
    .prepare(
      `SELECT m.content, p.display_name, m.created_at
       FROM messages m
       JOIN profiles p ON p.user_id = m.author_id
       WHERE m.channel_id = ? AND m.deleted_at IS NULL AND length(trim(m.content)) > 0
       ORDER BY m.created_at DESC
       LIMIT ?`
    )
    .all(channelId, Math.min(Math.max(limit, 5), 50)) as Array<{
    content: string;
    display_name: string;
    created_at: string;
  }>;

  if (rows.length === 0) {
    return { ok: false, status: 400, reason: 'Özetlenecek yeterli mesaj bulunmuyor.' };
  }

  const transcript = rows
    .reverse()
    .map((r) => `${r.display_name}: ${r.content.slice(0, 400)}`)
    .join('\n');

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: `Aşağıdaki topluluk kanalı sohbetini Türkçe olarak net, kısa maddeler halinde özetle. Alınan kararları, öne çıkan soruları ve önemli duyuruları belirt:\n\n${transcript}`,
      config: {
        systemInstruction:
          'Sen ORBIT topluluk platformunun yardımcı yapay zekâ asistanısın. Yalnızca verilen mesajlara dayanarak kısa ve doğru Türkçe özet çıkarırsın.',
      },
    });
    const text = (response.text || '').trim();
    if (!text) {
      return { ok: false, status: 502, reason: 'Yapay zekâ boş yanıt döndürdü.' };
    }
    return { ok: true, summary: text };
  } catch (err) {
    return {
      ok: false,
      status: 502,
      reason: err instanceof Error ? `Gemini API hatası: ${err.message}` : 'Yapay zekâ servisine ulaşılamadı.',
    };
  }
}

export async function generateOrbitAssistantReply(prompt: string, serverName: string): Promise<string> {
  const ai = createGeminiClient();
  if (!ai) {
    return 'Yapay zekâ yanıtı üretilemiyor: Sunucuda `APP_GEMINI_KEY` henüz ayarlanmamış. Yönetici `.env` veya Secrets panelinden `APP_GEMINI_KEY` ekleyerek AI yanıtlarını etkinleştirebilir.';
  }

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: prompt.slice(0, 1500),
      config: {
        systemInstruction: `Sen "${serverName}" sunucusunda çalışan resmî doğrulanmış ORBIT Botusun. Kısa, nazik, net ve Türkçe yanıt ver.`,
      },
    });
    return (response.text || 'Şu anda yanıt oluşturamadım.').trim();
  } catch (err) {
    return err instanceof Error ? `Yapay zekâ yanıt hatası: ${err.message}` : 'Yapay zekâ yanıtı alınamadı.';
  }
}

export function getOfficialBotConfig(
  db: Database.Database,
  serverId: string,
  isUserOnline: (userId: string) => boolean
): ServerBotConfig | null {
  const row = db
    .prepare(`SELECT * FROM server_bots WHERE server_id = ? AND bot_id = ?`)
    .get(serverId, OFFICIAL_BOT_ID) as
    | {
        server_id: string;
        bot_id: string;
        enabled: number;
        welcome_enabled: number;
        welcome_channel_id: string | null;
        ai_enabled: number;
        prefix: string;
      }
    | undefined;

  if (!row) return null;

  return {
    serverId: row.server_id,
    botId: row.bot_id,
    enabled: row.enabled === 1,
    welcomeEnabled: row.welcome_enabled === 1,
    welcomeChannelId: row.welcome_channel_id,
    aiEnabled: row.ai_enabled === 1,
    prefix: row.prefix || '/',
    botProfile: getProfileByUserId(db, OFFICIAL_BOT_ID, isUserOnline),
  };
}

export function installOfficialBot(
  db: Database.Database,
  hub: OrbitRealtimeHub,
  serverId: string,
  actorUserId: string
): ServerBotConfig | null {
  const firstTextChannel = db
    .prepare(`SELECT id FROM channels WHERE server_id = ? AND type IN ('text', 'announcement') ORDER BY position ASC LIMIT 1`)
    .get(serverId) as { id: string } | undefined;

  const tx = db.transaction(() => {
    db.prepare(`INSERT OR IGNORE INTO server_members (server_id, user_id) VALUES (?, ?)`).run(serverId, OFFICIAL_BOT_ID);
    db.prepare(
      `INSERT INTO server_bots (server_id, bot_id, enabled, welcome_enabled, welcome_channel_id, ai_enabled, prefix, added_by)
       VALUES (?, ?, 1, 1, ?, 1, '/', ?)
       ON CONFLICT(server_id, bot_id) DO UPDATE SET enabled = 1`
    ).run(serverId, OFFICIAL_BOT_ID, firstTextChannel?.id || null, actorUserId);
  });
  tx();

  hub.sendToRoom(`server:${serverId}`, { type: 'server:updated', payload: { serverId } });
  hub.sendToRoom(`server:${serverId}`, { type: 'member:updated', payload: { serverId } });
  return getOfficialBotConfig(db, serverId, hub.isUserOnline);
}

export function uninstallOfficialBot(db: Database.Database, hub: OrbitRealtimeHub, serverId: string): void {
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM server_bots WHERE server_id = ? AND bot_id = ?`).run(serverId, OFFICIAL_BOT_ID);
    db.prepare(`DELETE FROM server_members WHERE server_id = ? AND user_id = ?`).run(serverId, OFFICIAL_BOT_ID);
  });
  tx();

  hub.sendToRoom(`server:${serverId}`, { type: 'server:updated', payload: { serverId } });
  hub.sendToRoom(`server:${serverId}`, { type: 'member:updated', payload: { serverId } });
}

export function postBotMessage(
  db: Database.Database,
  hub: OrbitRealtimeHub,
  params: {
    channelId: string;
    content: string;
    poll?: { question: string; options: string[] };
  }
): void {
  const msgId = crypto.randomUUID();
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO messages (id, channel_id, author_id, content) VALUES (?, ?, ?, ?)`
    ).run(msgId, params.channelId, OFFICIAL_BOT_ID, params.content);

    if (params.poll) {
      const pollId = crypto.randomUUID();
      db.prepare(`INSERT INTO message_polls (id, message_id, question, allow_multiple) VALUES (?, ?, ?, 0)`).run(
        pollId,
        msgId,
        params.poll.question
      );
      const optStmt = db.prepare(`INSERT INTO message_poll_options (id, poll_id, label, position) VALUES (?, ?, ?, ?)`);
      params.poll.options.forEach((opt, idx) => {
        optStmt.run(crypto.randomUUID(), pollId, opt, idx);
      });
    }
  });
  tx();

  const hydrated = hydrateChannelMessage(db, msgId, OFFICIAL_BOT_ID, hub.isUserOnline);
  if (hydrated) {
    hub.sendToRoom(`channel:${params.channelId}`, {
      type: 'message:new',
      payload: { channelId: params.channelId, message: hydrated },
    });
  }
}

export async function handleOfficialBotMessage(
  db: Database.Database,
  hub: OrbitRealtimeHub,
  params: {
    serverId: string;
    channelId: string;
    authorId: string;
    content: string;
  }
): Promise<void> {
  if (params.authorId === OFFICIAL_BOT_ID) return;

  const botRow = db
    .prepare(`SELECT enabled, ai_enabled, prefix FROM server_bots WHERE server_id = ? AND bot_id = ?`)
    .get(params.serverId, OFFICIAL_BOT_ID) as
    | { enabled: number; ai_enabled: number; prefix: string }
    | undefined;

  if (!botRow || botRow.enabled !== 1) return;

  const trimmed = params.content.trim();
  if (!trimmed) return;

  const prefix = botRow.prefix || '/';
  const isOrbitMention = /^@orbitbot\b|^@orbit\b/i.test(trimmed);
  const hasPrefix = trimmed.startsWith(prefix);
  if (!hasPrefix && !isOrbitMention) return;

  const serverRow = db.prepare(`SELECT name FROM servers WHERE id = ?`).get(params.serverId) as
    | { name: string }
    | undefined;
  const serverName = serverRow?.name || 'Sunucu';

  if (isOrbitMention) {
    const query = trimmed.replace(/^@orbitbot\b|^@orbit\b/i, '').trim();
    if (!query) {
      postBotMessage(db, hub, {
        channelId: params.channelId,
        content: 'Merhaba! Ben **ORBIT** Resmî Botu. Komut listesi için `/yardim` yazabilirsiniz.',
      });
      return;
    }
    if (botRow.ai_enabled !== 1) {
      postBotMessage(db, hub, {
        channelId: params.channelId,
        content: 'Bu sunucuda yapay zekâ bot yanıtları Sunucu Ayarları üzerinden kapatılmış.',
      });
      return;
    }
    const reply = await generateOrbitAssistantReply(query, serverName);
    postBotMessage(db, hub, { channelId: params.channelId, content: reply });
    return;
  }

  const rawCmd = trimmed.slice(prefix.length).trim();
  const [cmdWord, ...restParts] = rawCmd.split(/\s+/);
  const cmd = (cmdWord || '').toLowerCase();
  const rest = restParts.join(' ').trim();

  if (cmd === 'yardim' || cmd === 'help') {
    postBotMessage(db, hub, {
      channelId: params.channelId,
      content: [
        '**ORBIT Resmî Bot Komutları**',
        `• \`${prefix}yardim\` — Tüm komutları listeler`,
        `• \`${prefix}sunucu\` — Sunucu istatistikleri, üye sayısı ve Boost seviyesini gösterir`,
        `• \`${prefix}anket Soru | Seçenek 1 | Seçenek 2\` — Hızlı oylama anketi oluşturur`,
        `• \`${prefix}ozet\` — Kanaldaki son mesajları AI ile özetler`,
        `• \`${prefix}ai <soru>\` veya \`@ORBIT <soru>\` — AI asistanına soru sorar`,
        `• \`${prefix}temizle <1-20>\` — Moderatörler için son mesajları toplu siler`,
      ].join('\n'),
    });
    return;
  }

  if (cmd === 'sunucu' || cmd === 'bilgi') {
    const members = (
      db.prepare(`SELECT COUNT(*) as cnt FROM server_members WHERE server_id = ?`).get(params.serverId) as { cnt: number }
    ).cnt;
    const channels = (
      db
        .prepare(`SELECT COUNT(*) as cnt FROM channels WHERE server_id = ? AND type != 'category'`)
        .get(params.serverId) as { cnt: number }
    ).cnt;
    const boosts = (
      db.prepare(`SELECT COUNT(*) as cnt FROM server_boosts WHERE server_id = ?`).get(params.serverId) as { cnt: number }
    ).cnt;
    const boostLevel = boosts >= 10 ? 3 : boosts >= 5 ? 2 : boosts >= 2 ? 1 : 0;

    postBotMessage(db, hub, {
      channelId: params.channelId,
      content: [
        `**${serverName} · Sunucu Özeti**`,
        `• Toplam Üye: **${members}**`,
        `• Aktif Kanal: **${channels}**`,
        `• Nitro Takviyesi: **${boosts}** (Seviye ${boostLevel})`,
      ].join('\n'),
    });
    return;
  }

  if (cmd === 'anket') {
    const segments = rest
      .split('|')
      .map((s) => s.trim())
      .filter(Boolean);
    if (segments.length < 3) {
      postBotMessage(db, hub, {
        channelId: params.channelId,
        content: `Kullanım: \`${prefix}anket En iyi dil hangisi? | TypeScript | Rust | Go\``,
      });
      return;
    }
    const [question, ...options] = segments;
    postBotMessage(db, hub, {
      channelId: params.channelId,
      content: '📊 **Topluluk Anketi**',
      poll: {
        question: question.slice(0, 160),
        options: options.slice(0, 6).map((o) => o.slice(0, 80)),
      },
    });
    return;
  }

  if (cmd === 'ozet') {
    if (botRow.ai_enabled !== 1) {
      postBotMessage(db, hub, {
        channelId: params.channelId,
        content: 'Bu sunucuda AI özetleme özelliği yönetici tarafından devre dışı bırakılmış.',
      });
      return;
    }
    const limit = Number(rest) || 25;
    const result = await generateChannelSummary(db, params.channelId, limit);
    if (result.ok === false) {
      postBotMessage(db, hub, { channelId: params.channelId, content: result.reason });
    } else {
      postBotMessage(db, hub, {
        channelId: params.channelId,
        content: `**Kanal Özeti**\n${result.summary}`,
      });
    }
    return;
  }

  if (cmd === 'ai') {
    if (botRow.ai_enabled !== 1) {
      postBotMessage(db, hub, {
        channelId: params.channelId,
        content: 'Bu sunucuda yapay zekâ bot yanıtları kapalı.',
      });
      return;
    }
    if (!rest) {
      postBotMessage(db, hub, {
        channelId: params.channelId,
        content: `Kullanım: \`${prefix}ai <sorunuz>\``,
      });
      return;
    }
    const reply = await generateOrbitAssistantReply(rest, serverName);
    postBotMessage(db, hub, { channelId: params.channelId, content: reply });
    return;
  }

  if (cmd === 'temizle') {
    const canDelete = hasServerPermission(db, params.serverId, params.authorId, 'DELETE_MESSAGES');
    if (!canDelete) {
      postBotMessage(db, hub, {
        channelId: params.channelId,
        content: 'Bu komutu kullanmak için **Mesajları Sil** yetkisine sahip olmalısınız.',
      });
      return;
    }
    const count = Math.min(Math.max(Number(rest) || 5, 1), 20);
    const toDelete = db
      .prepare(
        `SELECT id FROM messages WHERE channel_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT ?`
      )
      .all(params.channelId, count) as Array<{ id: string }>;

    for (const row of toDelete) {
      db.prepare(`UPDATE messages SET deleted_at = datetime('now'), content = '' WHERE id = ?`).run(row.id);
      hub.sendToRoom(`channel:${params.channelId}`, {
        type: 'message:deleted',
        payload: { channelId: params.channelId, messageId: row.id },
      });
    }
    postBotMessage(db, hub, {
      channelId: params.channelId,
      content: `🧹 Son **${toDelete.length}** mesaj moderasyon kapsamında temizlendi.`,
    });
  }
}
