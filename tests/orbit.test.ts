import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { createOrbitServer } from '../src/server/app.ts';
import { generateTotpCode } from '../src/server/totp.ts';

function startTestServer() {
  const tempDb = path.join(os.tmpdir(), `orbit-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const ctx = createOrbitServer(tempDb);
  return new Promise<{
    baseUrl: string;
    wsUrl: string;
    close: () => Promise<void>;
  }>((resolve) => {
    ctx.httpServer.listen(0, '127.0.0.1', () => {
      const addr = ctx.httpServer.address();
      if (!addr || typeof addr === 'string') throw new Error('Invalid address');
      resolve({
        baseUrl: `http://127.0.0.1:${addr.port}/api`,
        wsUrl: `ws://127.0.0.1:${addr.port}/ws`,
        close: () =>
          new Promise<void>((res) => {
            ctx.hub.close();
            ctx.httpServer.close(() => {
              ctx.db.close();
              if (fs.existsSync(tempDb)) fs.unlinkSync(tempDb);
              res();
            });
          }),
      });
    });
  });
}

async function api(baseUrl: string, pathUrl: string, options: RequestInit = {}, token?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const resp = await fetch(`${baseUrl}${pathUrl}`, { ...options, headers });
  const json = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: resp.status, data: json };
}

