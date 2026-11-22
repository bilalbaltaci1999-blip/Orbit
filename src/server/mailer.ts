import nodemailer from 'nodemailer';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function isSmtpConfigured(): boolean {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  return Boolean(host && user && pass);
}

function getTransporter() {
  const host = process.env.SMTP_HOST?.trim();
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = process.env.SMTP_SECURE === 'true' || port === 465;
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  if (!host || !user || !pass) return null;

  return nodemailer.createTransport({
    host,
    port: Number.isFinite(port) && port > 0 ? port : 587,
    secure,
    auth: { user, pass },
  });
}

function getFromAddress(): string {
  const configured = process.env.SMTP_FROM?.trim();
  if (configured) return configured;
  const user = process.env.SMTP_USER?.trim();
  return user ? `ORBIT <${user}>` : 'ORBIT <noreply@orbit.local>';
}

export async function sendPasswordResetEmail(opts: {
  to: string;
  displayName: string;
  resetUrl: string;
  resetCode: string;
}): Promise<{ sent: boolean; configured: boolean; error?: string }> {
  const transporter = getTransporter();
  if (!transporter) {
    return { sent: false, configured: false };
  }

  const safeName = escapeHtml(opts.displayName || 'ORBIT Kullanıcısı');
  const safeUrl = escapeHtml(opts.resetUrl);
  const safeCode = escapeHtml(opts.resetCode);

  const html = `
<!doctype html>
<html lang="tr">
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:24px;background:#0B0B12;color:#F8FAFC;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:520px;margin:0 auto;background:#151522;border:1px solid #29293D;border-radius:16px;overflow:hidden;">
    <div style="padding:24px 28px;background:linear-gradient(135deg,#0891B2,#4F46E5);color:#FFFFFF;">
      <p style="margin:0;font-size:12px;letter-spacing:0.14em;text-transform:uppercase;opacity:0.9;font-weight:700;">ORBIT İLETİŞİM PLATFORMU</p>
      <h1 style="margin:8px 0 0;font-size:22px;line-height:1.3;">Şifre Sıfırlama Bağlantınız</h1>
    </div>
    <div style="padding:26px 28px;font-size:14px;line-height:1.6;color:#CBD5E1;">
      <p style="margin-top:0;">Merhaba <strong style="color:#FFFFFF;">${safeName}</strong>,</p>
      <p>ORBIT hesabınız için bir şifre sıfırlama talebi aldık. Yeni şifrenizi belirlemek için aşağıdaki bağlantıya tıklayabilirsiniz:</p>
      <div style="margin:24px 0;text-align:center;">
        <a href="${safeUrl}" style="display:inline-block;padding:12px 26px;background:#06B6D4;color:#082F49;text-decoration:none;font-weight:700;border-radius:12px;font-size:14px;">
          Şifremi Sıfırla
        </a>
      </div>
      <p style="font-size:12px;color:#94A3B8;margin-bottom:6px;">Bağlantı açılmazsa aşağıdaki kodu veya adresi kullanabilirsiniz (1 saat geçerlidir):</p>
      <div style="padding:12px 14px;background:#0B0B12;border:1px solid #29293D;border-radius:10px;font-family:monospace;font-size:12px;color:#67E8F9;word-break:break-all;">
        ${safeCode}
      </div>
      <p style="font-size:11px;color:#64748B;margin-top:14px;word-break:break-all;">
        Doğrudan bağlantı: <a href="${safeUrl}" style="color:#38BDF8;">${safeUrl}</a>
      </p>
      <hr style="border:none;border-top:1px solid #29293D;margin:20px 0;" />
      <p style="font-size:12px;color:#64748B;margin:0;">Bu talebi siz oluşturmadıysanız bu e-postayı güvenle görmezden gelebilirsiniz; şifreniz değiştirilmeyecektir.</p>
    </div>
  </div>
</body>
</html>`.trim();

  const text = [
    `Merhaba ${opts.displayName || 'ORBIT Kullanıcısı'},`,
    '',
    'ORBIT hesabınız için şifre sıfırlama talebi aldık.',
    `Şifrenizi sıfırlamak için bağlantı: ${opts.resetUrl}`,
    `Sıfırlama Kodu (1 saat geçerli): ${opts.resetCode}`,
    '',
    'Bu talebi siz oluşturmadıysanız bu e-postayı görmezden gelebilirsiniz.',
  ].join('\n');

  try {
    await transporter.sendMail({
      from: getFromAddress(),
      to: opts.to,
      subject: 'ORBIT · Şifre Sıfırlama Bağlantısı',
      text,
      html,
    });
    return { sent: true, configured: true };
  } catch (err) {
    return {
      sent: false,
      configured: true,
      error: err instanceof Error ? err.message : 'E-posta gönderilemedi.',
    };
  }
}

