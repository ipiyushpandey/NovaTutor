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
    @Autowired com.aitutor.quiz.QuizQuestionRepository quizQuestions;
    @Autowired com.aitutor.intelligence.LearningEventRepository learningEvents;
    @Autowired com.fasterxml.jackson.databind.ObjectMapper objectMapper;
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

    @Test
    void concurrentLessonCompletionIsAtomicAndDeleteLessonReconcilesProgress() throws Exception {
        User student = createUser("progconc", "STUDENT");
        User admin = createUser("progadm", "ADMIN");
        String studentToken = jwt.token(student);
        String adminToken = jwt.token(admin);

        Course c = new Course("Concurrent Course " + System.nanoTime(), "Desc", "Beginner", "📘");
        c.setPublished(true);
        c.setTotalLessons(2);
        c = courses.save(c);

        Lesson l1 = new Lesson();
        l1.setCourse(c); l1.setTitle("L1"); l1.setTopic("T1"); l1.setOrderIndex(1); l1.setContent("C1");
        l1 = lessons.save(l1);
        Lesson l2 = new Lesson();
        l2.setCourse(c); l2.setTitle("L2"); l2.setTopic("T2"); l2.setOrderIndex(2); l2.setContent("C2");
        l2 = lessons.save(l2);

        // Fire 6 concurrent completions of the SAME lesson l1
        final Long courseId = c.getId();
        final Long lesson1Id = l1.getId();
        var pool = java.util.concurrent.Executors.newFixedThreadPool(6);
        var latch = new java.util.concurrent.CountDownLatch(1);
        var futures = new java.util.ArrayList<java.util.concurrent.Future<Integer>>();
        for (int i = 0; i < 6; i++) {
            futures.add(pool.submit(() -> {
                latch.await();
                return mvc.perform(post("/api/progress/" + student.getId() + "/course/" + courseId + "/lesson/" + lesson1Id + "/complete")
                                .header("Authorization", "Bearer " + studentToken))
                        .andReturn().getResponse().getStatus();
            }));
        }
        latch.countDown();
        for (var f : futures) assertEquals(200, f.get());
        pool.shutdownNow();

        // Must be exactly 1 completed lesson (never 2+)
        mvc.perform(get("/api/progress/" + student.getId()).header("Authorization", "Bearer " + studentToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.courseId==" + courseId + ")].completedLessons", contains(1)));

        // Complete l2 -> now 2/2 (100%)
        mvc.perform(post("/api/progress/" + student.getId() + "/course/" + courseId + "/lesson/" + l2.getId() + "/complete")
                        .header("Authorization", "Bearer " + studentToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.completedLessons", is(2)))
                .andExpect(jsonPath("$.totalLessons", is(2)));

        // Delete l2 -> Progress row must reconcile to 1/1 (100%), not stale 2/1 (200%)!
        mvc.perform(delete("/api/admin/lessons/" + l2.getId()).header("Authorization", "Bearer " + adminToken))
                .andExpect(status().isOk());

        mvc.perform(get("/api/progress/" + student.getId()).header("Authorization", "Bearer " + studentToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.courseId==" + courseId + ")].completedLessons", contains(1)))
                .andExpect(jsonPath("$[?(@.courseId==" + courseId + ")].totalLessons", contains(1)))
                .andExpect(jsonPath("$[?(@.courseId==" + courseId + ")].percent", contains(100.0)));
    }

    @Test
    void aiControllerRejectsNullTaskAndStreamCancellationClosesActiveStream() throws Exception {
        User student = createUser("ainull", "STUDENT");
        String token = jwt.token(student);

        mvc.perform(post("/api/ai/ask")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"topic\":\"DSA\",\"message\":\"Hi\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error", is("INVALID_AI_REQUEST")));

        mvc.perform(post("/api/ai/ask/stream")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"topic\":\"DSA\",\"message\":\"Hi\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error", is("INVALID_AI_REQUEST")));

        var cancel = new com.aitutor.ai.StreamCancellation();
        var closed = new java.util.concurrent.atomic.AtomicBoolean(false);
        cancel.attachStream(() -> closed.set(true));
        cancel.cancel();
        assertTrue(cancel.isCancelled());
        assertTrue(closed.get(), "StreamCancellation.cancel() must close attached upstream stream immediately");
    }

    @Test
    void dsaSaveCodePersistsLargeSubmissionsAbove64KbAndRejectsOversizedPayloads() throws Exception {
        User student = createUser("dsalarge", "STUDENT");
        String token = jwt.token(student);
        String largeCode = "// " + "a".repeat(75_000);

        mvc.perform(post("/api/dsa/progress/two-sum/code")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"language\":\"Java\",\"code\":\"" + largeCode + "\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.saved", is(true)));

        // Exceeding 250k char limit returns 400 CODE_TOO_LARGE
        String hugeCode = "// " + "b".repeat(260_000);
        mvc.perform(post("/api/dsa/progress/two-sum/code")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"language\":\"Java\",\"code\":\"" + hugeCode + "\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error", is("CODE_TOO_LARGE")));

        // Verify Docker sandbox command enforces non-root user, read-only workspace, Go cache in /tmp, non-login sh -c, and compile exit code 99
        SandboxExecutionService svc = new SandboxExecutionService(
                true, 5, 256, "eclipse-temurin:21-jdk", "python:3.12-alpine", "gcc:14", "node:22-alpine",
                "golang:1.24-alpine", "docker", null);
        for (String lang : java.util.List.of("java", "go", "c++", "c")) {
            var cmd = svc.command(lang, "main." + (lang.equals("java") ? "java" : lang.equals("go") ? "go" : "c"), java.nio.file.Path.of("/tmp/demo"));
            assertTrue(cmd.contains("--user") && cmd.contains("65534:65534"), lang + ": Docker must run as non-root user");
            assertTrue(cmd.contains("/tmp:rw,nosuid,mode=1777,size=64m"), lang + ": tmpfs must declare mode=1777");
            assertTrue(cmd.stream().anyMatch(s -> s.endsWith(":/workspace:ro")), lang + ": Workspace mount must be read-only");
            assertTrue(cmd.contains("-c"), lang + ": must invoke non-login sh -c so image PATH is preserved");
            assertFalse(cmd.contains("-lc"), lang + ": must NOT invoke login sh -lc which wipes PATH in Java/Go images");
            assertTrue(cmd.get(cmd.size() - 1).contains("exit 99"), lang + ": compiled language must distinguish COMPILE_ERROR via exit 99");
        }
        var goCmd = svc.command("go", "main.go", java.nio.file.Path.of("/tmp/demo"));
        assertTrue(goCmd.contains("GOCACHE=/tmp/.cache"), "Go cache must be directed to writable /tmp");
    }

    @Test
    void adaptiveAiQuestionWithExistingQuizAttemptDoesNotThrowLazyInit500() throws Exception {
        User student = createUser("adaptlazy", "STUDENT");
        String token = jwt.token(student);
        Course c = new Course("Adaptive Eager Course", "Desc", "Intermediate", "⚡");
        c.setPublished(true);
        c = courses.save(c);
        QuizAttempt qa = new QuizAttempt(student, c, 2, 1, 50, "99");
        attempts.save(qa);

        // Previously threw HTTP 500 LazyInitializationException at a.getCourse().getTitle() when open-in-view=false.
        // With @EntityGraph on QuizAttemptRepository, it reads course title cleanly before reaching aiProvider.available() -> 503.
        mvc.perform(post("/api/adaptive/" + student.getId() + "/ai-question")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.error", is("AI_UNAVAILABLE")));
    }

    @Test
    void sseErrorsReturnRealHttp503And400EvenWithAcceptTextEventStreamOnly() throws Exception {
        User student = createUser("sse406", "STUDENT");
        String token = jwt.token(student);

        // 1. Null task with Accept: text/event-stream must return 400 JSON (NOT 406 Not Acceptable!)
        mvc.perform(post("/api/ai/ask/stream")
                        .header("Authorization", "Bearer " + token)
                        .header("Accept", MediaType.TEXT_EVENT_STREAM_VALUE)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"topic\":\"DSA\",\"message\":\"Hi\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error", is("INVALID_AI_REQUEST")));

        // 2. Saturated bounded executor must return HTTP 503 AI_BUSY JSON (NOT 406!) even when Accept is strictly text/event-stream
        java.util.concurrent.ExecutorService rejectingPool = new java.util.concurrent.ThreadPoolExecutor(
                1, 1, 0L, java.util.concurrent.TimeUnit.SECONDS,
                new java.util.concurrent.SynchronousQueue<>(),
                new java.util.concurrent.ThreadPoolExecutor.AbortPolicy());
        java.util.concurrent.CountDownLatch hold = new java.util.concurrent.CountDownLatch(1);
        java.util.concurrent.CountDownLatch started = new java.util.concurrent.CountDownLatch(1);
        rejectingPool.execute(() -> {
            started.countDown();
            try { hold.await(5, java.util.concurrent.TimeUnit.SECONDS); } catch (InterruptedException ignored) {}
        });
        assertTrue(started.await(2, java.util.concurrent.TimeUnit.SECONDS));
        try {
            com.aitutor.service.AiService stubAi = new com.aitutor.service.AiService(java.util.List.of());
            AiController saturated = new AiController(stubAi, java.util.List.of(), new com.aitutor.ai.AiMetrics(), rejectingPool);
            MockMvc standalone = org.springframework.test.web.servlet.setup.MockMvcBuilders
                    .standaloneSetup(saturated)
                    .setControllerAdvice(new GlobalExceptionHandler(objectMapper))
                    .build();

            standalone.perform(post("/api/ai/ask/stream")
                            .header("Accept", MediaType.TEXT_EVENT_STREAM_VALUE)
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"task\":\"TUTOR\",\"topic\":\"DSA\",\"message\":\"Explain BFS\"}"))
                    .andExpect(status().isServiceUnavailable())
                    .andExpect(jsonPath("$.error", is("AI_BUSY")));
        } finally {
            hold.countDown();
            rejectingPool.shutdownNow();
        }
    }

    @Test
    void adaptiveShownBlocksDraftLeaksAndAntiXpFarmingCapsArePermanentAndIdempotent() throws Exception {
        User student = createUser("antifarm", "STUDENT");
        String token = jwt.token(student);

        Course pub = new Course("Published AntiFarm Course", "Desc", "Beginner", "📘");
        pub.setPublished(true);
        pub = courses.save(pub);
        Course draft = new Course("Secret Draft AntiFarm Course", "Desc", "Advanced", "🔒");
        draft.setPublished(false);
        draft = courses.save(draft);

        com.aitutor.quiz.QuizQuestion pubQ = new com.aitutor.quiz.QuizQuestion();
        pubQ.setCourse(pub); pubQ.setQuestion("Pub Q?"); pubQ.setOptionA("A"); pubQ.setOptionB("B"); pubQ.setOptionC("C"); pubQ.setOptionD("D"); pubQ.setCorrectOption(0); pubQ.setExplanation("Exp"); pubQ.setDifficulty("Easy");
        pubQ = quizQuestions.save(pubQ);
        com.aitutor.quiz.QuizQuestion draftQ = new com.aitutor.quiz.QuizQuestion();
        draftQ.setCourse(draft); draftQ.setQuestion("Draft Q?"); draftQ.setOptionA("A"); draftQ.setOptionB("B"); draftQ.setOptionC("C"); draftQ.setOptionD("D"); draftQ.setCorrectOption(0); draftQ.setExplanation("Exp"); draftQ.setDifficulty("Hard");
        draftQ = quizQuestions.save(draftQ);

        // 1. /shown must ignore draft question IDs, reject negatives, and deduplicate repeated published IDs
        mvc.perform(post("/api/adaptive/" + student.getId() + "/shown")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"questionIds\":[" + draftQ.getId() + ",-5," + pubQ.getId() + "," + pubQ.getId() + "]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.recorded", is(1)));

        mvc.perform(get("/api/intelligence/" + student.getId()).header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(content().string(not(containsString("Secret Draft AntiFarm Course"))));

        // 2. /revision-complete must reject fabricated subjects & draft courses and enforce permanent 3/day cap
        mvc.perform(post("/api/adaptive/" + student.getId() + "/revision-complete")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"subject\":\"Fabricated Farm Subject\",\"topic\":\"T1\"}"))
                .andExpect(status().isBadRequest());

        mvc.perform(post("/api/adaptive/" + student.getId() + "/revision-complete")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"subject\":\"Secret Draft AntiFarm Course\",\"topic\":\"T1\"}"))
                .andExpect(status().isBadRequest());

        for (int i = 1; i <= 3; i++) {
            mvc.perform(post("/api/adaptive/" + student.getId() + "/revision-complete")
                            .header("Authorization", "Bearer " + token)
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"subject\":\"Published AntiFarm Course\",\"topic\":\"RevTopic" + i + "\"}"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.saved", is(true)))
                    .andExpect(jsonPath("$.capped", is(false)));
        }
        // 4th revision on the same day must be capped (no XP awarded)
        mvc.perform(post("/api/adaptive/" + student.getId() + "/revision-complete")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"subject\":\"Published AntiFarm Course\",\"topic\":\"RevTopic4\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.saved", is(false)))
                .andExpect(jsonPath("$.capped", is(true)));

        // 3. /intelligence/events must reject negative score/duration, fabricated DPP subjects, and enforce permanent 4/day DPP cap & 6/day study cap
        mvc.perform(post("/api/intelligence/" + student.getId() + "/events")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"type\":\"DPP_COMPLETED\",\"subject\":\"Published AntiFarm Course\",\"topic\":\"T\",\"score\":-10}"))
                .andExpect(status().isBadRequest());

        mvc.perform(post("/api/intelligence/" + student.getId() + "/events")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"type\":\"STUDY_SPRINT_COMPLETED\",\"subject\":\"Nova Focus\",\"topic\":\"T\",\"durationSeconds\":-5}"))
                .andExpect(status().isBadRequest());

        mvc.perform(post("/api/intelligence/" + student.getId() + "/events")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"type\":\"DPP_COMPLETED\",\"subject\":\"Arbitrary Fake Subject\",\"topic\":\"T\",\"score\":100}"))
                .andExpect(status().isBadRequest());

        for (int i = 1; i <= 4; i++) {
            mvc.perform(post("/api/intelligence/" + student.getId() + "/events")
                            .header("Authorization", "Bearer " + token)
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"type\":\"DPP_COMPLETED\",\"subject\":\"Published AntiFarm Course\",\"topic\":\"DPP" + i + "\",\"score\":90}"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.saved", is(true)));
        }
        // Replay of DPP1 is idempotent / capped; 5th distinct DPP is capped at 4/day
        mvc.perform(post("/api/intelligence/" + student.getId() + "/events")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"type\":\"DPP_COMPLETED\",\"subject\":\"Published AntiFarm Course\",\"topic\":\"DPP5\",\"score\":100}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.saved", is(false)))
                .andExpect(jsonPath("$.capped", is(true)));

        // Study sprint 6/day cap backed by permanent DB count query
        for (int i = 1; i <= 6; i++) {
            mvc.perform(post("/api/intelligence/" + student.getId() + "/events")
                            .header("Authorization", "Bearer " + token)
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"type\":\"STUDY_SPRINT_COMPLETED\",\"subject\":\"Sprint" + i + "\",\"topic\":\"Focus\",\"durationSeconds\":1500}"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.saved", is(true)));
        }
        mvc.perform(post("/api/intelligence/" + student.getId() + "/events")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"type\":\"STUDY_SPRINT_COMPLETED\",\"subject\":\"Sprint7\",\"topic\":\"Focus\",\"durationSeconds\":1500}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.saved", is(false)))
                .andExpect(jsonPath("$.capped", is(true)));
    }

    @Test
    void localJavaHarnessCompilesAndExecutesCleanlyWithJavac() throws Exception {
        String javaHome = System.getProperty("java.home");
        java.nio.file.Path javac = java.nio.file.Path.of(javaHome, "bin", "javac");
        java.nio.file.Path javaBin = java.nio.file.Path.of(javaHome, "bin", "java");
        assertTrue(java.nio.file.Files.isExecutable(javac), "JDK javac must be available for local compile verification");

        String harness = com.aitutor.dsa.DsaLang.JAVA.harness(
                com.aitutor.dsa.DsaSig.A2I,
                "public final class Solution { public static int solve(int[] a) { int s = 0; for (int x : a) s += x; return s; } }");
        java.nio.file.Path dir = java.nio.file.Files.createTempDirectory("nova-java-test-");
        try {
            java.nio.file.Path src = dir.resolve("Main.java");
            java.nio.file.Files.writeString(src, harness);
            Process compile = new ProcessBuilder(javac.toString(), "-d", dir.toString(), src.toString())
                    .redirectErrorStream(true).start();
            String compileOut = new String(compile.getInputStream().readAllBytes());
            assertTrue(compile.waitFor(15, java.util.concurrent.TimeUnit.SECONDS));
            assertEquals(0, compile.exitValue(), "javac failed: " + compileOut);

            Process run = new ProcessBuilder(javaBin.toString(), "-cp", dir.toString(), "Main")
                    .redirectErrorStream(true).start();
            try (var os = run.getOutputStream()) {
                os.write("2,4,6,8\n".getBytes(java.nio.charset.StandardCharsets.UTF_8));
            }
            String runOut = new String(run.getInputStream().readAllBytes()).trim();
            assertTrue(run.waitFor(10, java.util.concurrent.TimeUnit.SECONDS));
            assertEquals(0, run.exitValue(), "java run failed: " + runOut);
            assertEquals("20", runOut, "Expected exact sum 20 from compiled Java harness");
        } finally {
            try (var walk = java.nio.file.Files.walk(dir)) {
                walk.sorted(java.util.Comparator.reverseOrder()).forEach(p -> {
                    try { java.nio.file.Files.deleteIfExists(p); } catch (Exception ignored) {}
                });
            }
        }
    }

    @Test
    void dailyXpCapsRespectIstBoundariesWhenHostTimezoneIsUtc() throws Exception {
        java.util.TimeZone previousTz = java.util.TimeZone.getDefault();
        java.util.TimeZone.setDefault(java.util.TimeZone.getTimeZone("UTC"));
        try {
            User student = createUser("utc_cap", "STUDENT");
            String token = jwt.token(student);

            Course pub = courses.save(new Course("UTC Boundary Course", "Published", "Beginner", "📘"));
            pub.setPublished(true);
            pub = courses.save(pub);

            // Persist yesterday-evening IST events (20:00 IST yesterday = 14:30 UTC yesterday).
            // Before REAUDIT-01 fix, withZoneSameInstant(UTC) shifted startOfToday to yesterday 18:30,
            // wrongly counting these yesterday events against today's cap and locking out students!
            java.time.LocalDateTime yesterdayEveningIst = com.aitutor.intelligence.LearningEventAnalyticsService
                    .todayIst().minusDays(1).atTime(20, 0);
            for (int i = 1; i <= 3; i++) {
                com.aitutor.intelligence.LearningEvent ev = new com.aitutor.intelligence.LearningEvent(
                        student, "REVISION_COMPLETED", pub.getTitle(), "YesterdayRev" + i, 100, 0,
                        "Yesterday evening IST", "UTC_TEST_REV_" + student.getId() + "_" + i);
                ev.setCreatedAt(yesterdayEveningIst);
                learningEvents.save(ev);
            }
            for (int i = 1; i <= 4; i++) {
                com.aitutor.intelligence.LearningEvent ev = new com.aitutor.intelligence.LearningEvent(
                        student, "DPP_COMPLETED", pub.getTitle(), "YesterdayDpp" + i, 100, 0,
                        "Yesterday evening IST", "UTC_TEST_DPP_" + student.getId() + "_" + i);
                ev.setCreatedAt(yesterdayEveningIst);
                learningEvents.save(ev);
            }

            // Under UTC host timezone, all 3 revisions for TODAY must still be accepted, and only the 4th capped.
            for (int i = 1; i <= 3; i++) {
                mvc.perform(post("/api/adaptive/" + student.getId() + "/revision-complete")
                                .header("Authorization", "Bearer " + token)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"subject\":\"UTC Boundary Course\",\"topic\":\"TodayRev" + i + "\"}"))
                        .andExpect(status().isOk())
                        .andExpect(jsonPath("$.saved", is(true)))
                        .andExpect(jsonPath("$.capped", is(false)));
            }
            mvc.perform(post("/api/adaptive/" + student.getId() + "/revision-complete")
                            .header("Authorization", "Bearer " + token)
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"subject\":\"UTC Boundary Course\",\"topic\":\"TodayRev4\"}"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.saved", is(false)))
                    .andExpect(jsonPath("$.capped", is(true)));

            // All 4 DPPs for TODAY must still be accepted under UTC, and only the 5th capped.
            for (int i = 1; i <= 4; i++) {
                mvc.perform(post("/api/intelligence/" + student.getId() + "/events")
                                .header("Authorization", "Bearer " + token)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"type\":\"DPP_COMPLETED\",\"subject\":\"UTC Boundary Course\",\"topic\":\"TodayDpp" + i + "\",\"score\":100}"))
                        .andExpect(status().isOk())
                        .andExpect(jsonPath("$.saved", is(true)));
            }
            mvc.perform(post("/api/intelligence/" + student.getId() + "/events")
                            .header("Authorization", "Bearer " + token)
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"type\":\"DPP_COMPLETED\",\"subject\":\"UTC Boundary Course\",\"topic\":\"TodayDpp5\",\"score\":100}"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.saved", is(false)))
                    .andExpect(jsonPath("$.capped", is(true)));
        } finally {
            java.util.TimeZone.setDefault(previousTz);
        }
    }

    @Test
    void emptyAndInvalidQuizSubmissionsRejectedAndQuizAndAdaptiveXpAreCapped() throws Exception {
        User student = createUser("quiz_cap", "STUDENT");
        String token = jwt.token(student);

        Course pub = courses.save(new Course("Quiz Cap Course", "Published", "Beginner", "📘"));
        pub.setPublished(true);
        pub = courses.save(pub);

        com.aitutor.quiz.QuizQuestion q1 = new com.aitutor.quiz.QuizQuestion();
        q1.setCourse(pub);
        q1.setTopic("Arrays");
        q1.setQuestion("What is O(1) lookup?");
        q1.setOptionA("HashMap");
        q1.setOptionB("LinkedList");
        q1.setOptionC("BubbleSort");
        q1.setOptionD("DFS");
        q1.setCorrectOption(0);
        q1.setDifficulty("Easy");
        q1 = quizQuestions.save(q1);

        // 1. Empty answers payload MUST be rejected with 400 — zero attempts and zero XP created
        mvc.perform(post("/api/quizzes/course/" + pub.getId() + "/submit")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"answers\":[]}"))
                .andExpect(status().isBadRequest());

        // 2. Fabricated questionId and out-of-range selectedOption MUST be rejected with 400
        mvc.perform(post("/api/quizzes/course/" + pub.getId() + "/submit")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"answers\":[{\"questionId\":999999,\"selectedOption\":0}]}"))
                .andExpect(status().isBadRequest());
        mvc.perform(post("/api/quizzes/course/" + pub.getId() + "/submit")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"answers\":[{\"questionId\":" + q1.getId() + ",\"selectedOption\":9}]}"))
                .andExpect(status().isBadRequest());

        assertEquals(0, attempts.findByUserId(student.getId()).size(), "Invalid submissions must never create QuizAttempts");
        assertEquals(0, learningEvents.countByUserIdAndType(student.getId(), "QUIZ_COMPLETED"), "Invalid submissions must never award QUIZ_COMPLETED XP");

        // 3. Legitimate repeated quiz submissions keep grading & saving attempts, but QUIZ_COMPLETED XP caps at 10/day
        //    and identical QUIZ_QUESTION events deduplicate per IST day.
        for (int i = 0; i < 12; i++) {
            mvc.perform(post("/api/quizzes/course/" + pub.getId() + "/submit")
                            .header("Authorization", "Bearer " + token)
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"answers\":[{\"questionId\":" + q1.getId() + ",\"selectedOption\":0}]}"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.total", is(1)))
                    .andExpect(jsonPath("$.correct", is(1)))
                    .andExpect(jsonPath("$.score", is(100)));
        }
        assertEquals(12, attempts.findByUserId(student.getId()).size(), "Legitimate quiz attempts must still be recorded");
        assertEquals(10, learningEvents.countByUserIdAndType(student.getId(), "QUIZ_COMPLETED"), "QUIZ_COMPLETED XP must cap at 10/day");
        assertEquals(1, learningEvents.countByUserIdAndType(student.getId(), "QUIZ_QUESTION"), "Repeated identical QUIZ_QUESTION must dedupe daily");

        // 4. AdaptiveController.answer: invalid option rejected (400), and ADAPTIVE_QUESTION XP caps at 30/day
        mvc.perform(post("/api/adaptive/" + student.getId() + "/answer")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"questionId\":" + q1.getId() + ",\"selectedOption\":5}"))
                .andExpect(status().isBadRequest());

        // Seed 30 today IST ADAPTIVE_QUESTION events to reach the daily cap
        for (int i = 1; i <= 30; i++) {
            com.aitutor.intelligence.LearningEvent ev = new com.aitutor.intelligence.LearningEvent(
                    student, "ADAPTIVE_QUESTION", pub.getTitle(), "Adaptive practice", 100, 0,
                    "seeded=" + i, "ADAPTIVE_SEED_" + student.getId() + "_" + i);
            learningEvents.save(ev);
        }
        // 31st adaptive answer still grades normally, returns xpCapped=true, and does NOT insert another ADAPTIVE_QUESTION row
        mvc.perform(post("/api/adaptive/" + student.getId() + "/answer")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"questionId\":" + q1.getId() + ",\"selectedOption\":0}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.correct", is(true)))
                .andExpect(jsonPath("$.xpCapped", is(true)));
        assertEquals(30, learningEvents.countByUserIdAndType(student.getId(), "ADAPTIVE_QUESTION"),
                "ADAPTIVE_QUESTION XP must remain capped at 30/day");
    }
}
