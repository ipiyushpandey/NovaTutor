package com.aitutor.controller;

import com.aitutor.ai.AiRequest;
import com.aitutor.ai.AiTask;
import com.aitutor.ai.PromptEngine;
import com.aitutor.entity.Course;
import com.aitutor.entity.Lesson;
import com.aitutor.entity.User;
import com.aitutor.intelligence.QuizAttempt;
import com.aitutor.intelligence.QuizAttemptRepository;
import com.aitutor.repository.CourseRepository;
import com.aitutor.repository.LessonRepository;
import com.aitutor.repository.UserRepository;
import com.aitutor.security.JwtService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import static org.hamcrest.Matchers.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Wave 2 backend functional & data-integrity regression tests:
 * - AiTask.CODING & AiTask.EXAM_STRATEGY support
 * - Draft courses hidden from public /api/courses while visible on /api/admin/courses
 * - AdminController.deleteCourse cleans up quiz_attempts without FK failure
 * - ProgressController.complete is idempotent on repeated clicks
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class Wave2BackendFunctionalTest {

    @Autowired MockMvc mvc;
    @Autowired UserRepository users;
    @Autowired CourseRepository courses;
    @Autowired LessonRepository lessons;
    @Autowired QuizAttemptRepository attempts;
    @Autowired PasswordEncoder encoder;
    @Autowired JwtService jwt;

    private User createUser(String prefix, String role) {
        User u = new User("Test " + prefix, prefix + "-" + System.nanoTime() + "@novatutor.test",
                encoder.encode("SecretPass123!"));
        u.setRole(role);
        u.setEmailVerified(true);
        return users.save(u);
    }

    @Test
    void aiTaskSupportsCodingAndExamStrategy() throws Exception {
        String codingPrompt = PromptEngine.build(new AiRequest(AiTask.CODING, "Java", "Fix my loop", "intermediate", "English"));
        String strategyPrompt = PromptEngine.build(new AiRequest(AiTask.EXAM_STRATEGY, "GATE CSE", "30-day plan", "advanced", "English"));
        assertTrue(codingPrompt.contains("coding mentor"));
        assertTrue(strategyPrompt.contains("exam strategy"));

        User student = createUser("aitask", "STUDENT");
        String token = jwt.token(student);
        // Should NOT fail with 400 enum deserialization error
        mvc.perform(post("/api/ai/ask")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"task\":\"CODING\",\"topic\":\"DSA\",\"message\":\"Explain binary search\",\"level\":\"intermediate\",\"language\":\"English\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.task", is("CODING")));
        mvc.perform(post("/api/ai/ask")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"task\":\"EXAM_STRATEGY\",\"topic\":\"GATE CSE\",\"message\":\"Plan OS revision\",\"level\":\"intermediate\",\"language\":\"English\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.task", is("EXAM_STRATEGY")));
    }

    @Test
    void draftCoursesAreHiddenPubliclyVisibleToAdminAndDeletableWithAttempts() throws Exception {
        User student = createUser("coursepub", "STUDENT");
        User admin = createUser("courseadm", "ADMIN");
        String studentToken = jwt.token(student);
        String adminToken = jwt.token(admin);

        Course draft = new Course("Draft Course " + System.nanoTime(), "Unpublished", "Beginner", "📘");
        draft.setPublished(false);
        draft.setTotalLessons(1);
        draft = courses.save(draft);

        Course pub = new Course("Published Course " + System.nanoTime(), "Visible", "Beginner", "📗");
        pub.setPublished(true);
        pub.setTotalLessons(1);
        pub = courses.save(pub);

        // Public list hides draft, shows published
        String publicList = mvc.perform(get("/api/courses"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        assertFalse(publicList.contains(draft.getTitle()));
        assertTrue(publicList.contains(pub.getTitle()));

        // Student gets 404 on draft detail; Admin gets 200
        mvc.perform(get("/api/courses/" + draft.getId()).header("Authorization", "Bearer " + studentToken))
                .andExpect(status().isNotFound());
        mvc.perform(get("/api/courses/" + draft.getId()).header("Authorization", "Bearer " + adminToken))
                .andExpect(status().isOk());

        // Admin courses endpoint includes draft
        String adminList = mvc.perform(get("/api/admin/courses").header("Authorization", "Bearer " + adminToken))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        assertTrue(adminList.contains(draft.getTitle()));

        // Attach a QuizAttempt to draft and delete course — must succeed without FK violation
        QuizAttempt qa = new QuizAttempt();
        qa.setUser(student);
        qa.setCourse(draft);
        qa.setCorrect(3);
        qa.setTotal(5);
        qa.setScore(60);
        attempts.save(qa);

        mvc.perform(delete("/api/admin/courses/" + draft.getId()).header("Authorization", "Bearer " + adminToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.deleted", is(true)));
        assertTrue(courses.findById(draft.getId()).isEmpty());
    }

    @Test
    void progressCompleteIsIdempotentPerLesson() throws Exception {
        User student = createUser("progidem", "STUDENT");
        String token = jwt.token(student);

        Course c = new Course("Idempotent Course " + System.nanoTime(), "Desc", "Beginner", "📘");
        c.setPublished(true);
        c.setTotalLessons(5);
        c = courses.save(c);

        Lesson l1 = new Lesson();
        l1.setCourse(c);
        l1.setTitle("Lesson 1");
        l1.setTopic("Basics");
        l1.setOrderIndex(1);
        l1.setContent("Content");
        l1 = lessons.save(l1);

        // First completion increments to 1/5
        mvc.perform(post("/api/progress/" + student.getId() + "/course/" + c.getId() + "/lesson/" + l1.getId() + "/complete")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.completedLessons", is(1)))
                .andExpect(jsonPath("$.totalLessons", is(5)));

        // Repeated completion of the SAME lesson must NOT increment to 2/5
        mvc.perform(post("/api/progress/" + student.getId() + "/course/" + c.getId() + "/lesson/" + l1.getId() + "/complete")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.completedLessons", is(1)));
    }
}
