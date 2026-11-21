package com.aitutor.controller;

import com.aitutor.ai.*;
import com.aitutor.entity.Lesson;
import com.aitutor.entity.Progress;
import com.aitutor.entity.User;
import com.aitutor.repository.LessonRepository;
import com.aitutor.repository.ProgressRepository;
import com.aitutor.repository.UserRepository;
import com.aitutor.service.AiService;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.*;
import org.springframework.security.core.Authentication;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import com.aitutor.security.AuthenticatedUser;

import jakarta.annotation.PreDestroy;
import java.io.IOException;
import java.util.*;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

@RestController
@RequestMapping("/api/mentor")
public class MentorController {
    private final AiService ai;
    private final LessonRepository lessons;
    private final ProgressRepository progress;
    private final UserRepository users;
    private final AuthenticatedUser authenticatedUser;
    /** Strictly bounded pool and queue: rejects overflow with 503 instead of exhausting heap/threads. */
    private final ExecutorService streamExecutor;

    @org.springframework.beans.factory.annotation.Autowired
    public MentorController(AiService ai, LessonRepository lessons, ProgressRepository progress, UserRepository users, AuthenticatedUser authenticatedUser) {
        this(ai, lessons, progress, users, authenticatedUser, new ThreadPoolExecutor(
                4, 16, 60L, TimeUnit.SECONDS,
                new ArrayBlockingQueue<>(32),
                r -> { Thread t = new Thread(r, "nova-mentor-stream"); t.setDaemon(true); return t; },
                new ThreadPoolExecutor.AbortPolicy()));
    }

    MentorController(AiService ai, LessonRepository lessons, ProgressRepository progress, UserRepository users, AuthenticatedUser authenticatedUser, ExecutorService streamExecutor) {
        this.ai = ai;
        this.lessons = lessons;
        this.progress = progress;
        this.users = users;
        this.authenticatedUser = authenticatedUser;
        this.streamExecutor = streamExecutor;
    }

    private final com.fasterxml.jackson.databind.ObjectMapper objectMapper = new com.fasterxml.jackson.databind.ObjectMapper();

    @PreDestroy
    public void shutdown() {
        streamExecutor.shutdownNow();
    }

    @PostMapping("/ask")
    public AiResponse ask(@RequestBody MentorRequest r, Authentication authentication) {
        Lesson lesson = lessons.findById(r.lessonId()).orElseThrow();
        User authenticated = authenticatedUser.require(authentication);
        if (lesson.getCourse() != null && !lesson.getCourse().isPublished() && !authenticatedUser.isAdmin(authenticated)) {
            throw new NoSuchElementException("Lesson not found");
        }
        return ai.ask(buildRequest(r, lesson, authenticated));
    }

    /** Fast AI Teacher transport: text is forwarded as Gemini generates it. */
    @PostMapping(value = "/ask/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter askStream(@RequestBody MentorRequest r, Authentication authentication) {
        Lesson lesson = lessons.findById(r.lessonId()).orElseThrow();
        User authenticated = authenticatedUser.require(authentication);
        if (lesson.getCourse() != null && !lesson.getCourse().isPublished() && !authenticatedUser.isAdmin(authenticated)) {
            throw new NoSuchElementException("Lesson not found");
        }
        SseEmitter emitter = new SseEmitter(240_000L);
        StreamCancellation cancellation = new StreamCancellation();
        emitter.onTimeout(() -> { cancellation.cancel(); emitter.complete(); });
        emitter.onCompletion(cancellation::cancel);
        emitter.onError(ex -> { cancellation.cancel(); emitter.complete(); });
        AiRequest request = buildRequest(r, lesson, authenticated);
        try {
            streamExecutor.execute(() -> {
                if (cancellation.isCancelled()) return;
                cancellation.attachThread(Thread.currentThread());
                try {
                    StreamCompletion completion = ai.stream(request, chunk -> {
                        if (cancellation.isCancelled()) throw new IllegalStateException("Client disconnected");
                        try { emitter.send(SseEmitter.event().data(formatSseChunk(chunk))); }
                        catch (IOException e) { cancellation.cancel(); throw new IllegalStateException(e); }
                    }, cancellation);
                    if (!cancellation.isCancelled()) {
                        Map<String, Object> payload = new java.util.LinkedHashMap<>();
                        payload.put("status", completion.status());
                        payload.put("finishReason", completion.finishReason());
                        payload.put("chunks", completion.chunkCount());
                        payload.put("totalChars", completion.totalChars());
                        payload.put("durationMs", completion.durationMs());
                        String dataJson = objectMapper.writeValueAsString(payload);

                        if (completion.isTruncated()) {
                            emitter.send(SseEmitter.event().name("truncated").data(dataJson));
                        } else if (completion.isSafetyRefusal()) {
                            emitter.send(SseEmitter.event().name("safety").data(dataJson));
                        } else {
                            emitter.send(SseEmitter.event().name("done").data("done"));
                        }
                        emitter.complete();
                    }
                } catch (Exception e) {
                    if (!cancellation.isCancelled()) {
                        try {
                            Map<String, Object> errPayload = Map.of(
                                "status", "ERROR",
                                "message", "AI request failed. Please try again."
                            );
                            emitter.send(SseEmitter.event().name("error").data(objectMapper.writeValueAsString(errPayload)));
                        } catch (Exception ignored) { }
                        emitter.complete();
                    }
                } finally {
                    cancellation.clearThread();
                    Thread.interrupted();
                }
            });
        } catch (RejectedExecutionException full) {
            throw new ApiException(org.springframework.http.HttpStatus.SERVICE_UNAVAILABLE, "AI_BUSY",
                    "AI mentor is busy right now. Please retry in a few seconds.");
        }
        return emitter;
    }

