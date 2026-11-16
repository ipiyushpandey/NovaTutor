package com.aitutor.controller;

import com.aitutor.config.AuditLog;
import com.aitutor.config.AuditLogRepository;
import com.aitutor.entity.User;
import com.aitutor.security.JwtService;
import com.aitutor.service.AuthService;
import com.aitutor.service.EmailVerificationService;
import com.aitutor.service.GoogleIdTokenVerifier;
import com.aitutor.service.MailService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/auth")
public class AuthController {
    private final AuthService auth;
    private final JwtService jwt;
    private final AuditLogRepository audit;
    private final EmailVerificationService verification;
    private final GoogleIdTokenVerifier google;
    private final MailService mail;

    public AuthController(AuthService a, JwtService j, AuditLogRepository audit,
                          EmailVerificationService verification, GoogleIdTokenVerifier google, MailService mail) {
        this.auth = a; this.jwt = j; this.audit = audit;
        this.verification = verification; this.google = google; this.mail = mail;
    }

    record Req(@NotBlank @Size(max=100) String name, @NotBlank @Email @Size(max=254) String email,
               @Size(min=6, max=128) String password) {}
    record Login(@NotBlank @Email String email, @NotBlank String password) {}
    record VerifyReq(@NotBlank @Size(max=200) String token) {}
    record EmailReq(@NotBlank @Email @Size(max=254) String email) {}
    record ResetReq(@NotBlank @Size(max=200) String token, @Size(min=6, max=128) String password) {}
    record GoogleReq(@NotBlank String credential) {}
    record Res(String token, Long id, String name, String email, String role,
               boolean profileComplete, boolean emailVerified) {}
    record Pending(boolean pending, String email, boolean verificationSent,
                   boolean emailDeliveryConfigured, String message) {}
    record ProviderInfo(boolean googleEnabled, String googleClientId) {}

    @PostMapping("/register")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public Pending register(@Valid @RequestBody Req r) {
        User u = auth.register(r.name(), r.email(), r.password());
        EmailVerificationService.Issue issue = verification.issueVerification(u, true);
        String message;
        if (issue.sent()) {
            message = "We sent a verification link to " + u.getEmail()
                    + ". It expires in " + EmailVerificationService.VERIFICATION_HOURS + " hours.";
        } else if (!issue.configured()) {
            message = "Your account is created, but this server cannot send email yet. "
                    + "Ask the administrator to configure SMTP, then resend the verification link.";
        } else {
            message = "Your account is created, but the verification email could not be delivered. "
                    + "Please resend it in a moment or contact support.";
        }
        return new Pending(true, u.getEmail(), issue.sent(), issue.configured(), message);
    }

    @PostMapping("/login")
    public Res login(@Valid @RequestBody Login r) {
        AuthService.LoginOutcome outcome = auth.login(r.email(), r.password());
        User u = outcome.user();
        if ("ADMIN".equalsIgnoreCase(u.getRole())) {
            audit.save(new AuditLog(u.getEmail(), "ADMIN_LOGIN", "auth", "SUCCESS", null));
        }
        if (outcome.adminPasswordRecovered()) {
            audit.save(new AuditLog(u.getEmail(), "ADMIN_PASSWORD_RECOVERED", "auth", "SUCCESS",
                    "Owner password hash resynchronised from the configured ADMIN_PASSWORD."));
        }
        return response(u);
    }

