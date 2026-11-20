package com.aitutor.ai;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

public class StreamCompletionTest {

    @Test
    void testCompletedStreamStatus() {
        StreamCompletion c = new StreamCompletion(StreamCompletion.COMPLETED, "STOP", 12, 540, 320);
        assertTrue(c.isCompleted());
        assertFalse(c.isTruncated());
        assertFalse(c.isSafetyRefusal());
        assertFalse(c.isError());
        assertEquals("STOP", c.finishReason());
        assertEquals(12, c.chunkCount());
        assertEquals(540, c.totalChars());
        assertEquals(320, c.durationMs());
    }

    @Test
    void testTruncatedMaxTokensStreamStatus() {
        StreamCompletion c = new StreamCompletion(StreamCompletion.TRUNCATED, "MAX_TOKENS", 48, 8192, 1200);
        assertFalse(c.isCompleted());
        assertTrue(c.isTruncated());
        assertFalse(c.isSafetyRefusal());
        assertFalse(c.isError());
        assertEquals("MAX_TOKENS", c.finishReason());
    }

    @Test
    void testSafetyRefusalStreamStatus() {
        StreamCompletion c = new StreamCompletion(StreamCompletion.SAFETY_REFUSAL, "SAFETY", 0, 0, 150);
        assertFalse(c.isCompleted());
        assertFalse(c.isTruncated());
        assertTrue(c.isSafetyRefusal());
        assertFalse(c.isError());
        assertEquals("SAFETY", c.finishReason());
    }

    @Test
    void testErrorStreamStatus() {
        StreamCompletion c = new StreamCompletion(StreamCompletion.ERROR, "ERROR", 2, 80, 500);
        assertFalse(c.isCompleted());
        assertFalse(c.isTruncated());
        assertFalse(c.isSafetyRefusal());
        assertTrue(c.isError());
    }
}