test('ORBIT full-stack auth, RBAC, private channel isolation, invite, DM, and real-time WS delivery', async () => {
  const srv = await startTestServer();
  try {
    // 1. Register two real users
    const u1 = await api(srv.baseUrl, '/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        email: 'alice@example.com',
        username: 'alice_dev',
        displayName: 'Alice',
        password: 'Password123!',
      }),
    });
    assert.equal(u1.status, 201);
    const aliceToken = String(u1.data.token);

    const u2 = await api(srv.baseUrl, '/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        email: 'bob@example.com',
        username: 'bob_ops',
        displayName: 'Bob',
        password: 'Password123!',
      }),
    });
    assert.equal(u2.status, 201);
    const bobToken = String(u2.data.token);
    const bobProfile = u2.data.profile as { userId: string };

    // 2. Duplicate username rejected
    const dup = await api(srv.baseUrl, '/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        email: 'alice2@example.com',
        username: 'alice_dev',
        displayName: 'Alice 2',
        password: 'Password123!',
      }),
    });
    assert.equal(dup.status, 409);

    // 3. Alice creates a server
    const createdSrv = await api(
      srv.baseUrl,
      '/servers',
      {
        method: 'POST',
        body: JSON.stringify({ name: 'ORBIT Core', description: 'Test server', isDiscoverable: false }),
      },
      aliceToken
    );
    assert.equal(createdSrv.status, 201);
    const serverId = (createdSrv.data.server as { id: string }).id;
    const defaultChannelId = String(createdSrv.data.defaultChannelId);

    // 4. Alice creates a PRIVATE channel
    const privCh = await api(
      srv.baseUrl,
      `/servers/${serverId}/channels`,
      {
        method: 'POST',
        body: JSON.stringify({
          name: 'gizli-yonetim',
          type: 'text',
          isPrivate: true,
        }),
      },
      aliceToken
    );
    assert.equal(privCh.status, 201);
    const privateChannelId = String(privCh.data.channelId);

    // Alice sends a secret message in the private channel
    const secretMsg = await api(
      srv.baseUrl,
      `/channels/${privateChannelId}/messages`,
      {
        method: 'POST',
        body: JSON.stringify({ content: 'SECRET_OPERATIONS_TOKEN_991' }),
      },
      aliceToken
    );
    assert.equal(secretMsg.status, 201);

    // 5. Alice creates an invite link (maxUses = 1) and Bob joins
    const inv = await api(
      srv.baseUrl,
      `/servers/${serverId}/invites`,
      { method: 'POST', body: JSON.stringify({ maxUses: 1, expiresInHours: 24 }) },
      aliceToken
    );
    assert.equal(inv.status, 201);
    const inviteCode = (inv.data.invite as { code: string }).code;

    const joinRes = await api(srv.baseUrl, `/invites/${inviteCode}/join`, { method: 'POST' }, bobToken);
    assert.equal(joinRes.status, 200);

    // 6. SECURITY CHECK: Bob CANNOT read private channel messages or find them in search!
    const bobPrivRead = await api(srv.baseUrl, `/channels/${privateChannelId}/messages`, {}, bobToken);
    assert.equal(bobPrivRead.status, 403);

    const bobSearch = await api(srv.baseUrl, `/search?q=SECRET_OPERATIONS_TOKEN_991`, {}, bobToken);
    assert.equal(bobSearch.status, 200);
    assert.equal((bobSearch.data.messages as unknown[]).length, 0);

    // 7. REAL-TIME WS CHECK: Both connect via WebSocket and Bob receives Alice's message in real time
    const wsAlice = new WebSocket(`${srv.wsUrl}?token=${encodeURIComponent(aliceToken)}`);
    const wsBob = new WebSocket(`${srv.wsUrl}?token=${encodeURIComponent(bobToken)}`);

    await Promise.all([
      new Promise<void>((res) => wsAlice.once('open', () => res())),
      new Promise<void>((res) => wsBob.once('open', () => res())),
    ]);

    wsBob.send(JSON.stringify({ type: 'room:subscribe', payload: { room: `channel:${defaultChannelId}` } }));
    await new Promise((r) => setTimeout(r, 80));

    const receivedPromise = new Promise<string>((resolve) => {
      wsBob.on('message', (raw) => {
        const ev = JSON.parse(raw.toString()) as { type: string; payload: { message?: { content: string } } };
        if (ev.type === 'message:new' && ev.payload.message) {
          resolve(ev.payload.message.content);
        }
      });
    });

    const msgRes = await api(
      srv.baseUrl,
      `/channels/${defaultChannelId}/messages`,
      {
        method: 'POST',
        body: JSON.stringify({ content: 'Merhaba Bob!', clientNonce: 'nonce-123' }),
      },
      aliceToken
    );
    assert.equal(msgRes.status, 201);

    // Duplicate nonce idempotency check
    const msgDup = await api(
      srv.baseUrl,
      `/channels/${defaultChannelId}/messages`,
      {
        method: 'POST',
        body: JSON.stringify({ content: 'Merhaba Bob!', clientNonce: 'nonce-123' }),
      },
      aliceToken
    );
    assert.equal((msgDup.data.message as { id: string }).id, (msgRes.data.message as { id: string }).id);

    const receivedText = await receivedPromise;
    assert.equal(receivedText, 'Merhaba Bob!');

    // 8. Friendship, Blocking, and DM restriction check
    const fr = await api(
      srv.baseUrl,
      '/friends/request',
      { method: 'POST', body: JSON.stringify({ usernameOrId: 'bob_ops' }) },
      aliceToken
    );
    assert.equal(fr.status, 201);

    await api(srv.baseUrl, '/blocks', { method: 'POST', body: JSON.stringify({ userId: bobProfile.userId }) }, aliceToken);
    const blockedDm = await api(
      srv.baseUrl,
      '/dm/conversations',
      { method: 'POST', body: JSON.stringify({ participantIds: [bobProfile.userId] }) },
      aliceToken
    );
    assert.equal(blockedDm.status, 403);

    // 9. Badges & profile bannerColor customization check
    // Send 1 more message so Alice reaches >= 3 messages (1 in private + 2 in default) -> active_communicator
    await api(
      srv.baseUrl,
      `/channels/${defaultChannelId}/messages`,
      { method: 'POST', body: JSON.stringify({ content: 'Üçüncü mesaj rozet testi' }) },
      aliceToken
    );

    const patchBanner = await api(
      srv.baseUrl,
      '/users/me/profile',
      { method: 'PATCH', body: JSON.stringify({ bannerColor: '#E11D48' }) },
      aliceToken
    );
    assert.equal(patchBanner.status, 200);
    const updatedAlice = patchBanner.data.profile as {
      bannerColor: string;
      badges: Array<{ key: string }>;
    };
    assert.equal(updatedAlice.bannerColor, '#E11D48');
    const badgeKeys = updatedAlice.badges.map((b) => b.key);
    assert.ok(badgeKeys.includes('early_pioneer'));
    assert.ok(badgeKeys.includes('community_founder'));
    assert.ok(badgeKeys.includes('active_communicator'));

    await Promise.all([
      new Promise<void>((res) => {
        wsAlice.once('close', () => res());
        wsAlice.close();
      }),
      new Promise<void>((res) => {
        wsBob.once('close', () => res());
        wsBob.close();
      }),
    ]);

    // 10. Dedicated Founder Account (bilalbaltaci1999@gmail.com) lifecycle & starter server check
    const fStatus = await api(srv.baseUrl, '/auth/founder-status');
    assert.equal(fStatus.status, 200);
    assert.equal(fStatus.data.needsActivation, true);

    const fEarlyLogin = await api(srv.baseUrl, '/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'bilalbaltaci1999@gmail.com', password: 'SomePassword123!' }),
    });
    assert.equal(fEarlyLogin.status, 409);
    assert.equal(fEarlyLogin.data.needsFounderActivation, true);

    const fActivate = await api(srv.baseUrl, '/auth/activate-founder', {
      method: 'POST',
      body: JSON.stringify({
        email: 'bilalbaltaci1999@gmail.com',
        password: 'FounderSecurePassword123!',
        displayName: 'Bilal (Kurucu)',
      }),
    });
    assert.equal(fActivate.status, 200);
    const founderToken = String(fActivate.data.token);
    const founderProfile = fActivate.data.profile as {
      isFounder?: boolean;
      emailVerified?: boolean;
      badges: Array<{ key: string }>;
    };
    assert.equal(founderProfile.isFounder, true);
    assert.equal(founderProfile.emailVerified, true);
    assert.ok(founderProfile.badges.some((b) => b.key === 'platform_founder'));

    // Cannot re-activate founder once claimed
    const fReclaim = await api(srv.baseUrl, '/auth/activate-founder', {
      method: 'POST',
      body: JSON.stringify({
        email: 'bilalbaltaci1999@gmail.com',
        password: 'HijackPassword123!',
      }),
    });
    assert.equal(fReclaim.status, 409);

    // Founder's starter server + voice session joinedAt check
    const fServers = await api(srv.baseUrl, '/servers', {}, founderToken);
    assert.equal(fServers.status, 200);
    const starterList = fServers.data.servers as Array<{ id: string; name: string }>;
    assert.ok(starterList.some((s) => s.id === 'srv-orbit-official'));

    const voiceJoin = await api(
      srv.baseUrl,
      '/channels/ch-orbit-ses/voice/join',
      { method: 'POST', body: JSON.stringify({ muted: false, deafened: false }) },
      founderToken
    );
    assert.equal(voiceJoin.status, 200);

    const srvDetail = await api(srv.baseUrl, '/servers/srv-orbit-official', {}, founderToken);
    assert.equal(srvDetail.status, 200);
    const vpMap = srvDetail.data.voiceParticipantsByChannel as Record<string, Array<{ userId: string; joinedAt?: string }>>;
    assert.ok(vpMap['ch-orbit-ses']?.[0]?.joinedAt);

    // 11. Orbit Üyesi (İlk 100) rozeti + Rozet İstatistikleri + Genişletilmiş Profil + Anket Testi
    assert.ok(founderProfile.badges.some((b) => b.key === 'orbit_member'));
    const statsRes = await api(srv.baseUrl, '/badges/stats');
    assert.equal(statsRes.status, 200);
    assert.equal(statsRes.data.orbitMemberCap, 100);
    assert.equal(statsRes.data.orbitMemberCount, 3); // founder + alice + bob
    const badgesMap = statsRes.data.badges as Record<string, { count: number; percentage: number }>;
    assert.equal(badgesMap.orbit_member.count, 3);
    assert.equal(badgesMap.platform_founder.count, 1);

    const extProfileRes = await api(
      srv.baseUrl,
      '/users/me/profile',
      {
        method: 'PATCH',
        body: JSON.stringify({
          avatarFrame: 'amber',
          pronouns: 'kurucu',
          websiteUrl: 'https://orbit.chat',
          activityType: 'coding',
          activityText: 'ORBIT v4 geliştiriliyor',
          featuredBadge: 'orbit_member',
        }),
      },
      founderToken
    );
    assert.equal(extProfileRes.status, 200);
    const updatedFounder = extProfileRes.data.profile as {
      avatarFrame: string;
      pronouns: string;
      websiteUrl: string;
      activityType: string;
      activityText: string;
      featuredBadge: string | null;
    };
    assert.equal(updatedFounder.avatarFrame, 'amber');
    assert.equal(updatedFounder.pronouns, 'kurucu');
    assert.equal(updatedFounder.websiteUrl, 'https://orbit.chat');
    assert.equal(updatedFounder.activityType, 'coding');
    assert.equal(updatedFounder.activityText, 'ORBIT v4 geliştiriliyor');
    assert.equal(updatedFounder.featuredBadge, 'orbit_member');

    const delAvatarRes = await api(srv.baseUrl, '/users/me/avatar', { method: 'DELETE' }, founderToken);
    assert.equal(delAvatarRes.status, 200);

    // Channel Poll creation & voting + WS broadcast
    const wsFounder = new WebSocket(`${srv.wsUrl}?token=${encodeURIComponent(founderToken)}`);
    await new Promise<void>((res) => wsFounder.once('open', () => res()));
    wsFounder.send(JSON.stringify({ type: 'room:subscribe', payload: { room: 'channel:ch-orbit-genel' } }));
    await new Promise((r) => setTimeout(r, 60));

    const pollMsgRes = await api(
      srv.baseUrl,
      '/channels/ch-orbit-genel/messages',
      {
        method: 'POST',
        body: JSON.stringify({
          content: 'Yeni tema oylaması',
          poll: {
            question: 'Hangi temayı tercih edersiniz?',
            options: ['Koyu Uzay', 'Açık Bulut'],
            allowMultiple: false,
          },
        }),
      },
      founderToken
    );
    assert.equal(pollMsgRes.status, 201);
    const createdPoll = (pollMsgRes.data.message as { poll: { id: string; options: Array<{ id: string }> } }).poll;
    assert.ok(createdPoll?.id);

    const pollUpdatePromise = new Promise<number>((resolve) => {
      wsFounder.on('message', (raw) => {
        const ev = JSON.parse(raw.toString()) as {
          type: string;
          payload: { message?: { poll?: { totalVotes: number } } };
        };
        if (ev.type === 'message:updated' && ev.payload.message?.poll) {
          resolve(ev.payload.message.poll.totalVotes);
        }
      });
    });

    const voteRes = await api(
      srv.baseUrl,
      `/channels/ch-orbit-genel/polls/${createdPoll.id}/vote`,
      {
        method: 'POST',
        body: JSON.stringify({ optionId: createdPoll.options[0].id }),
      },
      founderToken
    );
    assert.equal(voteRes.status, 200);
    const wsTotalVotes = await pollUpdatePromise;
    assert.equal(wsTotalVotes, 1);

    // 12. Permanent #0000 Discriminator Tags, Friend by Tag, Nicknames, 5 New Badges & Webhooks
    const founderFull = fActivate.data.profile as { userId: string; username: string; discriminator: string; badges: Array<{ key: string }> };
    assert.equal(founderFull.discriminator, '0001');
    assert.ok(founderFull.badges.some((b) => b.key === 'orbit_staff'));
    assert.ok(founderFull.badges.some((b) => b.key === 'orbit_partner'));
    assert.ok(founderFull.badges.some((b) => b.key === 'orbit_moderator'));

    const bobFull = u2.data.profile as { userId: string; username: string; discriminator: string };
    assert.match(bobFull.discriminator, /^\d{4}$/);

    // Friend request by username#discriminator
    const founderFriendReq = await api(
      srv.baseUrl,
      '/friends/request',
      { method: 'POST', body: JSON.stringify({ usernameOrId: `${bobFull.username}#${bobFull.discriminator}` }) },
      founderToken
    );
    assert.equal(founderFriendReq.status, 201);

    // Non-founder cannot call /badges/assign
    const nonFounderBadge = await api(
      srv.baseUrl,
      '/badges/assign',
      { method: 'POST', body: JSON.stringify({ userId: bobFull.userId, badgeKey: 'orbit_staff' }) },
      aliceToken
    );
    assert.equal(nonFounderBadge.status, 403);

    // Founder assigns & revokes badge
    const founderAssign = await api(
      srv.baseUrl,
      '/badges/assign',
      { method: 'POST', body: JSON.stringify({ userId: bobFull.userId, badgeKey: 'bug_hunter' }) },
      founderToken
    );
    assert.equal(founderAssign.status, 200);
    assert.ok((founderAssign.data.profile as { badges: Array<{ key: string }> }).badges.some((b) => b.key === 'bug_hunter'));

    // Auto-grant bug_hunter via report & bot_developer via webhook creation + execution
    const aliceReport = await api(
      srv.baseUrl,
      '/reports',
      {
        method: 'POST',
        body: JSON.stringify({ targetType: 'message', targetId: createdPoll.id, reason: 'Otomatik rozet testi raporu' }),
      },
      aliceToken
    );
    assert.equal(aliceReport.status, 201);

    // Server nickname update
    const nickRes = await api(
      srv.baseUrl,
      `/servers/${serverId}/members/${bobFull.userId}/nickname`,
      { method: 'PATCH', body: JSON.stringify({ nickname: 'Bob Komutan' }) },
      aliceToken
    );
    assert.equal(nickRes.status, 200);
    assert.equal(nickRes.data.nickname, 'Bob Komutan');

    // Server Webhook creation & public bot message delivery
    const whCreate = await api(
      srv.baseUrl,
      `/servers/${serverId}/webhooks`,
      { method: 'POST', body: JSON.stringify({ name: 'ORBIT Duyuru Botu', channelId: defaultChannelId }) },
      aliceToken
    );
    assert.equal(whCreate.status, 201);
    const createdWh = whCreate.data.webhook as { id: string; token: string };

    const whExec = await api(srv.baseUrl, `/webhooks/${createdWh.id}/${createdWh.token}`, {
      method: 'POST',
      body: JSON.stringify({ content: 'Bot entegrasyon testi başarılı!' }),
    });
    assert.equal(whExec.status, 201);
    assert.equal((whExec.data.message as { webhookName?: string }).webhookName, 'ORBIT Duyuru Botu');

    // Verify Alice received bug_hunter_silver + bot_developer auto badges
    const aliceMe = await api(srv.baseUrl, '/auth/me', {}, aliceToken);
    assert.equal(aliceMe.status, 200);
    const aliceBadges = (aliceMe.data.profile as { badges: Array<{ key: string }> }).badges.map((b) => b.key);
    assert.ok(aliceBadges.includes('bug_hunter_silver'));
    assert.ok(aliceBadges.includes('bot_developer'));

    // 13. Security & Performance Checks: SSRF guard, Sessions, Password Change, Reply isolation, 6-option poll, WS voice:signal auth
    // SSRF Guard on /link-preview
    const ssrfLocal = await api(
      srv.baseUrl,
      `/link-preview?url=${encodeURIComponent('http://127.0.0.1:3000/api/health')}`,
      {},
      aliceToken
    );
    assert.equal(ssrfLocal.status, 400);

    const ssrfV6 = await api(
      srv.baseUrl,
      `/link-preview?url=${encodeURIComponent('http://[::1]:3000/')}`,
      {},
      aliceToken
    );
    assert.equal(ssrfV6.status, 400);

    // Reply-to cross-channel isolation
    const crossReplyRes = await api(
      srv.baseUrl,
      `/channels/${defaultChannelId}/messages`,
      {
        method: 'POST',
        body: JSON.stringify({
          content: 'Başka kanaldan reply testi',
          replyToId: (secretMsg.data.message as { id: string }).id,
        }),
      },
      aliceToken
    );
    assert.equal(crossReplyRes.status, 201);
    assert.equal((crossReplyRes.data.message as { replyTo: unknown }).replyTo, null);

    // 6-option poll cap alignment
    const sixOptPoll = await api(
      srv.baseUrl,
      `/channels/${defaultChannelId}/messages`,
      {
        method: 'POST',
        body: JSON.stringify({
          content: '6 seçenekli anket',
          poll: {
            question: 'En sevilen renk?',
            options: ['Mor', 'Mavi', 'Yeşil', 'Turuncu', 'Kırmızı', 'Siyah'],
            allowMultiple: true,
          },
        }),
      },
      aliceToken
    );
    assert.equal(sixOptPoll.status, 201);
    assert.equal((sixOptPoll.data.message as { poll: { options: unknown[] } }).poll.options.length, 6);

    // Session management & Change Password with revokeOthers
    const aliceSecondLogin = await api(srv.baseUrl, '/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'alice@example.com', password: 'Password123!' }),
    });
    assert.equal(aliceSecondLogin.status, 200);
    const aliceToken2 = String(aliceSecondLogin.data.token);

    const sessionsRes = await api(srv.baseUrl, '/auth/sessions', {}, aliceToken);
    assert.equal(sessionsRes.status, 200);
    const activeSessions = sessionsRes.data.sessions as Array<{ id: string; isCurrent: boolean }>;
    assert.ok(activeSessions.length >= 2);
    assert.ok(activeSessions.some((s) => s.isCurrent));

    const changePassRes = await api(
      srv.baseUrl,
      '/auth/change-password',
      {
        method: 'POST',
        body: JSON.stringify({
          currentPassword: 'Password123!',
          newPassword: 'NewPassword456!',
          revokeOthers: true,
        }),
      },
      aliceToken
    );
    assert.equal(changePassRes.status, 200);

    // Second session should now be revoked
    const revokedCheck = await api(srv.baseUrl, '/auth/me', {}, aliceToken2);
    assert.equal(revokedCheck.status, 401);

    // WebSocket voice:signal authorization: outsider (founder) cannot relay signal into Alice's private server voice channel
    const privVoice = await api(
      srv.baseUrl,
      `/servers/${serverId}/channels`,
      { method: 'POST', body: JSON.stringify({ name: 'gizli-ses', type: 'voice', isPrivate: false }) },
      aliceToken
    );
    assert.equal(privVoice.status, 201);
    const privVoiceId = String(privVoice.data.channelId);

    const wsAliceVoice = new WebSocket(`${srv.wsUrl}?token=${encodeURIComponent(aliceToken)}`);
    await new Promise<void>((res) => wsAliceVoice.once('open', () => res()));
    let outsiderSignalReceived = false;
    wsAliceVoice.on('message', (raw) => {
      const ev = JSON.parse(raw.toString()) as { type: string };
      if (ev.type === 'voice:signal') outsiderSignalReceived = true;
    });

    // Founder is NOT a member of Alice's test server (`serverId`)
    wsFounder.send(
      JSON.stringify({
        type: 'voice:signal',
        payload: {
          roomType: 'channel',
          roomId: privVoiceId,
          targetUserId: (aliceMe.data.profile as { userId: string }).userId,
          signal: { sdp: 'fake' },
        },
      })
    );
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(outsiderSignalReceived, false);

    await Promise.all([
      new Promise<void>((res) => {
        wsAliceVoice.once('close', () => res());
        wsAliceVoice.close();
      }),
      new Promise<void>((res) => {
        wsFounder.once('close', () => res());
        wsFounder.close();
      }),
    ]);
  } finally {
    await srv.close();
  }
});

