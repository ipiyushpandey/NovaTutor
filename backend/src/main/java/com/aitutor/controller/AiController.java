package com.aitutor.controller;

import com.aitutor.ai.*;
import com.aitutor.service.AiService;
import jakarta.annotation.PreDestroy;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.util.List;
import java.util.Map;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;

@RestController
@RequestMapping("/api/ai")
public class AiController {
    private final AiService ai;
    private final List<AiProvider> providers;
    private final AiMetrics metrics;
    /** Strictly bounded pool and queue: rejects overflow with 503 instead of exhausting heap/threads. */
    private final ExecutorService streamExecutor;

    @org.springframework.beans.factory.annotation.Autowired
    public AiController(AiService a, List<AiProvider> providers, AiMetrics metrics) {
        this(a, providers, metrics, new ThreadPoolExecutor(
                4, 16, 60L, TimeUnit.SECONDS,
                new ArrayBlockingQueue<>(32),
                r -> { Thread t = new Thread(r, "nova-ai-stream"); t.setDaemon(true); return t; },
                new ThreadPoolExecutor.AbortPolicy()));
    }

    AiController(AiService a, List<AiProvider> providers, AiMetrics metrics, ExecutorService streamExecutor) {
        this.ai = a;
        this.providers = providers;
        this.metrics = metrics;
        this.streamExecutor = streamExecutor;
    }

    @PreDestroy
    public void shutdown() {
        streamExecutor.shutdownNow();
    }

    @PostMapping("/ask")
    public AiResponse ask(@RequestBody AiRequest r) {
        if (r == null || r.task() == null) {
            throw new ApiException(org.springframework.http.HttpStatus.BAD_REQUEST, "INVALID_AI_REQUEST", "AI task is required.");
        }
        long started = System.nanoTime();
        AiResponse response = ai.ask(r);
        metrics.record(r.task().name(),
                (System.nanoTime() - started) / 1_000_000, succeeded(response));
        return response;
    }

    @PostMapping(value = "/ask/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter stream(@RequestBody AiRequest r) {
        if (r == null || r.task() == null) {
            throw new ApiException(org.springframework.http.HttpStatus.BAD_REQUEST, "INVALID_AI_REQUEST", "AI task is required.");
        }
        SseEmitter emitter = new SseEmitter(240_000L);
        StreamCancellation cancellation = new StreamCancellation();
        emitter.onTimeout(() -> { cancellation.cancel(); emitter.complete(); });
        emitter.onCompletion(cancellation::cancel);
        emitter.onError(ex -> { cancellation.cancel(); emitter.complete(); });
        String task = r.task().name();
        try {
            streamExecutor.execute(() -> {
                if (cancellation.isCancelled()) return;
                cancellation.attachThread(Thread.currentThread());
                long started = System.nanoTime();
                AtomicLong firstChunk = new AtomicLong(-1);
                AtomicBoolean failed = new AtomicBoolean(false);
                try {
                    ai.stream(r, chunk -> {
                        if (cancellation.isCancelled()) throw new IllegalStateException("Client disconnected");
                        if (firstChunk.get() < 0) firstChunk.set((System.nanoTime() - started) / 1_000_000);
                        try { emitter.send(SseEmitter.event().data(chunk)); }
                        catch (java.io.IOException e) { cancellation.cancel(); throw new IllegalStateException(e); }
                    }, cancellation);
                    if (!cancellation.isCancelled()) {
                        emitter.send(SseEmitter.event().name("done").data("done"));
                        emitter.complete();
                    }
                } catch (Exception e) {
                    failed.set(true);
                    if (!cancellation.isCancelled()) {
                        try { emitter.send(SseEmitter.event().name("error").data("AI request failed. Please try again.")); }
                        catch (Exception ignored) { }
                        emitter.complete();
                    }
                } finally {
                    cancellation.clearThread();
                    Thread.interrupted(); // clear interrupt status before returning thread to pool
                    metrics.record(task, (System.nanoTime() - started) / 1_000_000,
                            !failed.get(), firstChunk.get());
                }
            });
        } catch (RejectedExecutionException full) {
            throw new ApiException(org.springframework.http.HttpStatus.SERVICE_UNAVAILABLE, "AI_BUSY",
                    "AI tutor is busy right now. Please retry in a few seconds.");
        }
        return emitter;
    }

    @GetMapping("/status")
    public Map<String, Object> status() {
        AiProvider provider = providers.stream()
                .filter(AiProvider::available)
                .findFirst()
                .orElse(null);

        String model = "—";
        if (provider instanceof GeminiProvider gemini) model = gemini.model();

        return Map.of(
                "configured", provider != null,
                "provider", provider == null ? "none" : provider.name(),
                "model", model
        );
    }

    /** Not provider output: a real answer exists only when a provider returned text. */
    private boolean succeeded(AiResponse response) {
        if (response == null || response.answer() == null) return false;
        if ("none".equalsIgnoreCase(response.provider())) return false;
        String text = response.answer();
        return !text.startsWith("Gemini is temporarily")
                && !text.startsWith("Gemini could not")
                && !text.contains("API key missing")
                && !text.contains("No AI provider configured");
    }
}
