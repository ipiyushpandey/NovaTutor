package com.aitutor.service;

import com.aitutor.ai.*;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.function.Consumer;

@Service
public class AiService {
    private final List<AiProvider> providers;
    private final AiMetrics metrics;

    public AiService(List<AiProvider> providers) {
        this(providers, new AiMetrics());
    }

    @org.springframework.beans.factory.annotation.Autowired
    public AiService(List<AiProvider> providers, AiMetrics metrics) {
        this.providers = providers;
        this.metrics = metrics != null ? metrics : new AiMetrics();
    }

    public AiResponse ask(AiRequest r) {
        if (r == null || r.task() == null) {
            throw new com.aitutor.controller.ApiException(org.springframework.http.HttpStatus.BAD_REQUEST, "INVALID_AI_REQUEST", "AI task is required.");
        }
        // Atomically reserve exactly one quota slot before invoking any AI provider
        metrics.reserveDailyQuota();
        long started = System.nanoTime();
        boolean success = false;
        try {
            AiResponse resp = providers.stream().filter(AiProvider::available).findFirst()
                    .map(p -> p.generate(r))
                    .orElse(new AiResponse("No AI provider configured. Add GEMINI_API_KEY to backend environment.", r.task().name(), "none"));
            success = isSuccess(resp);
            return resp;
        } finally {
            long durationMs = (System.nanoTime() - started) / 1_000_000;
            metrics.record(r.task().name(), durationMs, success);
        }
    }

    public StreamCompletion stream(AiRequest r, Consumer<String> onChunk) throws Exception {
        return stream(r, onChunk, null);
    }

    public StreamCompletion stream(AiRequest r, Consumer<String> onChunk, StreamCancellation cancellation) throws Exception {
        if (r == null || r.task() == null) {
            throw new com.aitutor.controller.ApiException(org.springframework.http.HttpStatus.BAD_REQUEST, "INVALID_AI_REQUEST", "AI task is required.");
        }
        // Atomically reserve exactly one quota slot before invoking any AI provider
        metrics.reserveDailyQuota();
        long started = System.nanoTime();
        java.util.concurrent.atomic.AtomicLong firstToken = new java.util.concurrent.atomic.AtomicLong(-1);
        Consumer<String> wrapped = chunk -> {
            if (firstToken.get() < 0) firstToken.set((System.nanoTime() - started) / 1_000_000);
            if (onChunk != null) onChunk.accept(chunk);
        };
        boolean success = false;
        StreamCompletion completion = null;
        try {
            for (AiProvider provider : providers) {
                if (!provider.available()) continue;
                if (provider instanceof GeminiProvider gemini) {
                    completion = gemini.stream(r, wrapped, cancellation);
                    success = completion != null && !completion.isError() && !completion.isSafetyRefusal();
                    return completion;
                }
            }
            throw new IllegalStateException("No AI provider configured. Add GEMINI_API_KEY to backend environment.");
        } finally {
            long durationMs = completion != null ? completion.durationMs() : (System.nanoTime() - started) / 1_000_000;
            metrics.record(r.task().name(), durationMs, success, firstToken.get());
        }
    }

    private static boolean isSuccess(AiResponse response) {
        if (response == null || response.answer() == null) return false;
        if ("none".equalsIgnoreCase(response.provider())) return false;
        String text = response.answer();
        return !text.startsWith("Gemini is temporarily")
                && !text.startsWith("Gemini could not")
                && !text.contains("API key missing")
                && !text.contains("No AI provider configured");
    }
}