    @GetMapping("/me")
    public Res me(@RequestHeader(value = "Authorization", required = false) String authorization) {
        if (authorization == null || !authorization.startsWith("Bearer ")) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "UNAUTHENTICATED", "Not signed in");
        }
        User u;
        try {
            u = auth.find(jwt.email(authorization.substring(7)));
        } catch (io.jsonwebtoken.JwtException e) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "SESSION_EXPIRED", "Your session has expired. Sign in again.");
        }
        if (u.isBlocked() || !u.isActive()) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "ACCOUNT_DISABLED", "Account is inactive or blocked");
        }
        if (!u.isEmailVerified()) {
            throw new ApiException(HttpStatus.FORBIDDEN, "EMAIL_UNVERIFIED", "Verify your email address to continue.");
        }
        u = auth.syncOwnerRole(u);
        // Refreshing the token on every /me call keeps active sessions usable
        // without extending the lifetime of abandoned ones.
        return response(u);
    }

    @PostMapping("/verify-email")
    public Map<String, Object> verifyEmail(@Valid @RequestBody VerifyReq r) {
        EmailVerificationService.VerificationResult result = verification.verify(r.token());
        return switch (result) {
            case VERIFIED, ALREADY_VERIFIED -> Map.of(
                    "status", result.name(),
                    "verified", true,
                    "message", "Your email is verified. You can sign in now.");
            case EXPIRED -> throw new ApiException(HttpStatus.BAD_REQUEST, "VERIFICATION_EXPIRED",
                    "This verification link has expired. Request a new one from the sign-in screen.");
            case INVALID -> throw new ApiException(HttpStatus.BAD_REQUEST, "VERIFICATION_INVALID",
                    "This verification link is invalid or has already been used.");
        };
    }

    @PostMapping("/resend-verification")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public Map<String, Object> resendVerification(@Valid @RequestBody EmailReq r) {
        var user = auth.findOptional(r.email());
        boolean sent = false;
        boolean rateLimited = false;
        if (user.isPresent() && !user.get().isEmailVerified()) {
            EmailVerificationService.Issue issue = verification.issueVerification(user.get(), true);
            sent = issue.sent();
            rateLimited = issue.rateLimited();
        }
        if (rateLimited) {
            throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, "VERIFICATION_COOLDOWN",
                    "A verification email was just sent. Wait one minute before requesting another.");
        }
        return Map.of(
                "sent", sent,
                "emailDeliveryConfigured", mail.isConfigured(),
                "message", sent
                        ? "If an unverified account exists for that address, a new link is on its way."
                        : "If an unverified account exists for that address, you will receive a link once email delivery is available.");
    }

    @PostMapping("/forgot-password")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public Map<String, Object> forgotPassword(@Valid @RequestBody EmailReq r) {
        boolean sent = verification.requestPasswordReset(r.email());
        return Map.of(
                "sent", sent,
                "emailDeliveryConfigured", mail.isConfigured(),
                "message", "If an account exists for that email, a password reset link has been sent.");
    }

    @PostMapping("/reset-password")
    public Map<String, Object> resetPassword(@Valid @RequestBody ResetReq r) {
        User u = verification.consumeResetToken(r.token(), r.password());
        auth.setPassword(u, r.password());
        verification.clearResetToken(u);
        audit.save(new AuditLog(u.getEmail(), "PASSWORD_RESET", "auth", "SUCCESS", "Completed with a single-use email token."));
        return Map.of("reset", true, "message", "Your password has been changed. Sign in with the new password.");
    }

    @PostMapping("/google")
    public Res google(@Valid @RequestBody GoogleReq r) {
        GoogleIdTokenVerifier.GoogleUser identity = google.verify(r.credential());
        User u = auth.googleLogin(identity.email(), identity.subject(), identity.name());
        audit.save(new AuditLog(u.getEmail(), "GOOGLE_LOGIN", "auth", "SUCCESS", null));
        return response(u);
    }

    @GetMapping("/providers")
    public ProviderInfo providers() {
        return new ProviderInfo(google.isConfigured(), google.isConfigured() ? google.clientId() : "");
    }

    private Res response(User u) {
        return new Res(jwt.token(u.getEmail()), u.getId(), u.getName(), u.getEmail(), u.getRole(),
                profileComplete(u), u.isEmailVerified());
    }

    private boolean profileComplete(User u) {
        return u.getLearningGoal() != null && !u.getLearningGoal().isBlank()
                && u.getInterests() != null && !u.getInterests().isBlank()
                && u.getWeaknesses() != null && !u.getWeaknesses().isBlank()
                && u.getLearningStyle() != null && !u.getLearningStyle().isBlank();
    }
}
