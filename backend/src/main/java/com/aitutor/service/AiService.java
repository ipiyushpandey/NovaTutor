package com.aitutor.service;

import com.aitutor.ai.*;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.function.Consumer;

@Service
public class AiService {
    private final List<AiProvider> providers;
    public AiService(List<AiProvider> providers){this.providers=providers;}

    public AiResponse ask(AiRequest r){
        if (r == null || r.task() == null) {
            throw new com.aitutor.controller.ApiException(org.springframework.http.HttpStatus.BAD_REQUEST, "INVALID_AI_REQUEST", "AI task is required.");
        }
        return providers.stream().filter(AiProvider::available).findFirst()
                .map(p->p.generate(r))
                .orElse(new AiResponse("No AI provider configured. Add GEMINI_API_KEY to backend environment.",r.task().name(),"none"));
    }

    public void stream(AiRequest r, Consumer<String> onChunk) throws Exception {
        stream(r, onChunk, null);
    }

    public void stream(AiRequest r, Consumer<String> onChunk, StreamCancellation cancellation) throws Exception {
        if (r == null || r.task() == null) {
            throw new com.aitutor.controller.ApiException(org.springframework.http.HttpStatus.BAD_REQUEST, "INVALID_AI_REQUEST", "AI task is required.");
        }
        for (AiProvider provider : providers) {
            if (!provider.available()) continue;
            if (provider instanceof GeminiProvider gemini) {
                gemini.stream(r, onChunk, cancellation);
                return;
            }
        }
        throw new IllegalStateException("No AI provider configured. Add GEMINI_API_KEY to backend environment.");
    }
}
