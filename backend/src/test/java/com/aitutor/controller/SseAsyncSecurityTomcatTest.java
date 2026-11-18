package com.aitutor.controller;

import com.aitutor.ai.AiRequest;
import com.aitutor.ai.AiResponse;
import com.aitutor.ai.StreamCancellation;
import com.aitutor.entity.Course;
import com.aitutor.entity.Lesson;
import com.aitutor.entity.User;
import com.aitutor.repository.CourseRepository;
import com.aitutor.repository.LessonRepository;
import com.aitutor.repository.UserRepository;
import com.aitutor.security.JwtService;
import com.aitutor.service.AiService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.test.context.ActiveProfiles;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;
import java.util.function.Consumer;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Real embedded Tomcat integration test for REAUDIT-03:
 * Verifies that Spring Security 6.5 permits internal Servlet ASYNC dispatches when
 * SseEmitter.complete() finishes on /api/ai/ask/stream and /api/mentor/ask/stream
 * without throwing AuthorizationDeniedException or aborting the HTTP socket, while
 * keeping ordinary unauthenticated REQUESTs strictly blocked with HTTP 401.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
@Import(SseAsyncSecurityTomcatTest.StubAiConfig.class)
class SseAsyncSecurityTomcatTest {

    @TestConfiguration
    static class StubAiConfig {
        @Bean
        @Primary
        AiService stubStreamingAiService() {
            return new AiService(List.of()) {
                @Override
                public AiResponse ask(AiRequest r) {
                    return new AiResponse("stub-answer", r.task().name(), "stub");
                }

                @Override
                public void stream(AiRequest r, Consumer<String> onChunk, StreamCancellation cancellation) throws Exception {
                    if (r == null || r.task() == null) {
                        throw new ApiException(org.springframework.http.HttpStatus.BAD_REQUEST, "INVALID_AI_REQUEST", "AI task is required.");
                    }
                    onChunk.accept("Hello ");
                    Thread.sleep(25);
                    onChunk.accept("from real Tomcat!");
                }
            };
        }
    }

    @LocalServerPort
    int port;

    @Autowired UserRepository users;
    @Autowired CourseRepository courses;
    @Autowired LessonRepository lessons;
    @Autowired JwtService jwt;

    @Test
    void realTomcatSseEndpointsCompleteCleanlyAndStillBlockUnauthenticatedRequests() throws Exception {
        HttpClient client = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(5))
                .build();

        // 1. Ordinary unauthenticated REQUEST must STILL be rejected with HTTP 401
        HttpRequest unauthReq = HttpRequest.newBuilder()
                .uri(URI.create("http://127.0.0.1:" + port + "/api/ai/ask/stream"))
                .header("Content-Type", "application/json")
                .header("Accept", "text/event-stream")
                .POST(HttpRequest.BodyPublishers.ofString("{\"task\":\"CODING\",\"message\":\"hi\"}"))
                .build();
        HttpResponse<String> unauthResp = client.send(unauthReq, HttpResponse.BodyHandlers.ofString());
        assertEquals(401, unauthResp.statusCode(), "Unauthenticated SSE request must still return 401");

        // Create real authenticated user + published course + lesson
        User student = new User("Tomcat SSE Tester", "tomcat_sse_" + System.nanoTime() + "@example.com", "x");
        student.setRole("STUDENT");
        student.setActive(true);
        student.setBlocked(false);
        student.setEmailVerified(true);
        student = users.save(student);
        String token = jwt.token(student);

        Course pub = courses.save(new Course("Tomcat SSE Course", "Published", "Beginner", "📘"));
        pub.setPublished(true);
        pub = courses.save(pub);
        Lesson lesson = new Lesson();
        lesson.setCourse(pub);
        lesson.setTitle("Lesson 1");
        lesson.setTopic("Topic 1");
        lesson.setContent("Content");
        lesson.setOrderIndex(1);
        lesson = lessons.save(lesson);

        // 2. Authenticated /api/ai/ask/stream completes cleanly to EOF with zero socket abort
        HttpRequest aiStreamReq = HttpRequest.newBuilder()
                .uri(URI.create("http://127.0.0.1:" + port + "/api/ai/ask/stream"))
                .header("Authorization", "Bearer " + token)
                .header("Content-Type", "application/json")
                .header("Accept", "text/event-stream")
                .POST(HttpRequest.BodyPublishers.ofString("{\"task\":\"CODING\",\"topic\":\"SSE\",\"message\":\"Explain SSE\"}"))
                .build();
        HttpResponse<String> aiStreamResp = client.send(aiStreamReq, HttpResponse.BodyHandlers.ofString());
        assertEquals(200, aiStreamResp.statusCode(), "Authenticated /api/ai/ask/stream must return 200");
        assertTrue(aiStreamResp.headers().firstValue("content-type").orElse("").contains("text/event-stream"),
                "Expected text/event-stream content-type");
        assertTrue(aiStreamResp.body().contains("Hello "), "Missing first SSE chunk: " + aiStreamResp.body());
        assertTrue(aiStreamResp.body().contains("from real Tomcat!"), "Missing second SSE chunk: " + aiStreamResp.body());
        assertTrue(aiStreamResp.body().contains("event:done") && aiStreamResp.body().contains("data:done"),
                "Missing terminal SSE done event: " + aiStreamResp.body());

        // 3. Authenticated /api/mentor/ask/stream completes cleanly to EOF with zero socket abort
        HttpRequest mentorStreamReq = HttpRequest.newBuilder()
                .uri(URI.create("http://127.0.0.1:" + port + "/api/mentor/ask/stream"))
                .header("Authorization", "Bearer " + token)
                .header("Content-Type", "application/json")
                .header("Accept", "text/event-stream")
                .POST(HttpRequest.BodyPublishers.ofString(
                        "{\"userId\":" + student.getId() + ",\"courseId\":" + pub.getId() + ",\"lessonId\":" + lesson.getId() + ",\"mode\":\"TEACH\",\"message\":\"Explain\"}"))
                .build();
        HttpResponse<String> mentorStreamResp = client.send(mentorStreamReq, HttpResponse.BodyHandlers.ofString());
        assertEquals(200, mentorStreamResp.statusCode(), "Authenticated /api/mentor/ask/stream must return 200");
        assertTrue(mentorStreamResp.body().contains("from real Tomcat!"), "Missing mentor SSE chunk: " + mentorStreamResp.body());
        assertTrue(mentorStreamResp.body().contains("event:done"), "Missing mentor SSE done event: " + mentorStreamResp.body());
    }
}