    private AiRequest buildRequest(MentorRequest r, Lesson lesson, User user) {
        int completed = 0;
        if (r.courseId() != null) {
            completed = progress.findByUserIdAndCourseId(user.getId(), r.courseId())
                    .map(Progress::getCompletedLessons).orElse(0);
        }
        String mode = r.mode() == null ? "TEACH" : r.mode().toUpperCase(Locale.ROOT);
        String instruction = switch (mode) {
            case "SIMPLIFY" -> "Simplify this lesson for a beginner using an everyday analogy and one tiny example.";
            case "EXAMPLE" -> "Teach this lesson through one practical example. Explain each step and then ask one check question.";
            case "HINT" -> "Give a hint for the student's question. Guide them with the smallest useful next step.";
            case "CHECK" -> "Act as a mini oral examiner. Ask one question based on this lesson and evaluate the student's answer if provided.";
            default -> "Answer the student's question first, then teach the next useful concept step-by-step. End with one short check question.";
        };
        String student = limit(r.message(), 6000, "Start teaching me.");
        // Focused content window keeps prompt processing fast (~1-2s time-to-first-token).
        String lessonContent = limit(lesson.getContent(), 3500, "Lesson content is unavailable.");
        String context = "Student goal=" + safe(user.getLearningGoal())
                + ", learning style=" + safe(user.getLearningStyle())
                + ", weaknesses=" + safe(user.getWeaknesses())
                + "\nLesson title: " + safe(lesson.getTitle())
                + "\nLesson content:\n" + lessonContent
                + "\nCourse completed lessons: " + completed
                + "\nMode: " + mode + "\nTutor instruction: " + instruction
                + "\nTeaching rule: use short sections, concrete examples and visual mental models only when they improve understanding. Ensure words are separated by spaces and mathematical/complexity notation is written cleanly without distorted brackets."
                + "\nStudent message: " + student;
        return new AiRequest(AiTask.ADAPTIVE_TUTOR, lesson.getTitle(), context, r.level(), r.language());
    }

    static String formatSseChunk(String chunk) {
        if (chunk == null || chunk.isEmpty()) return "";
        if (chunk.indexOf('\n') == -1) {
            return chunk.startsWith(" ") ? " " + chunk : chunk;
        }
        String[] lines = chunk.split("\n", -1);
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < lines.length; i++) {
            if (i > 0) sb.append("\n");
            if (lines[i].startsWith(" ")) {
                sb.append(" ").append(lines[i]);
            } else {
                sb.append(lines[i]);
            }
        }
        return sb.toString();
    }

    private String limit(String value, int max, String fallback) {
        if (value == null || value.isBlank()) return fallback;
        String trimmed = value.trim();
        return trimmed.length() <= max ? trimmed : trimmed.substring(0, max) + "\n[Lesson content shortened for response speed.]";
    }

    private String safe(String x){ return x==null||x.isBlank()?"not specified":limit(x,500,"not specified"); }

    @GetMapping("/state/{userId}")
    public Map<String, Object> state(@PathVariable Long userId, Authentication authentication) {
        authenticatedUser.requireSame(authentication,userId);
        User user = users.findById(userId).orElseThrow();
        List<Progress> rows = progress.findByUserId(user.getId());
        double average = rows.stream().mapToDouble(Progress::getPercent).average().orElse(0);
        String level = average < 30 ? "beginner" : average < 70 ? "intermediate" : "advanced";
        return Map.of("userId", userId, "averageProgress", Math.round(average * 10.0) / 10.0, "recommendedLevel", level,
                "coursesStarted", rows.size(), "completedLessons", rows.stream().mapToInt(Progress::getCompletedLessons).sum());
    }
}