test('ORBIT Pro features: GIF fallback, Threads, Scheduled/Reminders, Overrides matrix, AutoMod/Welcome, Onboarding RBAC, Analytics, Templates, Purge, Group DM', async () => {
  const srv = await startTestServer();
  try {
    // Register 3 users
    const u1 = await api(srv.baseUrl, '/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email: 'p1@example.com', username: 'pro_owner', displayName: 'Pro Owner', password: 'Password123!' }),
    });
    const u2 = await api(srv.baseUrl, '/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email: 'p2@example.com', username: 'pro_member', displayName: 'Pro Member', password: 'Password123!' }),
    });
    const u3 = await api(srv.baseUrl, '/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email: 'p3@example.com', username: 'pro_third', displayName: 'Pro Third', password: 'Password123!' }),
    });
    assert.equal(u1.status, 201);
    assert.equal(u2.status, 201);
    assert.equal(u3.status, 201);

    const ownerToken = String(u1.data.token);
    const memberToken = String(u2.data.token);
    const memberId = (u2.data.profile as { userId: string }).userId;
    const thirdId = (u3.data.profile as { userId: string }).userId;

    // 1. GIF Search works without TENOR_API_KEY via built-in animated GIFs
    const gifTrend = await api(srv.baseUrl, '/gifs/search?q=trending', {}, ownerToken);
    assert.equal(gifTrend.status, 200);
    assert.equal(gifTrend.data.configured, true);
    assert.ok(Array.isArray(gifTrend.data.results) && gifTrend.data.results.length >= 10);

    const gifKahve = await api(srv.baseUrl, '/gifs/search?q=kahve', {}, ownerToken);
    assert.equal(gifKahve.status, 200);
    assert.ok((gifKahve.data.results as Array<{ url: string }>).some((g) => g.url.includes('kahve.gif')));

    // 2. Create server with 'tech' template & verify template channels + roles exist
    const techSrv = await api(
      srv.baseUrl,
      '/servers',
      {
        method: 'POST',
        body: JSON.stringify({ name: 'Tech Hub', description: 'Pro test', isDiscoverable: false, template: 'tech' }),
      },
      ownerToken
    );
    assert.equal(techSrv.status, 201);
    const serverId = (techSrv.data.server as { id: string }).id;
    const defaultChId = String(techSrv.data.defaultChannelId);

    const srvDetail1 = await api(srv.baseUrl, `/servers/${serverId}`, {}, ownerToken);
    const roles = srvDetail1.data.roles as Array<{ id: string; name: string; isDefault: boolean; isAdmin: boolean }>;
    const channels = srvDetail1.data.channels as Array<{ id: string; name: string; type: string; isStage?: boolean }>;
    const everyoneRole = roles.find((r) => r.isDefault)!;
    const adminRole = roles.find((r) => r.isAdmin)!;
    const extraRole = roles.find((r) => !r.isDefault && !r.isAdmin && r.name === 'Katkıcı');
    assert.ok(extraRole);
    assert.ok(channels.some((c) => c.type === 'voice' && c.isStage === true));

    // Apply 'study' template onto existing server
    const applyTpl = await api(
      srv.baseUrl,
      `/servers/${serverId}/apply-template`,
      { method: 'POST', body: JSON.stringify({ templateId: 'study' }) },
      ownerToken
    );
    assert.equal(applyTpl.status, 200);

    // 3. Configure AutoMod + Welcome Automation + Onboarding before member joins
    const automodRes = await api(
      srv.baseUrl,
      `/servers/${serverId}/automod`,
      {
        method: 'PUT',
        body: JSON.stringify({
          enabled: true,
          blockBadWords: true,
          badWords: 'yasakli_kelime',
          blockInvites: true,
          antiSpam: false,
          maxMentions: 3,
          timeoutMinutes: 1,
          welcomeEnabled: true,
          welcomeChannelId: defaultChId,
          welcomeMessage: 'Hoş geldin {user} -> {server}!',
        }),
      },
      ownerToken
    );
    assert.equal(automodRes.status, 200);

    // Onboarding config: try sneaking adminRole in + valid extraRole -> backend MUST drop adminRole!
    const onbSave = await api(
      srv.baseUrl,
      `/servers/${serverId}/onboarding`,
      {
        method: 'PUT',
        body: JSON.stringify({
          enabled: true,
          promptTitle: 'Tech Hub Kuralları',
          rulesText: 'Saygılı ol.',
          roles: [
            { roleId: adminRole.id, emoji: '👑', label: 'Hack Admin', description: 'Engellenmeli' },
            { roleId: extraRole!.id, emoji: '💻', label: 'Katkıcı', description: 'Açık kaynak katkıcısı' },
          ],
        }),
      },
      ownerToken
    );
    assert.equal(onbSave.status, 200);

    // Member joins via invite -> triggers welcome message
    const inv = await api(
      srv.baseUrl,
      `/servers/${serverId}/invites`,
      { method: 'POST', body: JSON.stringify({ maxUses: 5, expiresInHours: 24 }) },
      ownerToken
    );
    const invCode = (inv.data.invite as { code: string }).code;
    const joinRes = await api(srv.baseUrl, `/invites/${invCode}/join`, { method: 'POST' }, memberToken);
    assert.equal(joinRes.status, 200);

    const chMsgsAfterJoin = await api(srv.baseUrl, `/channels/${defaultChId}/messages`, {}, ownerToken);
    const msgsList = chMsgsAfterJoin.data.messages as Array<{ content: string }>;
    assert.ok(msgsList.some((m) => m.content.includes('Hoş geldin @pro_member -> Tech Hub!')));

    // 4. Onboarding acceptance + security check
    const onbGet = await api(srv.baseUrl, `/servers/${serverId}/onboarding`, {}, memberToken);
    assert.equal(onbGet.status, 200);
    const onbRoles = (onbGet.data.onboarding as { roles: Array<{ roleId: string }> }).roles;
    assert.equal(onbRoles.length, 1); // Admin role stripped!
    assert.equal(onbRoles[0].roleId, extraRole!.id);

    const forbiddenToggle = await api(
      srv.baseUrl,
      `/servers/${serverId}/onboarding/toggle-role`,
      { method: 'POST', body: JSON.stringify({ roleId: adminRole.id }) },
      memberToken
    );
    assert.equal(forbiddenToggle.status, 403);

    const acceptOnb = await api(
      srv.baseUrl,
      `/servers/${serverId}/onboarding/accept`,
      { method: 'POST', body: JSON.stringify({ roleIds: [extraRole!.id, adminRole.id] }) },
      memberToken
    );
    assert.equal(acceptOnb.status, 200);

    // 5. AutoMod blocks bad word for non-privileged member AND applies timeoutMinutes=1
    const badMsg = await api(
      srv.baseUrl,
      `/channels/${defaultChId}/messages`,
      { method: 'POST', body: JSON.stringify({ content: 'Burada yasakli_kelime var!' }) },
      memberToken
    );
    assert.equal(badMsg.status, 400);

    // Muted member is blocked from sending until unmuted
    const mutedFollowUp = await api(
      srv.baseUrl,
      `/channels/${defaultChId}/messages`,
      { method: 'POST', body: JSON.stringify({ content: 'Temiz mesaj ama susturuluyum' }) },
      memberToken
    );
    assert.equal(mutedFollowUp.status, 403);

    // Owner unmutes member
    const unmuteRes = await api(
      srv.baseUrl,
      `/servers/${serverId}/members/${memberId}/mute`,
      { method: 'POST', body: JSON.stringify({ minutes: 0 }) },
      ownerToken
    );
    assert.equal(unmuteRes.status, 200);

    const cleanMsg = await api(
      srv.baseUrl,
      `/channels/${defaultChId}/messages`,
      { method: 'POST', body: JSON.stringify({ content: 'Merhaba ORBIT Pro!' }) },
      ownerToken
    );
    assert.equal(cleanMsg.status, 201);
    const parentMsgId = (cleanMsg.data.message as { id: string }).id;

    // 6. Threads (Alt Konular) + replyCount + lock check
    const thCreate = await api(
      srv.baseUrl,
      `/messages/${parentMsgId}/threads`,
      { method: 'POST', body: JSON.stringify({ title: 'Pro Alt Konusu' }) },
      ownerToken
    );
    assert.equal(thCreate.status, 201);
    const threadId = (thCreate.data.thread as { id: string }).id;

    const thReply = await api(
      srv.baseUrl,
      `/threads/${threadId}/messages`,
      { method: 'POST', body: JSON.stringify({ content: 'Alt konu cevabı' }) },
      memberToken
    );
    assert.equal(thReply.status, 201);

    const chMsgsAfterThread = await api(srv.baseUrl, `/channels/${defaultChId}/messages`, {}, ownerToken);
    const parentRow = (chMsgsAfterThread.data.messages as Array<{ id: string; threadSummary?: { replyCount: number } }>).find(
      (m) => m.id === parentMsgId
    );
    assert.equal(parentRow?.threadSummary?.replyCount, 1);

    // Lock thread -> member cannot reply
    await api(srv.baseUrl, `/threads/${threadId}`, { method: 'PATCH', body: JSON.stringify({ isLocked: true }) }, ownerToken);
    const lockedReply = await api(
      srv.baseUrl,
      `/threads/${threadId}/messages`,
      { method: 'POST', body: JSON.stringify({ content: 'Kilitli cevap' }) },
      memberToken
    );
    assert.equal(lockedReply.status, 403);

    // 7. Channel Permission Overrides Matrix: deny ATTACH_FILES on @herkes
    const overrideRes = await api(
      srv.baseUrl,
      `/channels/${defaultChId}/overrides`,
      {
        method: 'PUT',
        body: JSON.stringify({
          overrides: [{ roleId: everyoneRole.id, allowPerms: [], denyPerms: ['ATTACH_FILES'] }],
        }),
      },
      ownerToken
    );
    assert.equal(overrideRes.status, 200);

    // Upload a dummy PNG/file and confirm channel message with attachment is rejected (403)
    const fd = new FormData();
    fd.append('files', new Blob(['hello'], { type: 'text/plain' }), 'not.txt');
    const upResp = await fetch(`${srv.baseUrl}/files/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${memberToken}` },
      body: fd,
    });
    assert.equal(upResp.status, 201);
    const upJson = (await upResp.json()) as { files: Array<{ id: string }> };

    const deniedAttachMsg = await api(
      srv.baseUrl,
      `/channels/${defaultChId}/messages`,
      { method: 'POST', body: JSON.stringify({ content: 'Dosya dene', attachmentIds: [upJson.files[0].id] }) },
      memberToken
    );
    assert.equal(deniedAttachMsg.status, 403);

    // 8. Scheduled Messages & Reminders CRUD
    const futureIso = new Date(Date.now() + 10 * 60_000).toISOString();
    const schedCreate = await api(
      srv.baseUrl,
      '/scheduled-messages',
      { method: 'POST', body: JSON.stringify({ channelId: defaultChId, content: 'Planlı mesaj', sendAt: futureIso }) },
      ownerToken
    );
    assert.equal(schedCreate.status, 201);
    const schedId = (schedCreate.data.scheduled as { id: string }).id;

    const schedList = await api(srv.baseUrl, '/scheduled-messages', {}, ownerToken);
    assert.ok((schedList.data.scheduled as Array<{ id: string }>).some((s) => s.id === schedId));
    await api(srv.baseUrl, `/scheduled-messages/${schedId}`, { method: 'DELETE' }, ownerToken);

    const remCreate = await api(
      srv.baseUrl,
      '/reminders',
      { method: 'POST', body: JSON.stringify({ channelId: defaultChId, note: 'Test hatırlatıcı', remindAt: futureIso }) },
      ownerToken
    );
    assert.equal(remCreate.status, 201);
    const remId = (remCreate.data.reminder as { id: string }).id;
    await api(srv.baseUrl, `/reminders/${remId}`, { method: 'DELETE' }, ownerToken);

    // 9. Server Analytics + Channel Purge + Group DM
    const analytics = await api(srv.baseUrl, `/servers/${serverId}/analytics`, {}, ownerToken);
    assert.equal(analytics.status, 200);
    assert.equal((analytics.data.analytics as { memberCount: number }).memberCount, 2);

    const purge = await api(
      srv.baseUrl,
      `/channels/${defaultChId}/purge`,
      { method: 'POST', body: JSON.stringify({ count: 5 }) },
      ownerToken
    );
    assert.equal(purge.status, 200);
    assert.ok((purge.data.deletedCount as number) >= 1);

    const grpCreate = await api(
      srv.baseUrl,
      '/dm/conversations',
      { method: 'POST', body: JSON.stringify({ participantIds: [memberId, thirdId], name: 'Çekirdek Grup' }) },
      ownerToken
    );
    assert.equal(grpCreate.status, 201);
    const grpConv = grpCreate.data.conversation as { id: string; isGroup: boolean; members: unknown[] };
    assert.equal(grpConv.isGroup, true);
    assert.equal(grpConv.members.length, 3);

    const grpLeave = await api(srv.baseUrl, `/dm/conversations/${grpConv.id}/members/${thirdId}`, { method: 'DELETE' }, ownerToken);
    assert.equal(grpLeave.status, 200);
    assert.equal((grpLeave.data.conversation as { members: unknown[] }).members.length, 2);
  } finally {
    await srv.close();
  }
});

