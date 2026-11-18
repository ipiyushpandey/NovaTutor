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

    @PutMapping("/{id}")
    public Profile update(@PathVariable Long id, Authentication authentication, @RequestBody ProfileRequest r) {
        User u = ownAccount(id, authentication);
        if (r == null || r.name() == null || r.name().isBlank()) throw new IllegalArgumentException("Name is required");
        u.setName(r.name().trim());
        if(r.educationLevel()!=null) u.setEducationLevel(clean(r.educationLevel()));
        if(r.learningGoal()!=null) u.setLearningGoal(clean(r.learningGoal()));
        if(r.targetExam()!=null) u.setTargetExam(clean(r.targetExam()));
        if(r.interests()!=null) u.setInterests(clean(r.interests()));
        if(r.strengths()!=null) u.setStrengths(clean(r.strengths()));
        if(r.weaknesses()!=null) u.setWeaknesses(clean(r.weaknesses()));
        if(r.learningStyle()!=null) u.setLearningStyle(clean(r.learningStyle()));
        if(r.dailyStudyMinutes()!=null) u.setDailyStudyMinutes(r.dailyStudyMinutes());
        if(r.preferredAiLanguage()!=null) u.setPreferredAiLanguage(clean(r.preferredAiLanguage()));
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
    private Profile profile(User u){boolean complete=u.getLearningGoal()!=null&&!u.getLearningGoal().isBlank()&&u.getInterests()!=null&&!u.getInterests().isBlank()&&u.getWeaknesses()!=null&&!u.getWeaknesses().isBlank()&&u.getLearningStyle()!=null&&!u.getLearningStyle().isBlank();return new Profile(u.getId(),u.getName(),u.getEmail(),u.getRole(),u.getEducationLevel(),u.getLearningGoal(),u.getTargetExam(),u.getInterests(),u.getStrengths(),u.getWeaknesses(),u.getLearningStyle(),u.getDailyStudyMinutes(),u.getPreferredAiLanguage(),complete);}
}
