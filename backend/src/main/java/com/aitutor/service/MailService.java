package com.aitutor.service;

import jakarta.mail.internet.MimeMessage;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.mail.javamail.JavaMailSenderImpl;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.util.Properties;

/**
 * SMTP delivery for NovaTutor transactional mail.
 *
 * Credentials come only from the environment. When SMTP is not configured the
 * service reports that honestly instead of pretending an email was sent; the
 * registration screen then tells the user verification delivery is unavailable.
 *
 * Works with any standard SMTP relay (Resend, Brevo, SendGrid, Mailgun, a
 * university relay or a local test server). Configuration:
 *   SMTP_HOST, SMTP_PORT, SMTP_USERNAME, SMTP_PASSWORD
 *   SMTP_STARTTLS (default true), SMTP_SSL (default false), MAIL_FROM
 */
@Service
public class MailService {
    private final JavaMailSenderImpl sender;
    private final String from;
    private final String fromName;
    private final boolean configured;

    public MailService(
            @Value("${app.mail.host:}") String host,
            @Value("${app.mail.port:587}") int port,
            @Value("${app.mail.username:}") String username,
            @Value("${app.mail.password:}") String password,
            @Value("${app.mail.starttls:true}") boolean startTls,
            @Value("${app.mail.ssl:false}") boolean ssl,
            @Value("${app.mail.from:no-reply@novatutor.app}") String from,
            @Value("${app.mail.from-name:NovaTutor}") String fromName) {
        this.from = (from == null || from.isBlank()) ? "no-reply@novatutor.app" : from.trim();
        this.fromName = (fromName == null || fromName.isBlank()) ? "NovaTutor" : fromName.trim();
        this.configured = host != null && !host.isBlank();
        this.sender = new JavaMailSenderImpl();
        this.sender.setHost(configured ? host.trim() : "localhost");
        this.sender.setPort(port > 0 ? port : 587);
        if (username != null && !username.isBlank()) this.sender.setUsername(username.trim());
        if (password != null && !password.isBlank()) this.sender.setPassword(password);
        this.sender.setDefaultEncoding(StandardCharsets.UTF_8.name());
        Properties props = this.sender.getJavaMailProperties();
        props.put("mail.transport.protocol", "smtp");
        props.put("mail.smtp.auth", String.valueOf(username != null && !username.isBlank()));
        props.put("mail.smtp.starttls.enable", String.valueOf(startTls));
        props.put("mail.smtp.starttls.required", String.valueOf(startTls && !ssl));
        props.put("mail.smtp.ssl.enable", String.valueOf(ssl));
        props.put("mail.smtp.connectiontimeout", "8000");
        props.put("mail.smtp.timeout", "10000");
        props.put("mail.smtp.writetimeout", "10000");
    }

    public boolean isConfigured() { return configured; }

    /** True only when the relay accepted the message. */
    public boolean sendHtml(String to, String subject, String html) {
        if (!configured || to == null || to.isBlank()) return false;
        try {
            MimeMessage message = sender.createMimeMessage();
            MimeMessageHelper helper = new MimeMessageHelper(message, true, StandardCharsets.UTF_8.name());
            helper.setFrom(from, fromName);
            helper.setTo(to);
            helper.setSubject(subject);
            helper.setText(html, true);
            sender.send(message);
            return true;
        } catch (Exception e) {
            // Never log the recipient token or credentials. The caller decides
            // how to present an honest delivery failure.
            return false;
        }
    }

    public String verificationEmail(String name, String link, int hours) {
        String safeName = escape(name == null || name.isBlank() ? "there" : name.trim());
        String safeLink = escape(link);
        return shell(
                "Verify your email",
                "Welcome to NovaTutor, " + safeName + ".",
                "Confirm this email address to activate your learning workspace. "
                        + "Verification links expire in " + hours + " hours and can be used only once.",
                "Verify email address", safeLink,
                "If you did not create a NovaTutor account, you can safely ignore this email. "
                        + "Nobody can access an account until this address is verified.");
    }

    public String passwordResetEmail(String name, String link, int minutes) {
        String safeName = escape(name == null || name.isBlank() ? "there" : name.trim());
        String safeLink = escape(link);
        return shell(
                "Reset your password",
                "Hi " + safeName + ",",
                "We received a request to reset the password for your NovaTutor account. "
                        + "This link expires in " + minutes + " minutes and works only once.",
                "Choose a new password", safeLink,
                "If you did not request a password reset, you can ignore this email. Your password will not change.");
    }

    private String shell(String title, String heading, String copy, String cta, String link, String footerNote) {
        return "<!doctype html><html><body style=\"margin:0;padding:0;background:#f4f4f1;font-family:'Helvetica Neue',Arial,sans-serif;color:#14161b;\">"
                + "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"background:#f4f4f1;padding:32px 16px;\"><tr><td align=\"center\">"
                + "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"max-width:560px;background:#ffffff;border:1px solid #e7e7e4;border-radius:16px;overflow:hidden;\">"
                + "<tr><td style=\"padding:28px 32px 8px;\">"
                + "<div style=\"font-size:20px;font-weight:800;letter-spacing:-0.3px;\">NovaTutor<span style=\"color:#6b5ce7;\">.</span></div>"
                + "<div style=\"font-size:11px;letter-spacing:1.6px;color:#71757e;margin-top:4px;\">THE LEARNING WORKSPACE</div>"
                + "</td></tr><tr><td style=\"padding:12px 32px 0;\">"
                + "<h1 style=\"font-size:24px;line-height:1.25;margin:12px 0 10px;\">" + escape(title) + "</h1>"
                + "<p style=\"font-size:15px;line-height:1.6;color:#3c3f46;margin:0 0 8px;\"><strong>" + escape(heading) + "</strong></p>"
                + "<p style=\"font-size:15px;line-height:1.6;color:#4b4f58;margin:0 0 24px;\">" + escape(copy) + "</p>"
                + "<a href=\"" + link + "\" style=\"display:inline-block;background:#14161b;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:13px 22px;border-radius:10px;\">" + escape(cta) + "</a>"
                + "<p style=\"font-size:12px;line-height:1.6;color:#71757e;margin:22px 0 0;\">Or paste this link into your browser:<br><span style=\"word-break:break-all;color:#3c3f46;\">" + link + "</span></p>"
                + "</td></tr><tr><td style=\"padding:22px 32px 28px;\">"
                + "<hr style=\"border:none;border-top:1px solid #e7e7e4;margin:0 0 16px;\">"
                + "<p style=\"font-size:12px;line-height:1.6;color:#71757e;margin:0;\">" + escape(footerNote) + "</p>"
                + "<p style=\"font-size:11px;line-height:1.6;color:#9a9ea6;margin:14px 0 0;\">NovaTutor · Learning workspace · This is an automated security message.</p>"
                + "</td></tr></table></td></tr></table></body></html>";
    }

    private static String escape(String value) {
        if (value == null) return "";
        return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
                .replace("\"", "&quot;").replace("'", "&#39;");
    }
}