export async function sendEmailChangeVerification(opts: {
  to: string;
  displayName: string;
  code: string;
}): Promise<{ sent: boolean; configured: boolean; error?: string }> {
  const transporter = getTransporter();
  if (!transporter) {
    return { sent: false, configured: false };
  }
  const safeName = escapeHtml(opts.displayName || 'ORBIT Kullanıcısı');
  const safeCode = escapeHtml(opts.code);
  try {
    await transporter.sendMail({
      from: getFromAddress(),
      to: opts.to,
      subject: 'ORBIT · E-posta Değişikliği Onay Kodu',
      text: `Merhaba ${opts.displayName},\n\nYeni e-posta adresinizi doğrulamak için onay kodunuz: ${opts.code}\nBu kod 15 dakika geçerlidir.`,
      html: `<div style="font-family:sans-serif;background:#0B0B12;color:#F8FAFC;padding:24px;"><div style="max-width:480px;margin:0 auto;background:#151522;border:1px solid #29293D;border-radius:14px;padding:24px;"><h2 style="margin-top:0;color:#C084FC;">ORBIT E-posta Onayı</h2><p>Merhaba <strong>${safeName}</strong>, yeni e-posta adresinizi doğrulamak için onay kodunuz:</p><div style="padding:12px 16px;background:#0B0B12;border:1px solid #29293D;border-radius:10px;font-family:monospace;font-size:20px;letter-spacing:0.2em;text-align:center;color:#38BDF8;">${safeCode}</div><p style="font-size:12px;color:#94A3B8;margin-bottom:0;">Kod 15 dakika boyunca geçerlidir.</p></div></div>`,
    });
    return { sent: true, configured: true };
  } catch (err) {
    return { sent: false, configured: true, error: err instanceof Error ? err.message : 'Gönderim hatası' };
  }
}

export async function sendAccountVerificationEmail(opts: {
  to: string;
  displayName: string;
  verifyCode: string;
}): Promise<{ sent: boolean; configured: boolean; error?: string }> {
  const transporter = getTransporter();
  if (!transporter) {
    return { sent: false, configured: false };
  }
  const safeName = escapeHtml(opts.displayName || 'ORBIT Kullanıcısı');
  const safeCode = escapeHtml(opts.verifyCode);
  try {
    await transporter.sendMail({
      from: getFromAddress(),
      to: opts.to,
      subject: 'ORBIT · E-posta Doğrulama Kodu',
      text: `ORBIT'e hoş geldiniz ${opts.displayName}!\n\nE-posta doğrulama kodunuz: ${opts.verifyCode}`,
      html: `<div style="font-family:sans-serif;background:#0B0B12;color:#F8FAFC;padding:24px;"><div style="max-width:480px;margin:0 auto;background:#151522;border:1px solid #29293D;border-radius:14px;padding:24px;"><h2 style="margin-top:0;color:#22C55E;">ORBIT Hesap Doğrulama</h2><p>Hoş geldiniz <strong>${safeName}</strong>! Hesabınızı doğrulamak için aşağıdaki kodu kullanabilirsiniz:</p><div style="padding:12px 16px;background:#0B0B12;border:1px solid #29293D;border-radius:10px;font-family:monospace;font-size:14px;color:#34D399;word-break:break-all;">${safeCode}</div></div></div>`,
    });
    return { sent: true, configured: true };
  } catch (err) {
    return { sent: false, configured: true, error: err instanceof Error ? err.message : 'Gönderim hatası' };
  }
}
