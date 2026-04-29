"""邮件服务模块"""
import html
import logging
import aiosmtplib
from email.message import EmailMessage
from app.infrastructure.config import get_settings

logger = logging.getLogger(__name__)


async def send_verification_email(to_email: str, code: str) -> bool:
    """发送验证码邮件"""
    settings = get_settings()

    # 安全：转义HTML特殊字符，防止XSS
    safe_code = html.escape(code)

    html_content = f"""
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>验证码</title>
    </head>
    <body style="margin: 0; padding: 0; background: linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%); font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
        <table role="presentation" cellspacing="0" cellpadding="0" width="100%" style="background: linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%); padding: 40px 20px;">
            <tr>
                <td align="center">
                    <table role="presentation" cellspacing="0" cellpadding="0" width="100%" style="max-width: 480px; background: #ffffff; border-radius: 24px; overflow: hidden; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(0, 0, 0, 0.05);">
                        <tr>
                            <td style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); padding: 48px 40px; text-align: center; position: relative; overflow: hidden;">
                                <div style="position: absolute; top: -40px; right: -40px; width: 120px; height: 120px; border-radius: 50%; background: rgba(59, 130, 246, 0.2);"></div>
                                <div style="position: absolute; bottom: -60px; left: -30px; width: 160px; height: 160px; border-radius: 50%; background: rgba(59, 130, 246, 0.15);"></div>
                                <div style="position: absolute; top: 50%; right: 20px; width: 80px; height: 80px; border-radius: 50%; background: rgba(59, 130, 246, 0.1);"></div>
                                <div style="width: 72px; height: 72px; background: rgba(59, 130, 246, 0.2); border-radius: 20px; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 24px; position: relative;">
                                    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                                        <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                                    </svg>
                                </div>
                                <h1 style="margin: 0; font-size: 28px; font-weight: 700; color: #ffffff; letter-spacing: -0.5px; position: relative;">邮箱验证</h1>
                                <p style="margin: 12px 0 0 0; font-size: 15px; color: rgba(255, 255, 255, 0.7); position: relative;">请使用以下验证码完成验证</p>
                            </td>
                        </tr>
                        <tr>
                            <td style="padding: 40px 40px 32px; text-align: center;">
                                <p style="margin: 0 0 20px 0; font-size: 14px; color: #64748b; letter-spacing: 0.5px;">您的验证码</p>
                                <div style="background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%); border-radius: 16px; padding: 28px 32px; display: inline-block; position: relative; border: 1px solid #e2e8f0;">
                                    <span style="font-size: 42px; font-weight: 700; color: #0f172a; letter-spacing: 12px; font-family: 'Segoe UI', 'SF Mono', Monaco, monospace; text-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);">{safe_code}</span>
                                </div>
                                <p style="margin: 24px 0 0 0; font-size: 13px; color: #94a3b8; line-height: 1.6;">验证码有效期为 <strong style="color: #64748b;">5分钟</strong> ，请尽快使用</p>
                            </td>
                        </tr>
                        <tr>
                            <td style="padding: 0 40px;">
                                <div style="height: 1px; background: linear-gradient(90deg, transparent, #e2e8f0, transparent);"></div>
                            </td>
                        </tr>
                        <tr>
                            <td style="padding: 28px 40px 36px;">
                                <div style="background: #fef3c7; border-radius: 12px; padding: 16px 20px; border-left: 4px solid #f59e0b;">
                                    <div style="display: flex; align-items: flex-start; gap: 12px;">
                                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0; margin-top: 2px;">
                                            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                                            <line x1="12" y1="9" x2="12" y2="13"></line>
                                            <line x1="12" y1="17" x2="12.01" y2="17"></line>
                                        </svg>
                                        <div>
                                            <p style="margin: 0; font-size: 13px; color: #92400e; font-weight: 500;">安全提醒</p>
                                            <p style="margin: 4px 0 0 0; font-size: 12px; color: #a16207; line-height: 1.5;">请勿向任何人透露验证码，平台工作人员不会索要您的验证码</p>
                                        </div>
                                    </div>
                                </div>
                            </td>
                        </tr>
                        <tr>
                            <td style="background: #f8fafc; padding: 24px 40px; text-align: center; border-top: 1px solid #e2e8f0;">
                                <p style="margin: 0; font-size: 12px; color: #94a3b8;">这是一封系统自动发送的邮件，请勿回复</p>
                                <p style="margin: 8px 0 0 0; font-size: 12px; color: #94a3b8;">© 2024 Resume Platform. All rights reserved.</p>
                            </td>
                        </tr>
                    </table>
                </td>
            </tr>
        </table>
    </body>
    </html>
    """

    text_content = f"""邮箱验证

您的验证码：{code}

验证码有效期为5分钟，请尽快使用。

安全提醒：请勿向任何人透露验证码，平台工作人员不会索要您的验证码。

这是一封系统自动发送的邮件，请勿回复。
© 2024 Resume Platform
    """

    message = EmailMessage()
    message["From"] = settings.EMAIL_FROM
    message["To"] = to_email
    message["Subject"] = "【Resume Platform】您的邮箱验证码"
    message.set_content(text_content)
    message.add_alternative(html_content, subtype="html")

    try:
        await aiosmtplib.send(
            message,
            hostname=settings.SMTP_HOST,
            port=settings.SMTP_PORT,
            username=settings.SMTP_USER,
            password=settings.smtp_password,
            use_tls=True,
            timeout=30,
        )
        logger.info(f"邮件已成功发送至 {to_email}")
        return True
    except Exception as e:
        logger.error(f"邮件发送失败 [{to_email}]: {str(e)}")
        logger.debug(f"邮件发送失败，备用验证码: {code}")
        return False
