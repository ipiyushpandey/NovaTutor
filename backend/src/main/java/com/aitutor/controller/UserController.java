package com.aitutor.controller;

import com.aitutor.entity.User;
import com.aitutor.repository.UserRepository;
import com.aitutor.intelligence.LearningEventRepository;
import com.aitutor.security.AuthenticatedUser;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.bind.annotation.*;
import java.util.*;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/users")
public class UserController {
    private final UserRepository users;
    private final PasswordEncoder encoder;
    private final AuthenticatedUser authenticatedUser;
    private final LearningEventRepository learningEvents;

    public UserController(UserRepository users, PasswordEncoder encoder, AuthenticatedUser authenticatedUser, LearningEventRepository learningEvents) {
        this.users = users;
        this.encoder = encoder;
        this.authenticatedUser = authenticatedUser;
        this.learningEvents = learningEvents;
    }

    /**
     * Public, privacy-safe leaderboard. Only real registered users with recorded
     * learning activity are returned; placeholder/demo names and disposable guests
     * are never included.
     */
    @GetMapping("/leaderboard")
    public List<LeaderboardEntry> leaderboard() {
        List<LearningEventRepository.LeaderboardXpProjection> ranked = learningEvents.leaderboardXp().stream()
                .filter(x -> x.getUserId() != null && x.getXp() > 0)
                .limit(20)
                .toList();
        if (ranked.isEmpty()) return List.of();
        List<Long> ids = ranked.stream().map(LearningEventRepository.LeaderboardXpProjection::getUserId).toList();
        Map<Long, User> realUsers = users.findByIdIn(ids).stream()
                .filter(u -> u.isActive() && !u.isBlocked() && !"GUEST".equalsIgnoreCase(u.getRole()))
                .collect(Collectors.toMap(User::getId, x -> x, (a, b) -> a));
        return ranked.stream()
                .filter(x -> realUsers.containsKey(x.getUserId()))
                .map(x -> new LeaderboardEntry(x.getUserId(), realUsers.get(x.getUserId()).getName(), (int) Math.min(Integer.MAX_VALUE, x.getXp())))
                .toList();
    }

    private User ownAccount(Long pathId, Authentication authentication) {
        User u = authenticatedUser.require(authentication);
        if (!Objects.equals(pathId, u.getId())) {
            throw new org.springframework.security.access.AccessDeniedException("You can only manage your own account");
        }
        return u;
    }

    public record LeaderboardEntry(Long id, String name, int score) {}

    @GetMapping("/{id}")
    public Profile get(@PathVariable Long id, Authentication authentication) {
        User u = ownAccount(id, authentication);
        return profile(u);
    }

    private static final java.util.Set<String> ALLOWED_EDUCATION_LEVELS = java.util.Set.of(
            "b.tech / college", "school", "graduate", "working professional", "other"
    );
    private static final java.util.Set<String> ALLOWED_LEARNING_STYLES = java.util.Set.of(
            "visual + practical", "step-by-step", "practice first", "theory first"
    );

    public static boolean isValidName(String name) {
        if (name == null) return false;
        String trimmed = name.trim();
        if (trimmed.length() < 2 || trimmed.length() > 70) return false;
        long letters = trimmed.chars().filter(Character::isLetter).count();
        if (letters < 2) return false;
        long distinctLetters = trimmed.toLowerCase().chars().filter(Character::isLetter).distinct().count();
        if (distinctLetters < 2) return false;
        for (char c : trimmed.toCharArray()) {
            if (!Character.isLetter(c) && c != ' ' && c != '-' && c != '\'' && c != '.') {
                return false;
            }
        }
        return true;
    }

    public static boolean isMeaningfulText(String text, int minLen, int maxLen) {
        if (text == null) return false;
        String trimmed = text.trim();
        if (trimmed.length() < minLen || trimmed.length() > maxLen) return false;
        long alphaCount = trimmed.chars().filter(Character::isLetter).count();
        if (alphaCount < 3) return false;
        long distinctAlpha = trimmed.toLowerCase().chars().filter(Character::isLetter).distinct().count();
        if (distinctAlpha < 2) return false;
        boolean hasVowelOrNonLatin = false;
        for (char c : trimmed.toCharArray()) {
            char lower = Character.toLowerCase(c);
            if (lower == 'a' || lower == 'e' || lower == 'i' || lower == 'o' || lower == 'u' || lower == 'y') {
                hasVowelOrNonLatin = true;
                break;
            }
            if (Character.isLetter(c) && c > 127) {
                hasVowelOrNonLatin = true;
                break;
            }
        }
        return hasVowelOrNonLatin;
    }