test('ORBIT Ultimate: 2FA, email change, export, achievements/streaks, Nitro/boost, Official Bot, avatar access, voice participants', async () => {
  const srv = await startTestServer();
  try {
    // 1. Register two users
    const u1 = await api(srv.baseUrl, '/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        email: 'ultimate1@example.com',
        username: 'ult_owner',
        displayName: 'Ultimate Owner',
        password: 'Password123!',
      }),
    });
    assert.equal(u1.status, 201);
    const ownerToken = String(u1.data.token);
    const ownerId = (u1.data.profile as { userId: string }).userId;

    const u2 = await api(srv.baseUrl, '/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        email: 'ultimate2@example.com',
        username: 'ult_guest',
        displayName: 'Ultimate Guest',
        password: 'Password123!',
      }),
    });
    assert.equal(u2.status, 201);
    const guestToken = String(u2.data.token);

    // 2. Avatar upload vs private channel attachment access control
    const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
    const avatarFd = new FormData();
    avatarFd.append('avatar', new Blob([pngBytes], { type: 'image/png' }), 'avatar.png');
    const avatarResp = await fetch(`${srv.baseUrl}/users/me/avatar`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: avatarFd,
    });
    assert.equal(avatarResp.status, 200);
    const avatarJson = (await avatarResp.json()) as { avatarUrl: string; profile: { avatarUrl: string } };
    assert.ok(avatarJson.avatarUrl.startsWith('/api/files/'));
    assert.equal(avatarJson.profile.avatarUrl, avatarJson.avatarUrl);

    // Public avatar URL must be readable even without Authorization header
    const originBase = srv.baseUrl.replace(/\/api$/, '');
    const publicAvatarFetch = await fetch(`${originBase}${avatarJson.avatarUrl}`);
    assert.equal(publicAvatarFetch.status, 200);

    // Private channel file upload must reject unauthenticated and non-member access
    const privFd = new FormData();
    privFd.append('files', new Blob(['secret file'], { type: 'text/plain' }), 'secret.txt');
    const privUp = await fetch(`${srv.baseUrl}/files/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: privFd,
    });
    assert.equal(privUp.status, 201);
    const privUpJson = (await privUp.json()) as { files: Array<{ id: string; url: string }> };

    const srvCreate = await api(
      srv.baseUrl,
      '/servers',
      { method: 'POST', body: JSON.stringify({ name: 'Ultimate Server', isDiscoverable: false }) },
      ownerToken
    );
    assert.equal(srvCreate.status, 201);
    const serverId = (srvCreate.data.server as { id: string }).id;
    const textChannelId = String(srvCreate.data.defaultChannelId);
    const srvDetails = await api(srv.baseUrl, `/servers/${serverId}`, {}, ownerToken);
    assert.equal(srvDetails.status, 200);
    const channels = srvDetails.data.channels as Array<{ id: string; type: string }>;
    const voiceChannelId = channels.find((c) => c.type === 'voice')!.id;

    // Attach uploaded file to a channel message so access checks bind to server membership
    const attachMsg = await api(
      srv.baseUrl,
      `/channels/${textChannelId}/messages`,
      { method: 'POST', body: JSON.stringify({ content: 'Gizli dosya', attachmentIds: [privUpJson.files[0].id] }) },
      ownerToken
    );
    assert.equal(attachMsg.status, 201);

    const unauthFileFetch = await fetch(`${originBase}${privUpJson.files[0].url}`);
    assert.equal(unauthFileFetch.status, 401);

    const guestFileFetch = await fetch(`${originBase}${privUpJson.files[0].url}`, {
      headers: { Authorization: `Bearer ${guestToken}` },
    });
    assert.equal(guestFileFetch.status, 403);

    // 3. 2FA setup, enable, login challenge (TOTP + single-use backup code), and disable
    const setup2fa = await api(srv.baseUrl, '/auth/2fa/setup', { method: 'POST' }, ownerToken);
    assert.equal(setup2fa.status, 200);
    const secret2fa = String(setup2fa.data.secret);
    assert.ok(secret2fa.length >= 16);

    const validTotp = generateTotpCode(secret2fa);
    const enable2fa = await api(
      srv.baseUrl,
      '/auth/2fa/enable',
      { method: 'POST', body: JSON.stringify({ code: validTotp }) },
      ownerToken
    );
    assert.equal(enable2fa.status, 200);
    const backupCodes = enable2fa.data.backupCodes as string[];
    assert.equal(backupCodes.length, 8);

    const loginChallenge = await api(srv.baseUrl, '/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'ultimate1@example.com', password: 'Password123!' }),
    });
    assert.equal(loginChallenge.status, 200);
    assert.equal(loginChallenge.data.requiresTwoFactor, true);
    const challengeToken = String(loginChallenge.data.challengeToken);

    // Verify login with TOTP code
    const verifyTotp = await api(srv.baseUrl, '/auth/login/2fa', {
      method: 'POST',
      body: JSON.stringify({ challengeToken, code: generateTotpCode(secret2fa) }),
    });
    assert.equal(verifyTotp.status, 200);
    assert.ok(verifyTotp.data.token);

    // Verify login with single-use backup code, then ensure reuse fails
    const loginChallenge2 = await api(srv.baseUrl, '/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'ultimate1@example.com', password: 'Password123!' }),
    });
    const challengeToken2 = String(loginChallenge2.data.challengeToken);
    const usedBackup = backupCodes[0];
    const verifyBackup = await api(srv.baseUrl, '/auth/login/2fa', {
      method: 'POST',
      body: JSON.stringify({ challengeToken: challengeToken2, code: usedBackup }),
    });
    assert.equal(verifyBackup.status, 200);

    const loginChallenge3 = await api(srv.baseUrl, '/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'ultimate1@example.com', password: 'Password123!' }),
    });
    const reuseBackup = await api(srv.baseUrl, '/auth/login/2fa', {
      method: 'POST',
      body: JSON.stringify({ challengeToken: String(loginChallenge3.data.challengeToken), code: usedBackup }),
    });
    assert.equal(reuseBackup.status, 401);

    const disable2fa = await api(
      srv.baseUrl,
      '/auth/2fa/disable',
      { method: 'POST', body: JSON.stringify({ password: 'Password123!', code: generateTotpCode(secret2fa) }) },
      ownerToken
    );
    assert.equal(disable2fa.status, 200);

    // 4. Email Change & JSON Data Export
    const reqEmail = await api(
      srv.baseUrl,
      '/auth/change-email/request',
      { method: 'POST', body: JSON.stringify({ newEmail: 'owner_new@example.com', password: 'Password123!' }) },
      ownerToken
    );
    assert.equal(reqEmail.status, 200);
    const confirmCode = String(reqEmail.data.verificationCode);
    assert.ok(confirmCode.length >= 4);

    const confEmail = await api(
      srv.baseUrl,
      '/auth/change-email/confirm',
      { method: 'POST', body: JSON.stringify({ code: confirmCode }) },
      ownerToken
    );
    assert.equal(confEmail.status, 200);
    assert.equal((confEmail.data.profile as { email: string }).email, 'owner_new@example.com');

    const exportRes = await api(srv.baseUrl, '/users/me/export', {}, ownerToken);
    assert.equal(exportRes.status, 200);
    assert.equal((exportRes.data.profile as { email: string }).email, 'owner_new@example.com');

    // 5. Achievements & 1-7 Day Streak
    const achBefore = await api(srv.baseUrl, '/achievements/me', {}, ownerToken);
    assert.equal(achBefore.status, 200);
    const xpBefore = achBefore.data.xp as number;
    const streakBefore = achBefore.data.streak as { currentStreak: number; hasFlameBadge: boolean };
    assert.ok(streakBefore.currentStreak >= 1);
    assert.ok(xpBefore > 0);

    // 6. Paid Nitro gating, Stripe webhook activation, profile effects, server boost/cancel, and badges
    const deniedFrame = await api(
      srv.baseUrl,
      '/users/me/profile',
      { method: 'PATCH', body: JSON.stringify({ avatarFrame: 'aurora' }) },
      ownerToken
    );
    assert.equal(deniedFrame.status, 403);

    const nitroActivate = await api(
      srv.baseUrl,
      '/nitro/activate',
      { method: 'POST', body: JSON.stringify({ plan: 'yearly' }) },
      ownerToken
    );
    assert.equal(nitroActivate.status, 402);
    assert.equal(nitroActivate.data.requiresPayment, true);

    const prevStripeKey = process.env.STRIPE_SECRET_KEY;
    const prevWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_SECRET_KEY;
    const checkoutUnconfigured = await api(
      srv.baseUrl,
      '/nitro/checkout',
      { method: 'POST', body: JSON.stringify({ plan: 'monthly' }) },
      ownerToken
    );
    assert.equal(checkoutUnconfigured.status, 503);

    // Activate Nitro via signed Stripe webhook
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_orbit_secret';
    try {
      const eventPayload = JSON.stringify({
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_test_orbit_123',
            client_reference_id: ownerId,
            customer: 'cus_test_orbit',
            subscription: 'sub_test_orbit',
            amount_total: 99990,
            currency: 'try',
            metadata: { userId: ownerId, plan: 'yearly' },
          },
        },
      });
      const ts = Math.floor(Date.now() / 1000);
      const sig = crypto
        .createHmac('sha256', process.env.STRIPE_WEBHOOK_SECRET)
        .update(`${ts}.${eventPayload}`)
        .digest('hex');
      const webhookResp = await fetch(`${srv.baseUrl}/stripe/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'stripe-signature': `t=${ts},v1=${sig}`,
        },
        body: eventPayload,
      });
      assert.equal(webhookResp.status, 200);
    } finally {
      if (prevWebhookSecret !== undefined) process.env.STRIPE_WEBHOOK_SECRET = prevWebhookSecret;
      else delete process.env.STRIPE_WEBHOOK_SECRET;
      if (prevStripeKey !== undefined) process.env.STRIPE_SECRET_KEY = prevStripeKey;
    }

    const meWithNitro = await api(srv.baseUrl, '/auth/me', {}, ownerToken);
    assert.equal(meWithNitro.status, 200);
    const nitroProfile = meWithNitro.data.profile as { nitroTier: string; badges: Array<{ key: string }> };
    assert.equal(nitroProfile.nitroTier, 'nitro');
    assert.ok(nitroProfile.badges.some((b) => b.key === 'orbit_nitro'));

    const allowedFrame = await api(
      srv.baseUrl,
      '/users/me/profile',
      { method: 'PATCH', body: JSON.stringify({ avatarFrame: 'aurora', profileEffect: 'embers', bannerPreset: 'supernova' }) },
      ownerToken
    );
    assert.equal(allowedFrame.status, 200);
    const updatedProfile = allowedFrame.data.profile as {
      avatarFrame: string;
      profileEffect: string;
      bannerPreset: string;
    };
    assert.equal(updatedProfile.avatarFrame, 'aurora');
    assert.equal(updatedProfile.profileEffect, 'embers');
    assert.equal(updatedProfile.bannerPreset, 'supernova');

    const boostRes = await api(srv.baseUrl, `/nitro/boost/${serverId}`, { method: 'POST' }, ownerToken);
    assert.equal(boostRes.status, 200);
    assert.equal(boostRes.data.boostCount, 1);

    // Server boost grants server_booster user badge and boost_tier_1 server badge
    const meAfterBoost = await api(srv.baseUrl, '/auth/me', {}, ownerToken);
    assert.ok((meAfterBoost.data.profile as { badges: Array<{ key: string }> }).badges.some((b) => b.key === 'server_booster'));
    const srvAfterBoost = await api(srv.baseUrl, `/servers/${serverId}`, {}, ownerToken);
    const srvBadges = (srvAfterBoost.data.server as { serverBadges?: Array<{ key: string }> }).serverBadges || [];
    assert.ok(srvBadges.some((b) => b.key === 'boost_tier_1'));

    // Boost awards +40 XP & server_booster achievement
    const achAfterBoost = await api(srv.baseUrl, '/achievements/me', {}, ownerToken);
    assert.equal(achAfterBoost.status, 200);
    assert.ok((achAfterBoost.data.xp as number) > xpBefore);

    const cancelRes = await api(srv.baseUrl, '/nitro/cancel', { method: 'POST' }, ownerToken);
    assert.equal(cancelRes.status, 200);
    const cancelledProfile = cancelRes.data.profile as { nitroTier: string; badges: Array<{ key: string }> };
    assert.equal(cancelledProfile.nitroTier, 'none');
    assert.ok(!cancelledProfile.badges.some((b) => b.key === 'orbit_nitro'));

    // 7. Official Verified ORBIT Bot installation and slash commands (/yardim, /sunucu)
    const botInstall = await api(
      srv.baseUrl,
      `/servers/${serverId}/bots/orbit`,
      { method: 'POST', body: JSON.stringify({}) },
      ownerToken
    );
    assert.equal(botInstall.status, 201);

    const helpCmd = await api(
      srv.baseUrl,
      `/channels/${textChannelId}/messages`,
      { method: 'POST', body: JSON.stringify({ content: '/yardim' }) },
      ownerToken
    );
    assert.equal(helpCmd.status, 201);

    const srvCmd = await api(
      srv.baseUrl,
      `/channels/${textChannelId}/messages`,
      { method: 'POST', body: JSON.stringify({ content: '/sunucu' }) },
      ownerToken
    );
    assert.equal(srvCmd.status, 201);

    const msgsWithBot = await api(srv.baseUrl, `/channels/${textChannelId}/messages`, {}, ownerToken);
    assert.equal(msgsWithBot.status, 200);
    const botReplies = (
      msgsWithBot.data.messages as Array<{
        authorId: string;
        author?: { isBot?: boolean; isVerifiedBot?: boolean };
        content: string;
      }>
    ).filter((m) => m.authorId === 'bot-orbit-official');
    assert.ok(botReplies.length >= 2);
    assert.equal(botReplies[0].author?.isBot, true);
    assert.equal(botReplies[0].author?.isVerifiedBot, true);

    // 8. Voice channel join returns participants array including caller
    const voiceJoin = await api(
      srv.baseUrl,
      `/channels/${voiceChannelId}/voice/join`,
      { method: 'POST', body: JSON.stringify({}) },
      ownerToken
    );
    assert.equal(voiceJoin.status, 200);
    const participants = voiceJoin.data.participants as Array<{ userId: string }>;
    assert.ok(Array.isArray(participants));
    assert.ok(participants.some((p) => p.userId));

    // 9. Case-insensitive password reset, reset link validation & Bug Hunter Silver/Gold badges on report submissions
    const forgotRes = await api(srv.baseUrl, '/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email: 'OWNER_NEW@EXAMPLE.COM' }),
    });
    assert.equal(forgotRes.status, 200);
    const resetCode = String(forgotRes.data.resetToken || '');
    assert.ok(resetCode.length >= 6);
    assert.ok(String(forgotRes.data.resetLink || '').includes('/reset-password?token='));

    const validateBefore = await api(
      srv.baseUrl,
      `/auth/reset-password/validate?token=${encodeURIComponent(resetCode)}`
    );
    assert.equal(validateBefore.status, 200);
    assert.equal(validateBefore.data.valid, true);

    const resetConfirm = await api(srv.baseUrl, '/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token: resetCode, newPassword: 'NewPassword123!' }),
    });
    assert.equal(resetConfirm.status, 200);

    const validateAfter = await api(
      srv.baseUrl,
      `/auth/reset-password/validate?token=${encodeURIComponent(resetCode)}`
    );
    assert.equal(validateAfter.status, 400);
    assert.equal(validateAfter.data.valid, false);

    const loginReset = await api(srv.baseUrl, '/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'owner_new@example.com', password: 'NewPassword123!' }),
    });
    assert.equal(loginReset.status, 200);
    const newOwnerToken = String(loginReset.data.token);

    const reportTargets = [
      { targetType: 'user', targetId: 'bot-orbit-official' },
      { targetType: 'server', targetId: serverId },
      { targetType: 'message', targetId: String((attachMsg.data.message as { id: string }).id) },
      { targetType: 'message', targetId: String((helpCmd.data.message as { id: string }).id) },
      { targetType: 'message', targetId: String((srvCmd.data.message as { id: string }).id) },
    ];
    for (let i = 0; i < reportTargets.length; i++) {
      const repRes = await api(
        srv.baseUrl,
        '/reports',
        {
          method: 'POST',
          body: JSON.stringify({
            targetType: reportTargets[i].targetType,
            targetId: reportTargets[i].targetId,
            reason: `[Diğer] Test raporu #${i + 1}`,
          }),
        },
        newOwnerToken
      );
      assert.equal(repRes.status, 201);
    }

    const meAfterReports = await api(srv.baseUrl, '/auth/me', {}, newOwnerToken);
    const reportBadges = (meAfterReports.data.profile as { badges: Array<{ key: string }> }).badges;
    assert.ok(reportBadges.some((b) => b.key === 'bug_hunter_silver'));
    assert.ok(reportBadges.some((b) => b.key === 'bug_hunter_gold'));
  } finally {
    await srv.close();
  }
});

