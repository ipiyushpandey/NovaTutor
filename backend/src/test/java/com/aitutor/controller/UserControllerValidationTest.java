package com.aitutor.controller;

import com.aitutor.entity.User;
import com.aitutor.intelligence.LearningEventRepository;
import com.aitutor.repository.UserRepository;
import com.aitutor.security.AuthenticatedUser;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.util.Collections;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class UserControllerValidationTest {

    @Test
    @DisplayName("isValidName validates realistic names and rejects numbers, gibberish, or single chars")
    void testIsValidName() {
        assertTrue(UserController.isValidName("John Doe"));
        assertTrue(UserController.isValidName("Anya Sharma"));
        assertTrue(UserController.isValidName("Renée O'Connor"));
        assertTrue(UserController.isValidName("Jean-Luc Picard"));

        assertFalse(UserController.isValidName(null));
        assertFalse(UserController.isValidName(""));
        assertFalse(UserController.isValidName("   "));
        assertFalse(UserController.isValidName("A"));
        assertFalse(UserController.isValidName("12345"));
        assertFalse(UserController.isValidName("John123"));
        assertFalse(UserController.isValidName("aaaa"));
        assertFalse(UserController.isValidName("<script>"));
    }

    @Test
    @DisplayName("isMeaningfulText rejects keystroke gibberish like bcsjcgs while accepting valid goals and multilingual scripts")
    void testIsMeaningfulText() {
        assertTrue(UserController.isMeaningfulText("GATE CSE & algorithms", 5, 500));
        assertTrue(UserController.isMeaningfulText("Learn Java and Spring Boot", 5, 500));
        assertTrue(UserController.isMeaningfulText("Data structures & web development", 5, 500));
        assertTrue(UserController.isMeaningfulText("डेटा संरचना और कोडिंग", 5, 500));

        assertFalse(UserController.isMeaningfulText(null, 5, 500));
        assertFalse(UserController.isMeaningfulText("", 5, 500));
        assertFalse(UserController.isMeaningfulText("asdf", 5, 500)); // < 5 chars
        assertFalse(UserController.isMeaningfulText("bcsjcgs", 5, 500)); // No vowels / keyboard mash
        assertFalse(UserController.isMeaningfulText("bbbbbb", 5, 500)); // All identical chars
        assertFalse(UserController.isMeaningfulText("12345678", 5, 500)); // No letters
        assertFalse(UserController.isMeaningfulText("!@#$%^&*", 5, 500)); // Only punctuation
    }

    @Test
    @DisplayName("UserController.update rejects gibberish goal bcsjcgs")
    void testUpdateRejectsGibberishGoal() {
        UserRepository repo = mock(UserRepository.class);
        PasswordEncoder encoder = mock(PasswordEncoder.class);
        LearningEventRepository learningEvents = mock(LearningEventRepository.class);
        AuthenticatedUser authenticatedUser = new AuthenticatedUser(repo);
        UserController controller = new UserController(repo, encoder, authenticatedUser, learningEvents);

        User u = new User();
        u.setId(10L);
        u.setName("Test Student");
        u.setEmail("student@novatutor.test");
        u.setRole("STUDENT");

        when(repo.findByEmail("student@novatutor.test")).thenReturn(Optional.of(u));

        Authentication auth = new UsernamePasswordAuthenticationToken("student@novatutor.test", null, Collections.emptyList());

        UserController.ProfileRequest badRequest = new UserController.ProfileRequest(
                "Test Student",
                "B.Tech / College",
                "bcsjcgs", // Gibberish!
                "GATE",
                "Java, DSA",
                "Mathematics",
                "Dynamic programming",
                "Visual + practical",
                60,
                "English"
        );

        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class, () ->
                controller.update(10L, auth, badRequest)
        );
        assertTrue(ex.getMessage().contains("Learning goal"));
    }

    @Test
    @DisplayName("UserController.update accepts valid profile and computes profileComplete=true for student")
    void testUpdateAcceptsValidProfile() {
        UserRepository repo = mock(UserRepository.class);
        PasswordEncoder encoder = mock(PasswordEncoder.class);
        LearningEventRepository learningEvents = mock(LearningEventRepository.class);
        AuthenticatedUser authenticatedUser = new AuthenticatedUser(repo);
        UserController controller = new UserController(repo, encoder, authenticatedUser, learningEvents);

        User u = new User();
        u.setId(10L);
        u.setName("Test Student");
        u.setEmail("student@novatutor.test");
        u.setRole("STUDENT");

        when(repo.findByEmail("student@novatutor.test")).thenReturn(Optional.of(u));

        Authentication auth = new UsernamePasswordAuthenticationToken("student@novatutor.test", null, Collections.emptyList());

        UserController.ProfileRequest validRequest = new UserController.ProfileRequest(
                "Test Student",
                "B.Tech / College",
                "GATE CSE & Algorithms",
                "GATE 2026",
                "Java, DSA, Cloud computing",
                "Problem solving",
                "Dynamic programming and Graph theory",
                "Visual + practical",
                90,
                "English"
        );

        UserController.Profile res = controller.update(10L, auth, validRequest);
        assertNotNull(res);
        assertTrue(res.profileComplete());
        assertEquals("GATE CSE & Algorithms", res.learningGoal());
        assertEquals(90, res.dailyStudyMinutes());
        verify(repo).save(u);
    }

    @Test
    @DisplayName("Guest and Admin roles always return profileComplete=true regardless of null goals")
    void testGuestAndAdminProfileComplete() {
        UserRepository repo = mock(UserRepository.class);
        PasswordEncoder encoder = mock(PasswordEncoder.class);
        LearningEventRepository learningEvents = mock(LearningEventRepository.class);
        AuthenticatedUser authenticatedUser = new AuthenticatedUser(repo);
        UserController controller = new UserController(repo, encoder, authenticatedUser, learningEvents);

        User guest = new User();
        guest.setId(99L);
        guest.setName("Guest Explorer");
        guest.setEmail("guest_99@guest.novatutor.local");
        guest.setRole("GUEST");

        when(repo.findByEmail("guest_99@guest.novatutor.local")).thenReturn(Optional.of(guest));
        Authentication authG = new UsernamePasswordAuthenticationToken("guest_99@guest.novatutor.local", null, Collections.emptyList());

        UserController.Profile guestProfile = controller.get(99L, authG);
        assertTrue(guestProfile.profileComplete(), "Guests must always have profileComplete=true");

        User admin = new User();
        admin.setId(1L);
        admin.setName("Admin User");
        admin.setEmail("admin@novatutor.test");
        admin.setRole("ADMIN");

        when(repo.findByEmail("admin@novatutor.test")).thenReturn(Optional.of(admin));
        Authentication authA = new UsernamePasswordAuthenticationToken("admin@novatutor.test", null, Collections.emptyList());

        UserController.Profile adminProfile = controller.get(1L, authA);
        assertTrue(adminProfile.profileComplete(), "Admins must always have profileComplete=true");

        User newStudent = new User();
        newStudent.setId(50L);
        newStudent.setName("Incomplete Student");
        newStudent.setEmail("student50@novatutor.test");
        newStudent.setRole("STUDENT");

        when(repo.findByEmail("student50@novatutor.test")).thenReturn(Optional.of(newStudent));
        Authentication authS = new UsernamePasswordAuthenticationToken("student50@novatutor.test", null, Collections.emptyList());

        UserController.Profile studentProfile = controller.get(50L, authS);
        assertFalse(studentProfile.profileComplete(), "Incomplete students must have profileComplete=false");
    }
}