    @PutMapping("/{id}")
    public Profile update(@PathVariable Long id, Authentication authentication, @RequestBody ProfileRequest r) {
        User u = ownAccount(id, authentication);
        if (r == null) throw new IllegalArgumentException("Profile payload is required");
        if (r.name() == null || !isValidName(r.name())) {
            throw new IllegalArgumentException("Name must be 2 to 70 characters and contain valid letters");
        }
        u.setName(r.name().trim());
        if (r.educationLevel() != null) {
            String edu = clean(r.educationLevel());
            if (!ALLOWED_EDUCATION_LEVELS.contains(edu.toLowerCase())) {
                throw new IllegalArgumentException("Invalid education level: " + edu);
            }
            u.setEducationLevel(edu);
        }
        if (r.learningGoal() != null) {
            String goal = clean(r.learningGoal());
            if (!isMeaningfulText(goal, 5, 500)) {
                throw new IllegalArgumentException("Learning goal must be at least 5 meaningful characters");
            }
            u.setLearningGoal(goal);
        }
        if (r.targetExam() != null) {
            String exam = clean(r.targetExam());
            if (exam.length() > 100) {
                throw new IllegalArgumentException("Target exam cannot exceed 100 characters");
            }
            u.setTargetExam(exam);
        }
        if (r.interests() != null) {
            String interests = clean(r.interests());
            if (!isMeaningfulText(interests, 5, 500)) {
                throw new IllegalArgumentException("Interests must be at least 5 meaningful characters");
            }
            u.setInterests(interests);
        }
        if (r.strengths() != null) {
            String strengths = clean(r.strengths());
            if (strengths.length() > 500) {
                throw new IllegalArgumentException("Strengths cannot exceed 500 characters");
            }
            u.setStrengths(strengths);
        }
        if (r.weaknesses() != null) {
            String weaknesses = clean(r.weaknesses());
            if (!isMeaningfulText(weaknesses, 5, 500)) {
                throw new IllegalArgumentException("Weaknesses must be at least 5 meaningful characters");
            }
            u.setWeaknesses(weaknesses);
        }
        if (r.learningStyle() != null) {
            String style = clean(r.learningStyle());
            if (!ALLOWED_LEARNING_STYLES.contains(style.toLowerCase())) {
                throw new IllegalArgumentException("Invalid learning style: " + style);
            }
            u.setLearningStyle(style);
        }
        if (r.dailyStudyMinutes() != null) {
            int minutes = r.dailyStudyMinutes();
            if (minutes < 15 || minutes > 480) {
                throw new IllegalArgumentException("Daily study minutes must be between 15 and 480");
            }
            u.setDailyStudyMinutes(minutes);
        }
        if (r.preferredAiLanguage() != null) {
            String lang = clean(r.preferredAiLanguage());
            if (lang.length() > 50) {
                throw new IllegalArgumentException("Preferred AI language cannot exceed 50 characters");
            }
            u.setPreferredAiLanguage(lang);
        }
        users.save(u);
        return profile(u);
    }

    @PostMapping("/{id}/password")
    public void changePassword(@PathVariable Long id, Authentication authentication, @RequestBody PasswordRequest r) {
        User u = ownAccount(id, authentication);
        if ("GUEST".equalsIgnoreCase(u.getRole())) {
            throw new ApiException(HttpStatus.FORBIDDEN, "GUEST_NOT_ALLOWED",
                    "Guest sessions do not have a password to change.");
        }
        if (r == null || r.currentPassword() == null || !encoder.matches(r.currentPassword(), u.getPassword())) {
            throw new IllegalArgumentException("Current password is incorrect");
        }
        if (r.newPassword() == null || r.newPassword().length() < 6) {
            throw new IllegalArgumentException("New password must be at least 6 characters");
        }
        if (r.newPassword().length() > 128) {
            throw new IllegalArgumentException("New password must be 128 characters or fewer");
        }
        u.setPassword(encoder.encode(r.newPassword()));
        users.save(u);
    }

    public record Profile(Long id, String name, String email, String role, String educationLevel, String learningGoal, String targetExam, String interests, String strengths, String weaknesses, String learningStyle, Integer dailyStudyMinutes, String preferredAiLanguage, boolean profileComplete) {}
    public record ProfileRequest(String name, String educationLevel, String learningGoal, String targetExam, String interests, String strengths, String weaknesses, String learningStyle, Integer dailyStudyMinutes, String preferredAiLanguage) {}
    public record PasswordRequest(String currentPassword, String newPassword) {}
    private String clean(String x){return x==null?null:x.trim();}
    private Profile profile(User u) {
        String role = u.getRole() != null ? u.getRole().toUpperCase() : "STUDENT";
        boolean complete = "GUEST".equals(role) || "ADMIN".equals(role)
                || (u.getLearningGoal() != null && !u.getLearningGoal().isBlank()
                && u.getInterests() != null && !u.getInterests().isBlank()
                && u.getWeaknesses() != null && !u.getWeaknesses().isBlank()
                && u.getLearningStyle() != null && !u.getLearningStyle().isBlank());
        return new Profile(u.getId(), u.getName(), u.getEmail(), u.getRole(),
                u.getEducationLevel(), u.getLearningGoal(), u.getTargetExam(),
                u.getInterests(), u.getStrengths(), u.getWeaknesses(),
                u.getLearningStyle(), u.getDailyStudyMinutes(),
                u.getPreferredAiLanguage(), complete);
    }
}
