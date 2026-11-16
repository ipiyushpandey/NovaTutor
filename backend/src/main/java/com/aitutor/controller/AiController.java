package com.aitutor.controller;

import com.aitutor.ai.*;
import com.aitutor.service.AiService;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;

@RestController
@RequestMapping("/api/ai")
public class AiController {
    private final AiService ai;
    private final List<AiProvider> providers;
    private final AiMetrics metrics;
    /** Bounded pool: unbounded per-request threads allowed thread exhaustion under load. */
    private final ExecutorService streamExecutor = Executors.newFixedThreadPool(16, r -> {
        Thread t = new Thread(r, "nova-ai-stream"); t.setDaemon(true); return t;
    });

    public AiController(AiService a, List<AiProvider> providers, AiMetrics metrics) {
        this.ai = a;
        this.providers = providers;
        this.metrics = metrics;
    }

    @PostMapping("/ask")
    public AiResponse ask(@RequestBody AiRequest r) {
        long started = System.nanoTime();
        AiResponse response = ai.ask(r);
        metrics.record(r.task() == null ? "UNKNOWN" : r.task().name(),
                (System.nanoTime() - started) / 1_000_000, succeeded(response));
        return response;
    }

    @PostMapping(value = "/ask/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter stream(@RequestBody AiRequest r) {
        SseEmitter emitter = new SseEmitter(300_000L);
        emitter.onTimeout(emitter::complete);
        emitter.onError(ex -> emitter.complete());
        String task = r.task() == null ? "UNKNOWN" : r.task().name();
        streamExecutor.execute(() -> {
            long started = System.nanoTime();
            AtomicLong firstChunk = new AtomicLong(-1);
            AtomicBoolean failed = new AtomicBoolean(false);
            try {
                ai.stream(r, chunk -> {
                    if (firstChunk.get() < 0) firstChunk.set((System.nanoTime() - started) / 1_000_000);
                    try { emitter.send(SseEmitter.event().data(chunk)); }
                    catch (java.io.IOException e) { throw new IllegalStateException(e); }
                });
                emitter.send(SseEmitter.event().name("done").data("done"));
                emitter.complete();
            } catch (Exception e) {
                failed.set(true);
                try { emitter.send(SseEmitter.event().name("error").data("AI request failed. Please try again.")); }
                catch (Exception ignored) { }
                emitter.completeWithError(e);
            } finally {
                metrics.record(task, (System.nanoTime() - started) / 1_000_000,
                        !failed.get(), firstChunk.get());
            }
        });
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
