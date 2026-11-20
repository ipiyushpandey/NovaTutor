package com.aitutor.quiz;

import com.aitutor.entity.Course;
import com.aitutor.entity.User;
import com.aitutor.intelligence.QuizAttempt;
import com.aitutor.intelligence.QuizAttemptRepository;
import com.aitutor.repository.CourseRepository;
import com.aitutor.repository.UserRepository;
import com.aitutor.security.JwtService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;

import static org.hamcrest.Matchers.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
public class QuizControllerTest {

    @Autowired private MockMvc mvc;
    @Autowired private UserRepository users;
    @Autowired private CourseRepository courses;
    @Autowired private QuizQuestionRepository questions;
    @Autowired private QuizAttemptRepository attempts;
    @Autowired private PasswordEncoder encoder;
    @Autowired private JwtService jwt;

    private User student;
    private String token;
    private Course course;
    private QuizQuestion q1;
    private QuizQuestion q2;

    @BeforeEach
    void setUp() {
        student = new User("Quiz Student", "quiz-student-" + System.nanoTime() + "@novatutor.test", encoder.encode("Password123!"));
        student.setRole("STUDENT");
        student.setEmailVerified(true);
        student = users.save(student);
        token = jwt.token(student);

        course = new Course("Quiz Domain Course", "Test course for quiz verification", "Beginner", "🧪");
        course.setPublished(true);
        course = courses.save(course);

        q1 = new QuizQuestion();
        q1.setCourse(course);
        q1.setTopic("Algorithms");
        q1.setQuestion("What is the time complexity of binary search?");
        q1.setOptionA("O(log n)");
        q1.setOptionB("O(n)");
        q1.setOptionC("O(n log n)");
        q1.setOptionD("O(1)");
        q1.setCorrectOption(0);
        q1.setExplanation("Binary search cuts the search interval in half each step.");
        q1.setDifficulty("Easy");
        q1 = questions.save(q1);

        q2 = new QuizQuestion();
        q2.setCourse(course);
        q2.setTopic("Data Structures");
        q2.setQuestion("Which data structure uses FIFO ordering?");
        q2.setOptionA("Stack");
        q2.setOptionB("Queue");
        q2.setOptionC("Tree");
        q2.setOptionD("Graph");
        q2.setCorrectOption(1);
        q2.setExplanation("Queue operates on First-In, First-Out principle.");
        q2.setDifficulty("Easy");
        q2 = questions.save(q2);
    }

    @Test
    void testGetQuestionsReturnsListOfQuestions() throws Exception {
        mvc.perform(get("/api/quizzes/course/" + course.getId())
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(2)))
                .andExpect(jsonPath("$[0].id", notNullValue()))
                .andExpect(jsonPath("$[0].question", notNullValue()))
                .andExpect(jsonPath("$[0].options", hasSize(4)))
                .andExpect(jsonPath("$[0].difficulty", notNullValue()));
    }

    @Test
    void testSubmitQuizReturnsResultWithReviews() throws Exception {
        String payload = """
                {
                    "answers": [
                        {"questionId": %d, "selectedOption": 0},
                        {"questionId": %d, "selectedOption": 0}
                    ]
                }
                """.formatted(q1.getId(), q2.getId());

        mvc.perform(post("/api/quizzes/course/" + course.getId() + "/submit")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(payload))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total", is(2)))
                .andExpect(jsonPath("$.correct", is(1)))
                .andExpect(jsonPath("$.incorrect", is(1)))
                .andExpect(jsonPath("$.score", is(50)))
                .andExpect(jsonPath("$.reviews", hasSize(2)))
                .andExpect(jsonPath("$.reviews[0].question", notNullValue()))
                .andExpect(jsonPath("$.reviews[0].options", hasSize(4)))
                .andExpect(jsonPath("$.reviews[0].selectedOption", is(0)))
                .andExpect(jsonPath("$.reviews[0].correctOption", is(0)))
                .andExpect(jsonPath("$.reviews[0].correct", is(true)))
                .andExpect(jsonPath("$.reviews[0].explanation", containsString("Binary search")))
                .andExpect(jsonPath("$.reviews[1].selectedOption", is(0)))
                .andExpect(jsonPath("$.reviews[1].correctOption", is(1)))
                .andExpect(jsonPath("$.reviews[1].correct", is(false)))
                .andExpect(jsonPath("$.wrongQuestionIds", contains(q2.getId().intValue())));

        List<QuizAttempt> studentAttempts = attempts.findByUserId(student.getId());
        assertFalse(studentAttempts.isEmpty());
        assertEquals(2, studentAttempts.get(0).getTotal());
        assertEquals(1, studentAttempts.get(0).getCorrect());
    }

    @Test
    void testRevisionReturnsOnlyIncorrectQuestions() throws Exception {
        // First submit with q2 wrong
        String payload = """
                {
                    "answers": [
                        {"questionId": %d, "selectedOption": 0},
                        {"questionId": %d, "selectedOption": 3}
                    ]
                }
                """.formatted(q1.getId(), q2.getId());

        mvc.perform(post("/api/quizzes/course/" + course.getId() + "/submit")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(payload))
                .andExpect(status().isOk());

        // Revision should now contain only q2
        mvc.perform(get("/api/quizzes/course/" + course.getId() + "/revision")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(1)))
                .andExpect(jsonPath("$[0].id", is(q2.getId().intValue())));
    }
}