test('ORBIT per-message read receipts (DM & channel + WS), Firebase Google status, and Server Roles & Rockets', async () => {
  const srv = await startTestServer();
  try {
    // Register owner & member
    const u1 = await api(srv.baseUrl, '/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        email: 'rocket_owner@example.com',
        username: 'rocket_owner',
        displayName: 'Rocket Owner',
        password: 'Password123!',
      }),
    });
    assert.equal(u1.status, 201);
    const ownerToken = String(u1.data.token);
    const ownerId = String((u1.data.profile as { userId: string }).userId);

    const u2 = await api(srv.baseUrl, '/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        email: 'rocket_member@example.com',
        username: 'rocket_member',
        displayName: 'Rocket Member',
        password: 'Password123!',
      }),
    });
    assert.equal(u2.status, 201);
    const memberToken = String(u2.data.token);
    const memberId = String((u2.data.profile as { userId: string }).userId);

    // 1. Firebase Google Sign-In status & token guard
    const googleStatus = await api(srv.baseUrl, '/auth/google/status');
    assert.equal(googleStatus.status, 200);
    assert.equal(googleStatus.data.configured, true);
    assert.equal(googleStatus.data.firebaseEnabled, true);

    const badFb = await api(srv.baseUrl, '/auth/firebase-google', {
      method: 'POST',
      body: JSON.stringify({ idToken: '' }),
    });
    assert.equal(badFb.status, 400);

    // 2. Create server + invite member
    const srvCreate = await api(
      srv.baseUrl,
      '/servers',
      { method: 'POST', body: JSON.stringify({ name: 'Yörünge Roketleri', description: 'Test', isDiscoverable: true }) },
      ownerToken
    );
    assert.equal(srvCreate.status, 201);
    const serverId = String((srvCreate.data.server as { id: string }).id);
    const channelId = String(srvCreate.data.defaultChannelId);

    const inv = await api(srv.baseUrl, `/servers/${serverId}/invites`, { method: 'POST', body: JSON.stringify({}) }, ownerToken);
    assert.equal(inv.status, 201);
    const invCode = String((inv.data.invite as { code: string }).code);
    const joinRes = await api(srv.baseUrl, `/invites/${invCode}/join`, { method: 'POST', body: JSON.stringify({}) }, memberToken);
    assert.equal(joinRes.status, 200);

    // 3. Create Discord-style hoisted, mentionable role with icon & description, assign to member, and test channel preview + @Role mention
    const createRoleRes = await api(
      srv.baseUrl,
      `/servers/${serverId}/roles`,
      {
        method: 'POST',
        body: JSON.stringify({
          name: 'Galaksi Pilotu',
          color: '#38BDF8',
          position: 5,
          hoist: true,
          mentionable: true,
          icon: '⚡',
          description: 'Özel seçkin pilot rolü',
        }),
      },
      ownerToken
    );
    assert.equal(createRoleRes.status, 201);
    const pilotRoleId = String(createRoleRes.data.roleId);

    const assignRes = await api(
      srv.baseUrl,
      `/servers/${serverId}/members/${memberId}/roles`,
      { method: 'PUT', body: JSON.stringify({ roleIds: [pilotRoleId] }) },
      ownerToken
    );
    assert.equal(assignRes.status, 200);

    const srvDetail = await api(srv.baseUrl, `/servers/${serverId}`, {}, ownerToken);
    assert.equal(srvDetail.status, 200);
    const pilotRole = (srvDetail.data.roles as Array<{ id: string; hoist?: boolean; mentionable?: boolean; icon?: string; memberCount?: number }>).find(
      (r) => r.id === pilotRoleId
    );
    assert.ok(pilotRole);
    assert.equal(pilotRole.hoist, true);
    assert.equal(pilotRole.mentionable, true);
    assert.equal(pilotRole.icon, '⚡');
    assert.equal(pilotRole.memberCount, 1);

    const previewRes = await api(srv.baseUrl, `/servers/${serverId}/roles/${pilotRoleId}/preview`, {}, ownerToken);
    assert.equal(previewRes.status, 200);
    const previewChannels = previewRes.data.channels as Array<{ channelId: string; canView: boolean; canSend: boolean }>;
    assert.ok(previewChannels.some((c) => c.channelId === channelId && c.canView && c.canSend));

    // Owner sends @Galaksi Pilotu mention message -> member gets mention notification
    const roleMentionMsg = await api(
      srv.baseUrl,
      `/channels/${channelId}/messages`,
      { method: 'POST', body: JSON.stringify({ content: 'Selam @Galaksi Pilotu ekibi!' }) },
      ownerToken
    );
    assert.equal(roleMentionMsg.status, 201);

    const memberNotifs = await api(srv.baseUrl, '/notifications', {}, memberToken);
    assert.equal(memberNotifs.status, 200);
    assert.ok(
      (memberNotifs.data.notifications as Array<{ title: string }>).some((n) => n.title.includes('@Galaksi Pilotu'))
    );

    // 4. Granular Per-Message Channel Read Receipts + WebSocket notification
    const chMsg1 = await api(
      srv.baseUrl,
      `/channels/${channelId}/messages`,
      { method: 'POST', body: JSON.stringify({ content: 'Mesaj 1 - görülecek' }) },
      ownerToken
    );
    const chMsg2 = await api(
      srv.baseUrl,
      `/channels/${channelId}/messages`,
      { method: 'POST', body: JSON.stringify({ content: 'Mesaj 2 - henüz görülmedi' }) },
      ownerToken
    );
    const chMsg1Id = String((chMsg1.data.message as { id: string }).id);
    const chMsg2Id = String((chMsg2.data.message as { id: string }).id);

    const wsOwner = new WebSocket(`${srv.wsUrl}?token=${encodeURIComponent(ownerToken)}`);
    await new Promise<void>((resolve, reject) => {
      wsOwner.once('open', () => {
        wsOwner.send(JSON.stringify({ type: 'room:subscribe', payload: { room: `channel:${channelId}` } }));
        setTimeout(resolve, 60);
      });
      wsOwner.once('error', reject);
    });

    const receiptEventPromise = new Promise<{ type: string; payload: { messageIds?: string[]; reader?: { userId: string } } }>(
      (resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('WS message:read_receipt timeout')), 4000);
        wsOwner.on('message', (raw) => {
          const parsed = JSON.parse(raw.toString()) as { type: string; payload: { messageIds?: string[]; reader?: { userId: string } } };
          if (parsed.type === 'message:read_receipt') {
            clearTimeout(timer);
            resolve(parsed);
          }
        });
      }
    );

    // Member views ONLY chMsg1 (not chMsg2)
    const chMarkRes = await api(
      srv.baseUrl,
      `/channels/${channelId}/messages/read`,
      { method: 'POST', body: JSON.stringify({ messageIds: [chMsg1Id] }) },
      memberToken
    );
    assert.equal(chMarkRes.status, 200);
    assert.deepEqual(chMarkRes.data.markedIds, [chMsg1Id]);

    const wsReceipt = await receiptEventPromise;
    assert.equal(wsReceipt.payload.reader?.userId, memberId);
    assert.ok(wsReceipt.payload.messageIds?.includes(chMsg1Id));
    await new Promise<void>((res) => {
      wsOwner.once('close', () => res());
      wsOwner.close();
    });

    // Verify DB-persisted read receipts on GET messages: chMsg1 has readBy=[memberId], chMsg2 has readBy=[]
    const chMsgsAfter = await api(srv.baseUrl, `/channels/${channelId}/messages`, {}, ownerToken);
    assert.equal(chMsgsAfter.status, 200);
    const list = chMsgsAfter.data.messages as Array<{ id: string; readCount?: number; readBy?: Array<{ userId: string }> }>;
    const fetched1 = list.find((m) => m.id === chMsg1Id);
    const fetched2 = list.find((m) => m.id === chMsg2Id);
    assert.equal(fetched1?.readCount, 1);
    assert.equal(fetched1?.readBy?.[0]?.userId, memberId);
    assert.equal(fetched2?.readCount, 0);

    // 5. Granular Per-Message DM Read Receipts
    const dmConvRes = await api(
      srv.baseUrl,
      '/dm/conversations',
      { method: 'POST', body: JSON.stringify({ participantIds: [memberId] }) },
      ownerToken
    );
    assert.equal(dmConvRes.status, 201);
    const convId = String((dmConvRes.data.conversation as { id: string }).id);

    const dmMsgA = await api(
      srv.baseUrl,
      `/dm/conversations/${convId}/messages`,
      { method: 'POST', body: JSON.stringify({ content: 'DM A okundu' }) },
      ownerToken
    );
    const dmMsgB = await api(
      srv.baseUrl,
      `/dm/conversations/${convId}/messages`,
      { method: 'POST', body: JSON.stringify({ content: 'DM B okunmadı' }) },
      ownerToken
    );
    const dmAId = String((dmMsgA.data.message as { id: string }).id);
    const dmBId = String((dmMsgB.data.message as { id: string }).id);

    const dmMarkRes = await api(
      srv.baseUrl,
      `/dm/conversations/${convId}/messages/read`,
      { method: 'POST', body: JSON.stringify({ messageIds: [dmAId] }) },
      memberToken
    );
    assert.equal(dmMarkRes.status, 200);
    assert.deepEqual(dmMarkRes.data.markedIds, [dmAId]);

    const dmListRes = await api(srv.baseUrl, `/dm/conversations/${convId}/messages`, {}, ownerToken);
    assert.equal(dmListRes.status, 200);
    const dmMsgs = dmListRes.data.messages as Array<{ id: string; readCount?: number; readBy?: Array<{ userId: string }> }>;
    assert.equal(dmMsgs.find((m) => m.id === dmAId)?.readCount, 1);
    assert.equal(dmMsgs.find((m) => m.id === dmAId)?.readBy?.[0]?.userId, memberId);
    assert.equal(dmMsgs.find((m) => m.id === dmBId)?.readCount, 0);

    // 6. Server Boost Rockets & Auto-assigned Hoisted Booster Role
    // Activate Nitro demo for owner
    const nitroAct = await api(srv.baseUrl, '/nitro/activate-demo', { method: 'POST', body: JSON.stringify({ plan: 'monthly' }) }, ownerToken);
    assert.equal(nitroAct.status, 200);

    const boostPost = await api(srv.baseUrl, `/nitro/boost/${serverId}`, { method: 'POST', body: JSON.stringify({}) }, ownerToken);
    assert.equal(boostPost.status, 200);

    const boostsGet = await api(srv.baseUrl, `/servers/${serverId}/boosts`, {}, memberToken);
    assert.equal(boostsGet.status, 200);
    assert.equal(boostsGet.data.boostCount, 1);
    assert.equal(boostsGet.data.boostLevel, 0);
    assert.equal(boostsGet.data.nextLevelTarget, 2);
    assert.ok((boostsGet.data.boosters as Array<{ userId: string }>).some((b) => b.userId === ownerId));
    assert.equal((boostsGet.data.perks as unknown[]).length, 3);

    const srvAfterBoost = await api(srv.baseUrl, `/servers/${serverId}`, {}, ownerToken);
    const boosterRole = (srvAfterBoost.data.roles as Array<{ id: string; isBoosterRole?: boolean; hoist?: boolean; name: string }>).find(
      (r) => r.isBoosterRole
    );
    assert.ok(boosterRole);
    assert.equal(boosterRole.hoist, true);
    const ownerMember = (srvAfterBoost.data.members as Array<{ userId: string; roleIds: string[] }>).find((m) => m.userId === ownerId);
    assert.ok(ownerMember?.roleIds.includes(boosterRole.id));
  } finally {
    await srv.close();
  }
});


